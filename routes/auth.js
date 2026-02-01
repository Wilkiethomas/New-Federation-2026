/**
 * Authentication Routes
 * Handles user registration, login, logout, password reset
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticate, generateToken, generateRefreshToken } = require('../middleware/auth');

const router = express.Router();

// ===================
// VALIDATION RULES
// ===================

const registerValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email')
    .trim()
    .isEmail().withMessage('Please enter a valid email')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/\d/).withMessage('Password must contain a number'),
  body('tier')
    .optional()
    .isIn(['free', 'premium']).withMessage('Invalid tier')
];

const loginValidation = [
  body('email')
    .trim()
    .isEmail().withMessage('Please enter a valid email')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
];

// ===================
// ROUTES
// ===================

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', registerValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { name, email, password, tier = 'free' } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        error: 'An account with this email already exists' 
      });
    }
    
    // Create new user
    const user = new User({
      name,
      email,
      password,
      tier
    });
    
    await user.save();
    
    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    res.status(201).json({
      message: 'Registration successful',
      token,
      refreshToken,
      user: user.toPublicProfile()
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

/**
 * POST /api/auth/login
 * Login user
 */
router.post('/login', loginValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { email, password } = req.body;
    
    // Find user and include password for comparison
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }
    
    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({ 
        error: 'Account is deactivated. Please contact support.' 
      });
    }
    
    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }
    
    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    res.json({
      message: 'Login successful',
      token,
      refreshToken,
      user: user.toPublicProfile()
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate('followers', 'name avatar')
      .populate('following', 'name avatar')
      .populate('groups', 'name avatar memberCount');
    
    res.json({ user: user.toPublicProfile() });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile.' });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }
    
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    
    // Generate new access token
    const token = generateToken(user._id);
    
    res.json({ token });
    
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Send password reset email
 */
router.post('/forgot-password', 
  body('email').isEmail().withMessage('Please enter a valid email'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { email } = req.body;
      const user = await User.findOne({ email });
      
      // Don't reveal if user exists
      if (!user) {
        return res.json({ 
          message: 'If an account exists, a password reset email has been sent.' 
        });
      }
      
      // Generate reset token
      const resetToken = user.createPasswordResetToken();
      await user.save();
      
      // TODO: Send email with reset link
      // For now, just return success
      // In production, use SendGrid, Mailgun, etc.
      
      console.log('Password reset token:', resetToken); // Remove in production
      
      res.json({ 
        message: 'If an account exists, a password reset email has been sent.' 
      });
      
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Failed to process request.' });
    }
  }
);

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/\d/).withMessage('Password must contain a number')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { token, password } = req.body;
      
      // Hash the token to compare with stored hash
      const crypto = require('crypto');
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
      
      // Find user with valid reset token
      const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() }
      });
      
      if (!user) {
        return res.status(400).json({ 
          error: 'Invalid or expired reset token' 
        });
      }
      
      // Update password
      user.password = password;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();
      
      // Generate new tokens
      const authToken = generateToken(user._id);
      
      res.json({ 
        message: 'Password reset successful',
        token: authToken
      });
      
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Failed to reset password.' });
    }
  }
);

/**
 * POST /api/auth/change-password
 * Change password (when logged in)
 */
router.post('/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
      .matches(/\d/).withMessage('Password must contain a number')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { currentPassword, newPassword } = req.body;
      
      // Get user with password
      const user = await User.findById(req.userId).select('+password');
      
      // Verify current password
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      
      // Update password
      user.password = newPassword;
      await user.save();
      
      res.json({ message: 'Password changed successfully' });
      
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Failed to change password.' });
    }
  }
);

module.exports = router;
