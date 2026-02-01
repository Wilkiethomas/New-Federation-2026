/**
 * User Model
 * Handles user accounts, authentication, and subscription tiers
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Don't return password in queries by default
  },
  
  // Profile
  avatar: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters'],
    default: ''
  },
  role: {
    type: String,
    default: 'Member'
  },
  location: {
    type: String,
    default: ''
  },
  website: {
    type: String,
    default: ''
  },
  
  // Subscription Tier
  tier: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free'
  },
  
  // Stripe Integration
  stripeCustomerId: {
    type: String,
    default: null
  },
  stripeSubscriptionId: {
    type: String,
    default: null
  },
  subscriptionStatus: {
    type: String,
    enum: ['none', 'active', 'past_due', 'canceled', 'trialing'],
    default: 'none'
  },
  subscriptionEndDate: {
    type: Date,
    default: null
  },
  
  // Social Features
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Groups
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group'
  }],
  
  // Account Status
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  
  // Password Reset
  passwordResetToken: String,
  passwordResetExpires: Date
  
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ===================
// INDEXES
// ===================

userSchema.index({ email: 1 });
userSchema.index({ name: 'text', bio: 'text' }); // For search

// ===================
// VIRTUALS
// ===================

// Get user's initials for avatar fallback
userSchema.virtual('initials').get(function() {
  return this.name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
});

// Get follower/following counts
userSchema.virtual('followerCount').get(function() {
  return this.followers ? this.followers.length : 0;
});

userSchema.virtual('followingCount').get(function() {
  return this.following ? this.following.length : 0;
});

// Check if premium subscription is active
userSchema.virtual('isPremium').get(function() {
  return this.tier === 'premium' && 
         this.subscriptionStatus === 'active' &&
         (!this.subscriptionEndDate || this.subscriptionEndDate > new Date());
});

// ===================
// MIDDLEWARE
// ===================

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash if password is modified
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// ===================
// METHODS
// ===================

// Compare password for login
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate password reset token
userSchema.methods.createPasswordResetToken = function() {
  const crypto = require('crypto');
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  
  return resetToken;
};

// Get public profile (safe to send to frontend)
userSchema.methods.toPublicProfile = function() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    avatar: this.avatar,
    initials: this.initials,
    bio: this.bio,
    role: this.role,
    location: this.location,
    website: this.website,
    tier: this.tier,
    isPremium: this.isPremium,
    followerCount: this.followerCount,
    followingCount: this.followingCount,
    isVerified: this.isVerified,
    createdAt: this.createdAt
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User;
