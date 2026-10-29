const { BloodRequest } = require('../models/BloodRequest');
const User = require('../models/User');
const { Notification } = require('../models/Notification');
const { getCompatibleDonorBloodGroups } = require('../utils/bloodCompatibility');
const { calculateHaversineDistance } = require('../utils/geoDistance');
const { sendEmergencyBloodAlert } = require('../config/email');

/**
 * Parse escalation tiers from environment variable or defaults
 * Format: radiusKm:hoursElapsed,radiusKm:hoursElapsed,...
 * Default: 5:0,10:1,50:2
 */
function getEscalationTiers() {
  const envStr = process.env.ESCALATION_TIERS || '5:0,10:1,50:2';
  try {
    const tiers = envStr
      .split(',')
      .map((part) => {
        const [r, h] = part.trim().split(':');
        return {
          radiusKm: parseFloat(r),
          hours: parseFloat(h)
        };
      })
      .filter((t) => !isNaN(t.radiusKm) && !isNaN(t.hours))
      .sort((a, b) => a.hours - b.hours);

    return tiers.length > 0 ? tiers : [{ radiusKm: 5, hours: 0 }, { radiusKm: 10, hours: 1 }, { radiusKm: 50, hours: 2 }];
  } catch (err) {
    return [{ radiusKm: 5, hours: 0 }, { radiusKm: 10, hours: 1 }, { radiusKm: 50, hours: 2 }];
  }
}

/**
 * Calculate the next escalation timestamp and next radius tier for a request
 * @param {Date} createdAt
 * @param {number} currentRadius
 * @returns {{ nextTier: object|null, nextEscalationAt: Date|null }}
 */
function getNextEscalationDetails(createdAt, currentRadius) {
  const tiers = getEscalationTiers();
  const createdTime = new Date(createdAt).getTime();

  // Find next tier whose radius is strictly greater than currentRadius
  const nextTier = tiers.find((t) => t.radiusKm > currentRadius);
  if (!nextTier) {
    return { nextTier: null, nextEscalationAt: null };
  }

  const nextEscalationAt = new Date(createdTime + nextTier.hours * 60 * 60 * 1000);
  return { nextTier, nextEscalationAt };
}

/**
 * Execute a single cycle of radius escalation
 * @param {object} io - Socket.IO instance
 */
