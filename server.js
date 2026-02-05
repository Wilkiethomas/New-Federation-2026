/**
 * World Economic Federation - Main Server
 * Serves both API and Frontend
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// ===================
// SECURITY MIDDLEWARE
// ===================

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ===================
// BODY PARSING
// ===================

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===================
// STATIC FILES (Frontend)
// ===================

app.use(express.static(path.join(__dirname, 'public')));

// ===================
// DATABASE CONNECTION
// ===================

let dbConnected = false;
let dbError = null;

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wef_platform';
    console.log('Attempting MongoDB connection...');
    console.log('URI starts with:', mongoURI.substring(0, 30) + '...');
    
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    
    dbConnected = true;
    dbError = null;
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    dbConnected = false;
    dbError = error.message;
    console.error('❌ MongoDB connection error:', error.message);
    // Don't crash - keep server running so we can debug
    setTimeout(connectDB, 10000);
  }
};

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting reconnect...');
  dbConnected = false;
  setTimeout(connectDB, 5000);
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB error:', err.message);
  dbConnected = false;
  dbError = err.message;
});

// ===================
// API ROUTES
// ===================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: dbConnected ? 'connected' : 'disconnected',
    dbError: dbError
  });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
  res.json({
    nodeVersion: process.version,
    dbConnected: dbConnected,
    dbError: dbError,
    mongooseState: mongoose.connection.readyState,
    envVarsSet: {
      MONGODB_URI: !!process.env.MONGODB_URI,
      JWT_SECRET: !!process.env.JWT_SECRET,
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      STRIPE_PUBLISHABLE_KEY: !!process.env.STRIPE_PUBLISHABLE_KEY,
      STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
      FRONTEND_URL: !!process.env.FRONTEND_URL,
      NODE_ENV: process.env.NODE_ENV
    }
  });
});

// Import and use routes
try {
  const authRoutes = require('./routes/auth');
  const userRoutes = require('./routes/users');
  const postRoutes = require('./routes/posts');
  const groupRoutes = require('./routes/groups');
  const campaignRoutes = require('./routes/campaigns');
  const paymentRoutes = require('./routes/payments');

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/posts', postRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/payments', paymentRoutes);
  
  console.log('✅ All routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading routes:', error.message);
  
  app.use('/api/*', (req, res) => {
    res.status(500).json({ 
      error: 'Server configuration error',
      details: error.message
    });
  });
}

// API 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ===================
// FRONTEND ROUTES
// ===================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===================
// ERROR HANDLING
// ===================

app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({ error: `${field} already exists` });
  }
  
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }
  
  res.status(err.status || 500).json({ 
    error: err.message || 'Something went wrong'
  });
});

// ===================
// START SERVER
// ===================

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Start server first so it responds to health checks
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
  
  // Then connect to database
  await connectDB();
};

startServer();

module.exports = app;
