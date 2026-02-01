/**
 * Group Model
 * Handles community groups like Facebook Groups
 */

const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: [true, 'Group name is required'],
    trim: true,
    minlength: [3, 'Group name must be at least 3 characters'],
    maxlength: [100, 'Group name cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    required: [true, 'Group description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  
  // Visuals
  coverImage: {
    type: String,
    default: null
  },
  
  avatar: {
    type: String,
    default: null
  },
  
  // Category/Tags
  category: {
    type: String,
    enum: [
      'Sustainable Finance',
      'Digital Economy',
      'Emerging Markets',
      'Climate Economics',
      'Policy & Governance',
      'Technology & Innovation',
      'Social Impact',
      'Research & Academia',
      'Networking',
      'Other'
    ],
    default: 'Other'
  },
  
  tags: [{
    type: String,
    trim: true
  }],
  
  // Privacy
  privacy: {
    type: String,
    enum: ['public', 'private', 'secret'],
    default: 'public'
  },
  
  // Membership
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  moderators: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['member', 'moderator', 'admin'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Pending join requests (for private groups)
  pendingRequests: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    requestedAt: {
      type: Date,
      default: Date.now
    },
    message: String
  }],
  
  // Settings
  settings: {
    allowMemberPosts: {
      type: Boolean,
      default: true
    },
    requirePostApproval: {
      type: Boolean,
      default: false
    },
    allowMemberInvites: {
      type: Boolean,
      default: true
    }
  },
  
  // Rules
  rules: [{
    title: String,
    description: String
  }],
  
  // Stats
  postCount: {
    type: Number,
    default: 0
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  isFeatured: {
    type: Boolean,
    default: false
  }
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ===================
// INDEXES
// ===================

groupSchema.index({ name: 'text', description: 'text', tags: 'text' });
groupSchema.index({ category: 1 });
groupSchema.index({ 'members.user': 1 });
groupSchema.index({ creator: 1 });

// ===================
// VIRTUALS
// ===================

groupSchema.virtual('memberCount').get(function() {
  return this.members ? this.members.length : 0;
});

// ===================
// METHODS
// ===================

// Check if user is a member
groupSchema.methods.isMember = function(userId) {
  return this.members.some(m => m.user.toString() === userId.toString());
};

// Check if user is admin
groupSchema.methods.isAdmin = function(userId) {
  return this.creator.toString() === userId.toString() ||
         this.admins.some(id => id.toString() === userId.toString());
};

// Check if user is moderator or higher
groupSchema.methods.isModerator = function(userId) {
  return this.isAdmin(userId) ||
         this.moderators.some(id => id.toString() === userId.toString());
};

// Add member
groupSchema.methods.addMember = async function(userId) {
  if (!this.isMember(userId)) {
    this.members.push({
      user: userId,
      role: 'member',
      joinedAt: new Date()
    });
    await this.save();
  }
};

// Remove member
groupSchema.methods.removeMember = async function(userId) {
  this.members = this.members.filter(
    m => m.user.toString() !== userId.toString()
  );
  await this.save();
};

// Get member role
groupSchema.methods.getMemberRole = function(userId) {
  if (this.creator.toString() === userId.toString()) return 'creator';
  if (this.admins.some(id => id.toString() === userId.toString())) return 'admin';
  if (this.moderators.some(id => id.toString() === userId.toString())) return 'moderator';
  
  const member = this.members.find(m => m.user.toString() === userId.toString());
  return member ? member.role : null;
};

// Format for API response
groupSchema.methods.toPublicGroup = function(currentUserId) {
  return {
    id: this._id,
    name: this.name,
    description: this.description,
    coverImage: this.coverImage,
    avatar: this.avatar,
    category: this.category,
    tags: this.tags,
    privacy: this.privacy,
    memberCount: this.memberCount,
    postCount: this.postCount,
    isMember: currentUserId ? this.isMember(currentUserId) : false,
    memberRole: currentUserId ? this.getMemberRole(currentUserId) : null,
    rules: this.rules,
    isFeatured: this.isFeatured,
    createdAt: this.createdAt
  };
};

// ===================
// STATICS
// ===================

// Get popular groups
groupSchema.statics.getPopular = async function(limit = 10) {
  return this.aggregate([
    { $match: { isActive: true, privacy: 'public' } },
    { $addFields: { memberCount: { $size: '$members' } } },
    { $sort: { isFeatured: -1, memberCount: -1 } },
    { $limit: limit }
  ]);
};

// Search groups
groupSchema.statics.search = async function(query, options = {}) {
  const { category, limit = 20, page = 1 } = options;
  const skip = (page - 1) * limit;
  
  const filter = {
    isActive: true,
    privacy: { $ne: 'secret' },
    $text: { $search: query }
  };
  
  if (category) filter.category = category;
  
  return this.find(filter)
    .sort({ score: { $meta: 'textScore' }, memberCount: -1 })
    .skip(skip)
    .limit(limit)
    .populate('creator', 'name avatar');
};

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
