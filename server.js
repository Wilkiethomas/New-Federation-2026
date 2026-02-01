/**
 * World Economic Federation - Backend API Server
 * Main entry point for the Node.js/Express application
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');
const groupRoutes = require('./routes/groups');
const campaignRoutes = require('./routes/campaigns');
const paymentRoutes = require('./routes/payments');

const app = express();

// ===================
// MIDDLEWARE
// ===================

// Security headers
app.use(helmet());

// CORS - Allow frontend to communicate with backend
app.use(cors({
  origin: '*',
  credentials: true
}));


// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting - prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ===================
// DATABASE CONNECTION
// ===================

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/wef_platform', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// ===================
// API ROUTES
// ===================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Authentication routes (register, login, logout, password reset)
app.use('/api/auth', authRoutes);

// User routes (profile, settings, followers)
app.use('/api/users', userRoutes);

// Post routes (create, read, update, delete, like, comment)
app.use('/api/posts', postRoutes);

// Group routes (create, join, leave, manage)
app.use('/api/groups', groupRoutes);

// Campaign/Crowdfunding routes
app.use('/api/campaigns', campaignRoutes);

// Payment routes (Stripe integration)
app.use('/api/payments', paymentRoutes);

// ===================
// ERROR HANDLING
// ===================

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ error: messages.join(', ') });
  }
  
  // JWT error
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  // Default error
  res.status(err.status || 500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : err.message 
  });
});

// ===================
// START SERVER
// ===================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
🌍 World Economic Federation API Server
📡 Running on port ${PORT}
🔗 http://localhost:${PORT}
📊 Environment: ${process.env.NODE_ENV || 'development'}
  `);
});

module.exports = app;
