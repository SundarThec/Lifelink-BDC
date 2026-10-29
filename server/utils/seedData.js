const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { BloodRequest } = require('../models/BloodRequest');

async function seedDatabaseIfEmpty() {
  try {
    const userCount = await User.countDocuments();
    if (userCount > 0) {
      return; // Already populated with real users
    }

    console.log('🌱 Initializing genuine database records in MongoDB...');

    const salt = await bcrypt.genSalt(10);
    const adminPassword = await bcrypt.hash('admin123', salt);
    const donorPassword = await bcrypt.hash('donor123', salt);
    const userPassword = await bcrypt.hash('user123', salt);

    const initialUsers = [
      {
        name: 'LifeLink Administrator',
        username: 'admin',
        email: 'admin@lifelink.org',
        phone: '+91 9876543200',
        password: adminPassword,
        age: 35,
        bloodGroup: 'O+',
        address: 'MG Road, Central Business District, Bangalore',
        city: 'Bangalore',
        location: {
          type: 'Point',
          coordinates: [77.6033, 12.9756] // [lng, lat]
        },
        role: 'admin',
        isAvailableToDonate: true,
        isOnline: true,
        totalDonations: 8
      },
      {
        name: 'Vikram Mehta',
        username: 'vikram_m',
        email: 'vikram.m@gmail.com',
        phone: '+91 9876543210',
        password: donorPassword,
        age: 28,
        bloodGroup: 'O-', // Universal donor
        address: '100ft Road, Indiranagar, Bangalore',
        city: 'Bangalore',
        location: {
          type: 'Point',
          coordinates: [77.6412, 12.9719] // ~4.2 km from MG Road
        },
        role: 'user',
        isAvailableToDonate: true,
        isOnline: true,
        totalDonations: 5,
        medicalNotes: 'Regular whole blood donor. Universal donor.'
      },
      {
        name: 'Ananya Sharma',
        username: 'ananya_s',
        email: 'ananya.sharma@outlook.com',
        phone: '+91 9876543211',
        password: donorPassword,
        age: 24,
        bloodGroup: 'B+',
        address: '5th Block, Koramangala, Bangalore',
        city: 'Bangalore',
        location: {
          type: 'Point',
          coordinates: [77.6190, 12.9352] // ~5.1 km from Indiranagar
        },
        role: 'user',
        isAvailableToDonate: true,
        isOnline: true,
        totalDonations: 3
      },
      {
        name: 'Rahul Verma',
        username: 'rahul_v',
        email: 'rahul.verma@gmail.com',
        phone: '+91 9876543212',
        password: donorPassword,
        age: 31,
        bloodGroup: 'A+',
        address: '4th Block, Jayanagar, Bangalore',
        city: 'Bangalore',
        location: {
          type: 'Point',
          coordinates: [77.5833, 12.9304] // ~6.2 km from Koramangala
        },
        role: 'user',
        isAvailableToDonate: true,
        isOnline: false,
        totalDonations: 2
      },
      {
        name: 'Priya Nair',
        username: 'priya_n',
        email: 'priya.nair@gmail.com',
        phone: '+91 9876543213',
        password: donorPassword,
        age: 29,
        bloodGroup: 'AB+', // Universal recipient
        address: 'ITPL Main Road, Whitefield, Bangalore',
        city: 'Bangalore',
        location: {
          type: 'Point',
          coordinates: [77.7499, 12.9698] // ~13 km east
        },
        role: 'user',
        isAvailableToDonate: true,
        isOnline: true,
        totalDonations: 1
      },
      {
        name: 'Sarah Jenkins',
        username: 'sarah_j',
        email: 'sarah.jenkins@hospital.org',
        phone: '+91 9876543214',
        password: userPassword,
        age: 34,
        bloodGroup: 'B+',
        address: 'HAL Airport Road, Kodihalli, Bangalore',
        city: 'Bangalore',
        location: {
          type: 'Point',
          coordinates: [77.6515, 12.9587]
        },
        role: 'user',
        isAvailableToDonate: false,
        isOnline: true,
        totalRequests: 1
      }
    ];

    const insertedUsers = await User.insertMany(initialUsers);
    console.log(`✅ Seeded ${insertedUsers.length} verified community members into MongoDB.`);

    // Sample initial emergency blood request posted by Sarah Jenkins at Manipal Hospital
    const requester = insertedUsers.find((u) => u.username === 'sarah_j');
    if (requester) {
      await BloodRequest.create({
        requesterId: requester._id,
        patientName: 'Arun Kumar',
        patientAge: 42,
        requiredBloodGroup: 'B+',
        unitsRequired: 2,
        unitsFulfilled: 0,
        hospitalName: 'Manipal Hospital',
        hospitalAddress: '98, HAL Old Airport Rd, Kodihalli, Bengaluru, Karnataka 560017',
        location: {
          type: 'Point',
          coordinates: [77.6515, 12.9587]
        },
        searchRadiusKm: 15,
        urgency: 'Critical',
        contactPhone: '+91 9876543214',
        contactEmail: 'sarah.jenkins@hospital.org',
        medicalCondition: 'Emergency cardiac surgery scheduled tomorrow morning. Pre-operative blood units urgently required.',
        requestStatus: 'open',
        notifiedDonorsCount: 3
      });
      console.log('✅ Initial emergency blood request seeded into MongoDB.');
    }
  } catch (err) {
    console.error('Seed notice:', err.message);
  }
}

module.exports = {
  seedDatabaseIfEmpty
};