async function runEscalationCycle(io) {
  try {
    const now = new Date();

    // Query active unfilled requests ready for radius expansion
    const requests = await BloodRequest.find({
      requestStatus: 'open',
      nextEscalationAt: { $ne: null, $lte: now }
    }).populate('requesterId', 'name email phone');

    if (!requests || requests.length === 0) {
      return { checked: 0, escalated: 0 };
    }

    let escalatedCount = 0;

    for (const request of requests) {
      try {
        const tiers = getEscalationTiers();
        const oldRadius = request.searchRadiusKm || 5;

        // Find the next tier
        const nextTier = tiers.find((t) => t.radiusKm > oldRadius);
        if (!nextTier) {
          // No further tiers; stop escalation
          request.nextEscalationAt = null;
          await request.save();
          continue;
        }

        const newRadius = nextTier.radiusKm;
        const coords = request.location.coordinates; // [lng, lat]
        const compatibleGroups = getCompatibleDonorBloodGroups(request.requiredBloodGroup);

        // Fetch already notified donors to avoid duplicate notifications
        const alreadyNotified = await Notification.find({
          requestId: request._id,
          type: 'NEW_BLOOD_REQUEST'
        }).distinct('recipientId');

        const alreadyNotifiedSet = new Set(alreadyNotified.map((id) => id.toString()));

        // Query donors in expanded radius
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const radiusRadians = newRadius / 6378.137;
        const candidates = await User.find({
          _id: {
            $ne: request.requesterId?._id || request.requesterId,
            $nin: Array.from(alreadyNotifiedSet)
          },
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
              $centerSphere: [coords, radiusRadians]
            }
          }
        }).select('name email phone bloodGroup location lastDonationDate');

        // Fine-grained Haversine verification
        const newlyEligible = [];
        for (const donor of candidates) {
          if (donor.location && donor.location.coordinates) {
            const distKm = calculateHaversineDistance(coords, donor.location.coordinates);
            const roundedDist = Math.round(distKm * 100) / 100;
            if (roundedDist <= newRadius) {
              newlyEligible.push({ donor, distanceKm: roundedDist });
            }
          }
        }

        // Notify new ring donors
        let newlyNotifiedCount = 0;
        const emailPromises = [];

        for (const { donor, distanceKm } of newlyEligible) {
          try {
            const notification = await Notification.create({
              recipientId: donor._id,
              type: 'NEW_BLOOD_REQUEST',
              requestId: request._id,
              title: `🚨 Urgent Blood Alert: ${request.requiredBloodGroup} (${request.urgency})`,
              message: `${request.patientName} urgently needs ${request.unitsRequired} unit(s) of ${request.requiredBloodGroup} blood at ${request.hospitalName} (~${distanceKm.toFixed(1)} km away). Broadcast expanded to ${newRadius} km.`,
              urgency: request.urgency,
              isRead: false
            });

            if (io) {
              io.to(`user_${donor._id}`).emit('new_emergency_request', {
                notification,
                request,
                distanceKm,
                escalated: true,
                radiusKm: newRadius
              });
            }

            const dispatchPromise = sendEmergencyBloodAlert(donor, request, distanceKm).then(async (emailRes) => {
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
            }).catch((err) => {
              console.error(`Escalation email error for donor ${donor._id}:`, err.message);
              return { success: false, error: err.message };
            });

            emailPromises.push(dispatchPromise);
            newlyNotifiedCount++;
          } catch (notifErr) {
            console.error(`Error notifying donor ${donor._id}:`, notifErr.message);
          }
        }

        if (emailPromises.length > 0) {
          await Promise.allSettled(emailPromises);
        }

        // Update request record
        request.searchRadiusKm = newRadius;
        if (!request.radiusHistory) request.radiusHistory = [];
        request.radiusHistory.push({
          radiusKm: newRadius,
          triggeredAt: now,
          donorsNotified: newlyNotifiedCount
        });
        request.notifiedDonorsCount = (request.notifiedDonorsCount || 0) + newlyNotifiedCount;

        // Determine if there is a subsequent tier
        const { nextTier: subsequentTier, nextEscalationAt } = getNextEscalationDetails(
          request.createdAt,
          newRadius
        );
        request.nextEscalationAt = subsequentTier ? nextEscalationAt : null;

        await request.save();
        escalatedCount++;

        console.log(
          `📡 [Radius Escalation] Request ${request._id} expanded: ${oldRadius} km -> ${newRadius} km. Notified ${newlyNotifiedCount} new donor(s).`
        );

        if (io) {
          io.to(`request_${request._id}`).emit('radius_escalated', {
            requestId: request._id,
            searchRadiusKm: newRadius,
            radiusHistory: request.radiusHistory,
            nextEscalationAt: request.nextEscalationAt,
            newlyNotifiedCount
          });
          io.emit('request_updated', request);
        }
      } catch (reqErr) {
        console.error(`Error escalating request ${request._id}:`, reqErr.message);
      }
    }

    return { checked: requests.length, escalated: escalatedCount };
  } catch (err) {
    console.error('Error in runEscalationCycle:', err.message);
    return { error: err.message };
  }
}

/**
 * Initialize the cron scheduler
 * @param {object} io
 */
function initEscalationCron(io) {
  let cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    cron = null;
  }

  if (cron && typeof cron.schedule === 'function') {
    // Run every 5 minutes: */5 * * * *
    cron.schedule('*/5 * * * *', () => {
      runEscalationCycle(io);
    });
    console.log('⏱️  Radius Escalation Cron initialized (running every 5 minutes via node-cron).');
  } else {
    // Self-contained fallback scheduler
    setInterval(() => {
      runEscalationCycle(io);
    }, 5 * 60 * 1000);
    console.log('⏱️  Radius Escalation Cron initialized (running every 5 minutes via internal timer).');
  }
}

module.exports = {
  getEscalationTiers,
  getNextEscalationDetails,
  runEscalationCycle,
  initEscalationCron
};
