const path = require('path');
const fs = require('fs');
const { BloodRequest } = require('../models/BloodRequest');
const User = require('../models/User');
const { Notification } = require('../models/Notification');
const Donation = require('../models/Donation');
const { calculateHaversineDistance, formatDistance, isValidCoordinates } = require('../utils/geoDistance');
const { getCompatibleDonorBloodGroups, isBloodCompatible, BLOOD_GROUPS } = require('../utils/bloodCompatibility');
const { DOCUMENT_DIR } = require('../middleware/uploadMiddleware');
const {
  sendEmergencyBloodAlert,
  sendRequestAcceptedAlert,
  sendRequestCancelledAlert,
  sendDonationFulfilledAlert
} = require('../config/email');
const { getNextEscalationDetails } = require('../services/escalationService');

/**
 * Create a new emergency blood request & trigger targeted notifications
 * POST /api/requests
 */
async function createRequest(req, res, next) {
  try {
    const {
      patientName,
      patientAge,
      requiredBloodGroup,
      unitsRequired,
      hospitalName,
      hospitalAddress,
      coordinates, // [longitude, latitude]
      searchRadiusKm = 15,
      urgency = 'Urgent',
      contactPhone,
      contactEmail,
      medicalCondition,
      requiredByDate
    } = req.body;

    // Validation
    const missing = [];
    if (!patientName || !String(patientName).trim()) missing.push('patientName');
    if (!requiredBloodGroup || !String(requiredBloodGroup).trim()) missing.push('requiredBloodGroup');
    if (unitsRequired === undefined || unitsRequired === null || String(unitsRequired).trim() === '') missing.push('unitsRequired');
    if (!hospitalName || !String(hospitalName).trim()) missing.push('hospitalName');
    if (!hospitalAddress || !String(hospitalAddress).trim()) missing.push('hospitalAddress');
    if (!contactPhone || !String(contactPhone).trim()) missing.push('contactPhone');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: missing.length === 1
          ? `Please fill mandatory field: ${missing[0]}.`
          : `Please fill all mandatory fields: ${missing.join(', ')}.`,
        missingFields: missing
      });
    }

    if (!BLOOD_GROUPS.includes(requiredBloodGroup)) {
      return res.status(400).json({
        success: false,
        message: `Invalid blood group. Must be one of: ${BLOOD_GROUPS.join(', ')}`
      });
    }

    const units = Number(unitsRequired);
    if (!Number.isInteger(units) || units < 1 || units > 20) {
      return res.status(400).json({
        success: false,
        message: 'Units required must be a valid positive integer between 1 and 20.'
      });
    }

    if (patientAge !== undefined && patientAge !== null && String(patientAge).trim() !== '') {
      const age = Number(patientAge);
      if (isNaN(age) || age < 0 || age > 120) {
        return res.status(400).json({
          success: false,
          message: 'Patient age must be between 0 and 120 years.'
        });
      }
    }

    const validUrgencies = ['Normal', 'Urgent', 'Critical'];
    if (urgency && !validUrgencies.includes(urgency)) {
      return res.status(400).json({
        success: false,
        message: `Invalid urgency level. Must be one of: ${validUrgencies.join(', ')}`
      });
    }

    let initialRadius = 15;
    if (searchRadiusKm !== undefined && searchRadiusKm !== null && String(searchRadiusKm).trim() !== '') {
      initialRadius = Number(searchRadiusKm);
      if (isNaN(initialRadius) || initialRadius < 1 || initialRadius > 150) {
        return res.status(400).json({
          success: false,
          message: 'Invalid search radius. Radius must be a valid number between 1 and 150 km.'
        });
      }
    }

    const phoneClean = String(contactPhone).trim();
    if (!/^\+?[0-9\s\-]{7,15}$/.test(phoneClean)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid contact mobile number (7-15 digits).'
      });
    }

    if (!coordinates) {
      return res.status(400).json({
        success: false,
        message: 'Accurate geographic coordinates [longitude, latitude] for hospital/pickup point are required.'
      });
    }

    let parsedCoords = coordinates;
    if (typeof coordinates === 'string') {
      try {
        parsedCoords = JSON.parse(coordinates);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid coordinates format.' });
      }
    }

    if (!isValidCoordinates(parsedCoords)) {
      return res.status(400).json({
        success: false,
        message: 'Accurate geographic coordinates [longitude, latitude] for hospital/pickup point are required.'
      });
    }

    // Duplicate submission check: prevent rapid duplicate submission within 60s
    const recentDuplicate = await BloodRequest.findOne({
      requesterId: req.user._id,
      patientName: patientName.trim(),
      hospitalName: hospitalName.trim(),
      requiredBloodGroup,
      requestStatus: 'open',
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) }
    });

    if (recentDuplicate) {
      return res.status(409).json({
        success: false,
        message: 'A matching emergency blood request was recently submitted. Please wait before retrying to prevent duplicate broadcasts.',
        request: recentDuplicate
      });
    }

    const { nextTier, nextEscalationAt } = getNextEscalationDetails(new Date(), initialRadius);

    // Process attached medical documents
    const medicalDocuments = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        medicalDocuments.push({
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          path: file.path,
          uploadedAt: new Date()
        });
      }
    }

    // Create BloodRequest in MongoDB
    const requestDoc = await BloodRequest.create({
      requesterId: req.user._id,
      patientName: patientName.trim(),
      patientAge: Number(patientAge) || 30,
      requiredBloodGroup,
      unitsRequired: units,
      hospitalName: hospitalName.trim(),
      hospitalAddress: hospitalAddress.trim(),
      location: {
        type: 'Point',
        coordinates: parsedCoords
      },
      searchRadiusKm: initialRadius,
      radiusHistory: [
        {
          radiusKm: initialRadius,
          triggeredAt: new Date(),
          donorsNotified: 0
        }
      ],
      nextEscalationAt: nextTier ? nextEscalationAt : null,
      urgency,
      requiredByDate: requiredByDate ? new Date(requiredByDate) : new Date(Date.now() + 24 * 60 * 60 * 1000),
      contactPhone: phoneClean,
      contactEmail: (contactEmail || req.user.email).trim().toLowerCase(),
      medicalCondition: (medicalCondition || '').trim(),
      medicalDocuments,
      requestStatus: 'open'
    });

    // Increment requester's request count
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalRequests: 1 } });

    // Diagnostics (Phase 7)
    console.log(`[Emergency Request] Received request for patient: "${patientName.trim()}" (${requiredBloodGroup}, ${units} unit(s)) at "${hospitalName.trim()}".`);
    console.log(`[Emergency Request] Coordinates validated: [${parsedCoords[0]}, ${parsedCoords[1]}], Search radius: ${initialRadius} km.`);
    console.log(`[Emergency Request] Request successfully persisted. ID: ${requestDoc._id}`);

    // TARGETED MATCHING & IMMEDIATE NOTIFICATION ENGINE
    // Step 1: Find medically compatible donor blood groups
    const compatibleGroups = getCompatibleDonorBloodGroups(requiredBloodGroup);

    // Step 2: Query active & medically eligible donors within circular distance
    // Clinical cooldown: exclude donors who donated within the last 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const radiusRadians = (initialRadius * 1.05) / 6371.0088;
    const donorCandidates = await User.find({
      _id: { $ne: req.user._id },
      status: { $ne: 'suspended' },
      isBlocked: { $ne: true },
      isDeleted: { $ne: true },
      isAvailableToDonate: true,
      bloodGroup: { $in: compatibleGroups },
      email: { $exists: true, $regex: /^\S+@\S+\.\S+$/ },
      $or: [
        { lastDonationDate: null },
        { lastDonationDate: { $exists: false } },
        { lastDonationDate: { $lte: ninetyDaysAgo } }
      ],
      location: {
        $geoWithin: {
          $centerSphere: [parsedCoords, radiusRadians]
        }
      }
    }).select('name email phone bloodGroup location lastDonationDate');

    // Step 3: Exact Haversine verification (strict circular boundary: distance <= initialRadius)
    const eligibleDonors = [];
    for (const donor of donorCandidates) {
      if (donor.location && isValidCoordinates(donor.location.coordinates)) {
        const distKm = calculateHaversineDistance(parsedCoords, donor.location.coordinates);
        const roundedDist = Math.round(distKm * 100) / 100;

        if (roundedDist <= initialRadius) {
          eligibleDonors.push({
            donor,
            distanceKm: roundedDist
          });
        }
      }
    }

    console.log(`[Emergency Request] Compatible blood groups: ${compatibleGroups.join(', ')}`);
    console.log(`[Emergency Request] Candidates found in radius buffer: ${donorCandidates.length}, Strictly eligible donors: ${eligibleDonors.length}`);

    // Step 4: Dispatch in-app notifications and background emails
    const io = req.app.get('io');
    let notifiedCount = 0;
    let attemptedCount = 0;
    let acceptedCount = 0;
    let failedCount = 0;
    const dispatchFailures = [];
    const emailPromises = [];

    for (const { donor, distanceKm } of eligibleDonors) {
      try {
        // Prevent duplicate notification for same donor and request
        let isNewNotification = false;
        let notification = await Notification.findOne({
          recipientId: donor._id,
          requestId: requestDoc._id,
          type: 'NEW_BLOOD_REQUEST'
        });

        if (!notification) {
          notification = await Notification.create({
            recipientId: donor._id,
            type: 'NEW_BLOOD_REQUEST',
            requestId: requestDoc._id,
            title: `🚨 Urgent Blood Alert: ${requiredBloodGroup} Required (${urgency})`,
            message: `${patientName.trim()} urgently needs ${units} unit(s) of ${requiredBloodGroup} blood at ${hospitalName.trim()} (~${distanceKm.toFixed(1)} km away).`,
            urgency,
            isRead: false
          });
          isNewNotification = true;
        }

        // Prevent duplicate socket alert and email dispatch if already notified
        if (!isNewNotification && notification.emailSent) {
          continue;
        }

        // Real-time WebSocket event to donor's personal room
        if (io) {
          io.to(`user_${donor._id}`).emit('new_emergency_request', {
            notification,
            request: requestDoc,
            distanceKm
          });
        }

        attemptedCount++;

        // Email notification dispatch (individual, privacy-preserving delivery)
        const dispatchPromise = sendEmergencyBloodAlert(donor, requestDoc, distanceKm)
          .then(async (emailRes) => {
            if (emailRes.success) {
              acceptedCount++;
            } else {
              failedCount++;
              dispatchFailures.push({
                donorId: donor._id,
                email: donor.email,
                reason: emailRes.error || 'SMTP delivery rejected'
              });
            }

            await Notification.findByIdAndUpdate(notification._id, {
              emailSent: emailRes.success,
              emailStatus: emailRes.success ? 'sent' : 'failed',
              emailError: emailRes.error || '',
              emailPreviewUrl: emailRes.previewUrl || null,
              emailHtml: emailRes.html || null,
              emailText: emailRes.text || null
            });

            if (io) {
              io.to(`user_${donor._id}`).emit('notification_updated', {
                notificationId: notification._id,
                emailSent: emailRes.success,
                emailStatus: emailRes.success ? 'sent' : 'failed',
                emailPreviewUrl: emailRes.previewUrl || null
              });
            }
            return emailRes;
          })
          .catch((err) => {
            failedCount++;
            dispatchFailures.push({
              donorId: donor._id,
              email: donor.email,
              reason: err.message
            });
            console.error(`Email dispatch error for donor ${donor._id}:`, err.message);
            return { success: false, error: err.message };
          });

        emailPromises.push(dispatchPromise);
        notifiedCount++;
      } catch (notifErr) {
        console.error(`Error notifying donor ${donor._id}:`, notifErr.message);
      }
    }

    // Await all parallel email dispatches so email status is fully settled
    if (emailPromises.length > 0) {
      await Promise.allSettled(emailPromises);
    }

    console.log(`[Emergency Request] Notification Summary for Request ${requestDoc._id}:`);
    console.log(`   - Eligible Donors Matched: ${eligibleDonors.length}`);
    console.log(`   - In-App Alerts Created: ${notifiedCount}`);
    console.log(`   - Emails Dispatched/Attempted: ${attemptedCount}`);
    console.log(`   - Accepted by SMTP Provider: ${acceptedCount}`);
    console.log(`   - SMTP Delivery Failures: ${failedCount}`);
    if (dispatchFailures.length > 0) {
      console.log(`   - Failure Details:`, dispatchFailures.map(f => `${f.email}: ${f.reason}`).join('; '));
    }

    // Update notified count on the request and initial tier history
    requestDoc.notifiedDonorsCount = notifiedCount;
    if (requestDoc.radiusHistory && requestDoc.radiusHistory.length > 0) {
      requestDoc.radiusHistory[0].donorsNotified = notifiedCount;
    }
    await requestDoc.save();

    const responseMessage = notifiedCount > 0
      ? `Emergency blood request created. Successfully matched and alerted ${notifiedCount} eligible donor(s) within ${initialRadius} km.`
      : `Emergency blood request created. No matching eligible donors found within ${initialRadius} km at this time.`;

    res.status(201).json({
      success: true,
      message: responseMessage,
      request: requestDoc,
      notifiedDonorsCount: notifiedCount,
      emailDiagnostics: {
        eligibleMatched: eligibleDonors.length,
        attempted: attemptedCount,
        accepted: acceptedCount,
        failed: failedCount
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get all blood requests with smart priority feed sorting
 * GET /api/requests
 */
async function getRequests(req, res, next) {
  try {
    const { status, bloodGroup, urgency } = req.query;

    const filter = {};
    if (status) filter.requestStatus = status;
    if (bloodGroup) filter.requiredBloodGroup = bloodGroup;
    if (urgency) filter.urgency = urgency;

    const requests = await BloodRequest.find(filter)
      .populate('requesterId', 'name username phone bloodGroup avatar')
      .populate('acceptedDonors.donorId', 'name username phone bloodGroup')
      .sort({ createdAt: -1 })
      .lean();

    // User's registered location for distance calculation
    const userLocation = req.user && req.user.location ? req.user.location.coordinates : null;
    const userBloodGroup = req.user ? req.user.bloodGroup : null;

    const priorityRequests = [];
    const communityRequests = [];

    for (const reqItem of requests) {
      let distanceKm = null;
      let isCompatible = false;
      let isWithinSearchRadius = false;

      if (
        userLocation &&
        isValidCoordinates(userLocation) &&
        reqItem.location &&
        isValidCoordinates(reqItem.location.coordinates)
      ) {
        distanceKm = Math.round(calculateHaversineDistance(userLocation, reqItem.location.coordinates) * 100) / 100;
        isWithinSearchRadius = distanceKm <= (reqItem.searchRadiusKm || 15);
      }

      if (userBloodGroup && reqItem.requiredBloodGroup) {
        // Can current user donate to this patient?
        isCompatible = isBloodCompatible(userBloodGroup, reqItem.requiredBloodGroup);
      }

      const enrichedItem = {
        ...reqItem,
        distanceKm,
        formattedDistance: distanceKm !== null ? formatDistance(distanceKm) : null,
        isCompatible,
        isWithinSearchRadius
      };

      // Priority criteria: compatible blood group AND within circular radius AND open status
      if (enrichedItem.requestStatus === 'open' && isCompatible && isWithinSearchRadius) {
        priorityRequests.push(enrichedItem);
      } else {
        communityRequests.push(enrichedItem);
      }
    }

    res.json({
      success: true,
      count: requests.length,
      priorityRequests,
      communityRequests,
      allRequests: [...priorityRequests, ...communityRequests]
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get single blood request details
 * GET /api/requests/:id
 */
async function getRequestById(req, res, next) {
  try {
    const request = await BloodRequest.findById(req.params.id)
      .populate('requesterId', 'name username phone email bloodGroup avatar address city')
      .populate('primaryDonor', 'name username phone email bloodGroup avatar')
      .populate('acceptedDonors.donorId', 'name username phone bloodGroup avatar');

    if (!request) {
      return res.status(404).json({ success: false, message: 'Blood request not found' });
    }

    let distanceKm = null;
    if (
      req.user &&
      req.user.location &&
      isValidCoordinates(req.user.location.coordinates) &&
      request.location &&
      isValidCoordinates(request.location.coordinates)
    ) {
      distanceKm = Math.round(calculateHaversineDistance(req.user.location.coordinates, request.location.coordinates) * 100) / 100;
    }

    res.json({
      success: true,
      request,
      distanceKm,
      formattedDistance: distanceKm !== null ? formatDistance(distanceKm) : null
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Accept blood request (pledge donation)
 * PUT /api/requests/:id/accept
 */
async function acceptRequest(req, res, next) {
  try {
    const request = await BloodRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Blood request not found.' });
    }

    if (request.requestStatus !== 'open') {
      return res.status(400).json({
        success: false,
        message: `This blood request is already ${request.requestStatus}.`
      });
    }

    if (request.requesterId.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot accept your own blood request.'
      });
    }

    // Check donor account status and availability
    if (req.user.isBlocked || req.user.status !== 'active' || req.user.isAvailableToDonate === false) {
      return res.status(403).json({
        success: false,
        message: 'Your donor account is not currently active or available to accept requests.'
      });
    }

    // Check strict ABO/Rh blood compatibility
    if (!isBloodCompatible(req.user.bloodGroup, request.requiredBloodGroup)) {
      return res.status(400).json({
        success: false,
        message: `Incompatible blood group. Your blood group (${req.user.bloodGroup}) cannot donate to a patient requiring ${request.requiredBloodGroup}.`
      });
    }

    // Check if user already accepted
    const alreadyAccepted = request.acceptedDonors.some(
      (d) => d.donorId && d.donorId.toString() === req.user._id.toString()
    );
    if (alreadyAccepted) {
      return res.status(400).json({
        success: false,
        message: 'You have already accepted this blood request.'
      });
    }

    // Atomically transition request from open to accepted to eliminate race conditions
    const updatedRequest = await BloodRequest.findOneAndUpdate(
      { _id: req.params.id, requestStatus: 'open' },
      {
        $set: {
          requestStatus: 'accepted',
          nextEscalationAt: null,
          primaryDonor: req.user._id
        },
        $push: {
          acceptedDonors: {
            donorId: req.user._id,
            acceptedAt: new Date(),
            pledgedUnits: 1
          }
        }
      },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(400).json({
        success: false,
        message: 'This blood request was already accepted by another donor.'
      });
    }

    // Notify the requester
    const requester = await User.findById(updatedRequest.requesterId);
    const notification = await Notification.create({
      recipientId: updatedRequest.requesterId,
      type: 'REQUEST_ACCEPTED',
      requestId: updatedRequest._id,
      title: `✅ Donor Accepted: ${req.user.name} stepped forward!`,
      message: `${req.user.name} (${req.user.bloodGroup}) accepted your request for patient ${updatedRequest.patientName}. You can now chat in the LifeLink app.`,
      urgency: 'Normal',
      isRead: false
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${updatedRequest.requesterId}`).emit('request_accepted', {
        notification,
        donor: req.user,
        requestId: updatedRequest._id
      });
    }

    // Email notification to requester
    if (requester) {
      try {
        const emailRes = await sendRequestAcceptedAlert(requester, req.user, updatedRequest);
        await Notification.findByIdAndUpdate(notification._id, {
          emailSent: emailRes.success,
          emailStatus: emailRes.success ? 'sent' : 'failed',
          emailError: emailRes.error || '',
          emailPreviewUrl: emailRes.previewUrl || null,
          emailHtml: emailRes.html || null
        });
        if (io) {
          io.to(`user_${updatedRequest.requesterId}`).emit('notification_updated', {
            notificationId: notification._id,
            emailSent: emailRes.success,
            emailStatus: emailRes.success ? 'sent' : 'failed',
            emailPreviewUrl: emailRes.previewUrl || null
          });
        }
      } catch (err) {
        console.error('Accept email dispatch error:', err.message);
      }
    }

    res.json({
      success: true,
      message: 'Thank you for stepping forward! You are now connected with the requester.',
      request: updatedRequest
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Reject / withdraw pledge for a blood request
 * PUT /api/requests/:id/reject
 */
async function rejectRequest(req, res, next) {
  try {
    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const isRequester = request.requesterId.toString() === req.user._id.toString();
    const isAcceptedDonor = request.acceptedDonors.some(
      (d) => d.donorId && d.donorId.toString() === req.user._id.toString()
    );
    const isAdmin = req.user.role === 'admin';

    if (!isRequester && !isAcceptedDonor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only an accepted donor, the requester, or an administrator can reject/withdraw from this request.'
      });
    }

    const reason = req.body.reason || 'Donation pledge declined/withdrawn';

    if (isAcceptedDonor) {
      // Donor withdraws pledge
      request.acceptedDonors = request.acceptedDonors.filter(
        (d) => d.donorId && d.donorId.toString() !== req.user._id.toString()
      );
      if (request.primaryDonor && request.primaryDonor.toString() === req.user._id.toString()) {
        request.primaryDonor = request.acceptedDonors.length > 0 ? request.acceptedDonors[0].donorId : null;
      }
      if (request.acceptedDonors.length === 0) {
        request.requestStatus = 'open';
      }
      await request.save();

      // Notify requester
      await Notification.create({
        recipientId: request.requesterId,
        type: 'REQUEST_REJECTED',
        requestId: request._id,
        title: '⚠️ Donor Withdrew Pledge',
        message: `Donor ${req.user.name} withdrew their pledge for patient ${request.patientName}. The request has been reopened for other donors.`
      });

      return res.json({
        success: true,
        message: 'You have withdrawn from this donation request. The request has been reopened for other donors.',
        request
      });
    } else if (isRequester || isAdmin) {
      if (request.requestStatus === 'open') {
        request.requestStatus = 'rejected';
        request.rejectedReason = reason;
        request.nextEscalationAt = null;
        await request.save();

        return res.json({
          success: true,
          message: 'Blood request has been marked as rejected.',
          request
        });
      } else {
        const { donorId } = req.body;
        if (donorId) {
          request.acceptedDonors = request.acceptedDonors.filter(
            (d) => d.donorId && d.donorId.toString() !== donorId.toString()
          );
          if (request.primaryDonor && request.primaryDonor.toString() === donorId.toString()) {
            request.primaryDonor = request.acceptedDonors.length > 0 ? request.acceptedDonors[0].donorId : null;
          }
          if (request.acceptedDonors.length === 0) {
            request.requestStatus = 'open';
          }
          await request.save();

          // Notify rejected donor
          await Notification.create({
            recipientId: donorId,
            type: 'REQUEST_REJECTED',
            requestId: request._id,
            title: 'ℹ️ Donation Pledge Declined',
            message: `Your donation pledge for patient ${request.patientName} was declined by the requester/coordinator.`
          });

          return res.json({
            success: true,
            message: 'Donor pledge removed and request reopened.',
            request
          });
        }
      }
    }

    return res.status(400).json({ success: false, message: 'Invalid reject operation.' });
  } catch (err) {
    next(err);
  }
}

/**
 * Fulfill a blood request & issue digital certificate
 * PUT /api/requests/:id/fulfill
 */
async function fulfillRequest(req, res, next) {
  try {
    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    // Only requester or admin can mark fulfilled
    const isRequester = request.requesterId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isRequester && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the requester or an administrator can mark a request as fulfilled.'
      });
    }

    request.requestStatus = 'fulfilled';
    request.nextEscalationAt = null;
    request.fulfilledAt = new Date();
    request.unitsFulfilled = request.unitsRequired;
    await request.save();

    // Create official donation records & update donor stats for all accepted donors
    const donorIds = request.acceptedDonors.map((d) => d.donorId).filter(Boolean);
    const certificates = [];

    for (const dId of donorIds) {
      const certificateId = Donation.generateCertificateId();
      const verificationCode = Math.random().toString(36).substring(2, 10).toUpperCase();

      const donation = await Donation.create({
        donorId: dId,
        requestId: request._id,
        recipientId: request.requesterId,
        patientName: request.patientName,
        hospitalName: request.hospitalName,
        hospitalAddress: request.hospitalAddress,
        bloodGroup: request.requiredBloodGroup,
        unitsDonated: 1,
        donationDate: new Date(),
        certificateId,
        verificationCode
      });

      // Update donor stats
      await User.findByIdAndUpdate(dId, {
        $inc: { totalDonations: 1 },
        lastDonationDate: new Date()
      });

      // Send in-app notification with certificate
      const notif = await Notification.create({
        recipientId: dId,
        type: 'DONATION_FULFILLED',
        requestId: request._id,
        title: '🎖️ Blood Donation Fulfilled! Certificate Issued',
        message: `Your donation for patient ${request.patientName} at ${request.hospitalName} has been verified and fulfilled. Your LifeLink Certificate ID is ${certificateId}.`,
        urgency: 'Normal'
      });

      const donorUser = await User.findById(dId);
      if (donorUser) {
        sendDonationFulfilledAlert(donorUser, request, donation).then(async (emailRes) => {
          await Notification.findByIdAndUpdate(notif._id, {
            emailSent: emailRes.success,
            emailStatus: emailRes.success ? 'sent' : 'failed',
            emailError: emailRes.error || '',
            emailPreviewUrl: emailRes.previewUrl || null,
            emailHtml: emailRes.html || null
          });
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${dId}`).emit('notification_updated', {
              notificationId: notif._id,
              emailSent: emailRes.success,
              emailStatus: emailRes.success ? 'sent' : 'failed',
              emailPreviewUrl: emailRes.previewUrl || null
            });
          }
        }).catch(() => {});
      }

      certificates.push(donation);
    }

    res.json({
      success: true,
      message: 'Blood request marked as fulfilled. Official donation records and appreciation certificates have been generated.',
      request,
      certificates
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Cancel blood request
 * PUT /api/requests/:id/cancel
 */
async function cancelRequest(req, res, next) {
  try {
    const { reason = 'Cancelled by user' } = req.body;
    const request = await BloodRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const isRequester = request.requesterId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isRequester && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the requester or an administrator can cancel this request.'
      });
    }

    request.requestStatus = 'cancelled';
    request.cancelledReason = reason;
    request.nextEscalationAt = null;
    await request.save();

    // Notify any accepted donors that request has been cancelled
    for (const donor of request.acceptedDonors) {
      if (donor.donorId) {
        const notif = await Notification.create({
          recipientId: donor.donorId,
          type: 'REQUEST_CANCELLED',
          requestId: request._id,
          title: 'ℹ️ Blood Request Cancelled',
          message: `The blood request for patient ${request.patientName} at ${request.hospitalName} has been cancelled by the requester.`
        }).catch(() => null);

        const donorUser = await User.findById(donor.donorId);
        if (notif && donorUser) {
          sendRequestCancelledAlert(donorUser, req.user, request, reason).then(async (emailRes) => {
            await Notification.findByIdAndUpdate(notif._id, {
              emailSent: emailRes.success,
              emailStatus: emailRes.success ? 'sent' : 'failed',
              emailError: emailRes.error || '',
              emailPreviewUrl: emailRes.previewUrl || null,
              emailHtml: emailRes.html || null
            });
            const io = req.app.get('io');
            if (io) {
              io.to(`user_${donor.donorId}`).emit('notification_updated', {
                notificationId: notif._id,
                emailSent: emailRes.success,
                emailStatus: emailRes.success ? 'sent' : 'failed',
                emailPreviewUrl: emailRes.previewUrl || null
              });
            }
          }).catch(() => {});
        }
      }
    }

    res.json({
      success: true,
      message: 'Blood request has been cancelled.',
      request
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Securely access/download a medical document
 * GET /api/requests/:id/documents/:filename
 * STRICT AUTHORIZATION: Requester, Accepted Donors, or Admin only.
 */
async function downloadMedicalDocument(req, res, next) {
  try {
    const { id, filename } = req.params;

    const request = await BloodRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Access control verification
    const isRequester = request.requesterId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    const isAcceptedDonor = request.acceptedDonors.some(
      (d) => d.donorId && d.donorId.toString() === req.user._id.toString()
    );

    if (!isRequester && !isAdmin && !isAcceptedDonor) {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: You are not authorized to view confidential medical records for this patient.'
      });
    }

    // Find the document record
    const docMeta = request.medicalDocuments.find((d) => d.filename === filename);
    const filePath = path.join(DOCUMENT_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Medical document file not found on server.' });
    }

    // Serve file with proper content-type
    res.setHeader('Content-Type', docMeta ? docMeta.mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${docMeta ? docMeta.originalName : filename}"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRequest,
  getRequests,
  getRequestById,
  acceptRequest,
  rejectRequest,
  fulfillRequest,
  cancelRequest,
  downloadMedicalDocument
};
