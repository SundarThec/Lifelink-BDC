const mongoose = require('mongoose');

let mongodInstance = null;

/**
 * Connect to MongoDB database
 * Tries the configured MONGODB_URI first; if that fails (e.g., local mongod service not running),
 * automatically spins up a real MongoMemoryServer daemon to execute 100% genuine MongoDB operations.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lifelink_pro';

  // Connection event listeners
  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected.');
  });
  mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected successfully.');
  });

  try {
    console.log(`🔌 Attempting MongoDB connection to: ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: process.env.MONGODB_URI ? 15000 : 3000
    });
    console.log(`✅ Connected to MongoDB at: ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
  } catch (primaryError) {
    console.warn(`⚠️ Direct MongoDB connection failed (${primaryError.message}).`);
    console.log(`🚀 Starting embedded MongoDB engine (MongoMemoryServer)...`);
    
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      mongodInstance = await MongoMemoryServer.create({
        binary: {
          version: '4.4.18'
        },
        instance: {
          dbName: 'lifelink_pro'
        }
      });
      const memoryUri = mongodInstance.getUri();
      console.log(`⚡ Embedded MongoDB daemon active at: ${memoryUri}`);

      await mongoose.connect(memoryUri);
      console.log(`✅ Connected to embedded MongoDB successfully.`);
    } catch (embeddedError) {
      console.warn(`⚠️ Embedded MongoDB engine unavailable (${embeddedError.message}).`);
      console.log('💡 Tip: Ensure MongoDB service is running (e.g. net start MongoDB) or set MONGODB_URI in .env.');
    }
  }

  // Ensure 2dsphere and unique indexes are synced
  try {
    const User = require('../models/User');
    const { BloodRequest } = require('../models/BloodRequest');
    const Donation = require('../models/Donation');
    const { Notification } = require('../models/Notification');
    const ChatMessage = require('../models/ChatMessage');

    await Promise.all([
      User.syncIndexes(),
      BloodRequest.syncIndexes(),
      Donation.syncIndexes(),
      Notification.syncIndexes(),
      ChatMessage.syncIndexes()
    ]);
    console.log(`📍 Geospatial 2dsphere and database indexes synchronized.`);
  } catch (idxErr) {
    console.warn(`Notice on index sync: ${idxErr.message}`);
  }
}

/**
 * Gracefully disconnect from database
 */
async function disconnectDB() {
  await mongoose.disconnect();
  if (mongodInstance) {
    await mongodInstance.stop();
  }
}

module.exports = {
  connectDB,
  disconnectDB
};
