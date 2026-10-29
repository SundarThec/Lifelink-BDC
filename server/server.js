require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_super_secure_jwt_production_secret_key_2026_blood_community';

const { connectDB } = require('./config/db');
const { seedDatabaseIfEmpty } = require('./utils/seedData');
const errorHandler = require('./middleware/errorHandler');
const { createTileMiddleware, FALLBACK_TILE_PNG } = require('./utils/offlineTileFallback');
const { initEscalationCron } = require('./services/escalationService');

// Route imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const requestRoutes = require('./routes/requestRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const chatRoutes = require('./routes/chatRoutes');
const donationRoutes = require('./routes/donationRoutes');
const adminRoutes = require('./routes/adminRoutes');
const geocodeRoutes = require('./routes/geocodeRoutes');
const complaintRoutes = require('./routes/complaintRoutes');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

// Initialize Socket.io for live updates, emergency alerts, and broadcasts
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});
app.set('io', io);

// Global Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend delivery
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
const TILE_DIR = process.env.TILE_DIR
  ? path.resolve(process.env.TILE_DIR)
  : path.join(__dirname, '..', 'public', 'tiles');

app.use(express.static(PUBLIC_DIR));
app.use('/uploads/avatars', express.static(AVATAR_DIR));

// Offline Tile Routes
app.use('/tiles', express.static(TILE_DIR));
app.get('/tiles/fallback.png', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(FALLBACK_TILE_PNG);
});
app.get('/tiles/:z/:x/:y.png', createTileMiddleware(TILE_DIR));

// API Routers (Mount both /api/v1 and /api for full versioning and backward compatibility)
const apiRouter = express.Router();
apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/requests', requestRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/chat', chatRoutes);
apiRouter.use('/donations', donationRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/geocode', geocodeRoutes);
apiRouter.use('/complaints', complaintRoutes);

app.use('/api/v1', apiRouter);
app.use('/api', apiRouter);

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'LifeLink - A Blood Donation Community',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'LifeLink - A Blood Donation Community',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Authenticate socket connections if token provided in handshake
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
  if (token) {
    try {
      const raw = token.startsWith('Bearer ') ? token.slice(7) : token;
      const decoded = jwt.verify(raw, JWT_SECRET);
      socket.user = decoded;
      socket.userId = decoded.id;
    } catch (err) {
      // Allow guest connection, socket.user remains undefined
    }
  }
  next();
});

// Real-Time Socket.IO Connections & Rooms
io.on('connection', (socket) => {
  // Associate user with their personal socket room for targeted alerts & admin broadcasts
  // Enforce authentication & strict room ownership check
  socket.on('register_user', async (data, callback) => {
    let targetUserId = null;
    let token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;

    if (data && typeof data === 'object') {
      targetUserId = data.userId ? data.userId.toString() : null;
      if (data.token) token = data.token;
    } else if (typeof data === 'string') {
      targetUserId = data;
    }

    let verifiedUser = socket.user;
    if (!verifiedUser && token) {
      try {
        const raw = token.startsWith('Bearer ') ? token.slice(7) : token;
        verifiedUser = jwt.verify(raw, JWT_SECRET);
      } catch (e) {
        verifiedUser = null;
      }
    }

    if (!verifiedUser || !verifiedUser.id) {
      socket.emit('registration_error', {
        message: 'Authentication token required to register for user notifications.'
      });
      if (typeof callback === 'function') callback({ success: false, message: 'Unauthorized' });
      return;
    }

    // Security Guard: Prevent impersonating or subscribing to another user's room
    if (targetUserId && targetUserId !== verifiedUser.id.toString()) {
      socket.emit('registration_error', {
        message: 'Forbidden. You cannot subscribe to another user\'s private notifications.'
      });
      if (typeof callback === 'function') callback({ success: false, message: 'Forbidden' });
      return;
    }

    const safeUserId = verifiedUser.id.toString();
    socket.join(`user_${safeUserId}`);
    socket.userId = safeUserId;
    socket.user = verifiedUser;

    try {
      await User.findByIdAndUpdate(safeUserId, { isOnline: true, lastActive: new Date() });
    } catch (err) {}

    socket.emit('registered', { userId: safeUserId });
    if (typeof callback === 'function') callback({ success: true, userId: safeUserId });
  });

  // Join a specific blood request coordination room
  socket.on('join_room', (requestId) => {
    if (requestId) {
      socket.join(`request_${requestId}`);
    }
  });

  // Leave room
  socket.on('leave_room', (requestId) => {
    if (requestId) {
      socket.leave(`request_${requestId}`);
    }
  });

  socket.on('disconnect', async () => {
    if (socket.userId) {
      try {
        await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastActive: new Date() });
      } catch (err) {}
    }
  });
});

// Single Page Application (SPA) Fallback
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found' });
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Centralized Error Handling Middleware
app.use(errorHandler);

// Start server function
async function startServer() {
  try {
    await connectDB();
    await seedDatabaseIfEmpty();

    // Start background automatic radius escalation scheduler
    initEscalationCron(io);

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use by another running process.`);
        console.error(`👉 Close the process currently using port ${PORT} or set a different PORT in your .env file.`);
      } else {
        console.error(`❌ Server error: ${err.message}`);
      }
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log('===========================================================');
      console.log(`🩸 LifeLink Centralized Blood Donation Platform Active`);
      console.log(`🌐 Web Client URL: http://localhost:${PORT}`);
      console.log(`📡 REST API Endpoint: http://localhost:${PORT}/api/v1`);
      console.log(`🗺️  Offline Tiles Mounted at: http://localhost:${PORT}/tiles/`);
      console.log('===========================================================');
    });
  } catch (err) {
    console.error('❌ Fatal error starting LifeLink server:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer };
