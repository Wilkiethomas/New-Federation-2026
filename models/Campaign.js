/**
 * Campaign Model
 * Handles crowdfunding campaigns like GoFundMe
 */

const mongoose = require('mongoose');

// Donation sub-schema
const donationSchema = new mongoose.Schema({
  donor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [1, 'Minimum donation is $1']
  },
  message: {
    type: String,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  // Stripe payment info
  stripePaymentIntentId: String,
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Update sub-schema (campaign updates/news)
const updateSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  media: [{
    type: String,
    url: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Main Campaign schema
const campaignSchema = new mongoose.Schema({
  // Basic Info
  title: {
    type: String,
    required: [true, 'Campaign title is required'],
    trim: true,
    minlength: [10, 'Title must be at least 10 characters'],
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  
  description: {
    type: String,
    required: [true, 'Campaign description is required'],
    minlength: [100, 'Description must be at least 100 characters'],
    maxlength: [10000, 'Description cannot exceed 10000 characters']
  },
  
  shortDescription: {
    type: String,
    maxlength: [300, 'Short description cannot exceed 300 characters']
  },
  
  // Organizer
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  organizerName: {
    type: String,
    required: true
  },
  
  // For organization campaigns
  organizationType: {
    type: String,
    enum: ['individual', 'nonprofit', 'organization'],
    default: 'individual'
  },
  
  // Media
  coverImage: {
    type: String,
    required: [true, 'Cover image is required']
  },
  
  images: [{
    type: String
  }],
  
  video: {
    type: String,
    default: null
  },
  
  // Category
  category: {
    type: String,
    enum: [
      'Environment',
      'Education',
      'Economic Development',
      'Healthcare',
      'Technology',
      'Community',
      'Emergency Relief',
      'Research',
      'Social Impact',
      'Other'
    ],
    required: true
  },
  
  tags: [{
    type: String,
    trim: true
  }],
  
  // Funding
  goal: {
    type: Number,
    required: [true, 'Funding goal is required'],
    min: [100, 'Minimum goal is $100']
  },
  
  raised: {
    type: Number,
    default: 0
  },
  
  currency: {
    type: String,
    default: 'USD'
  },
  
  // Donations
  donations: [donationSchema],
  
  donorCount: {
    type: Number,
    default: 0
  },
  
  // Timeline
  startDate: {
    type: Date,
    default: Date.now
  },
  
  endDate: {
    type: Date,
    required: [true, 'End date is required']
  },
  
  // Updates from organizer
  updates: [updateSchema],
  
  // Location
  location: {
    country: String,
    city: String,
    address: String
  },
  
  // Beneficiary (who receives the funds)
  beneficiary: {
    name: String,
    relationship: String, // e.g., "Self", "My child", "Community organization"
    description: String
  },
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'pending_review', 'active', 'paused', 'completed', 'canceled'],
    default: 'draft'
  },
  
  // Verification
  isVerified: {
    type: Boolean,
    default: false
  },
  
  verificationDetails: {
    verifiedAt: Date,
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    documents: [String]
  },
  
  // Featured/Promoted
  isFeatured: {
    type: Boolean,
    default: false
  },
  
  // Social
  shares: {
    type: Number,
    default: 0
  },
  
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Stripe
  stripeAccountId: String // Connected account for payouts
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ===================
// INDEXES
// ===================

campaignSchema.index({ title: 'text', description: 'text', tags: 'text' });
campaignSchema.index({ category: 1, status: 1 });
campaignSchema.index({ organizer: 1 });
campaignSchema.index({ status: 1, createdAt: -1 });
campaignSchema.index({ isFeatured: 1, raised: -1 });

// ===================
// VIRTUALS
// ===================

// Percentage funded
campaignSchema.virtual('percentFunded').get(function() {
  if (this.goal === 0) return 0;
  return Math.min(Math.round((this.raised / this.goal) * 100), 100);
});

// Days remaining
campaignSchema.virtual('daysLeft').get(function() {
  const now = new Date();
  const end = new Date(this.endDate);
  const diff = end - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
});

// Is campaign still accepting donations
campaignSchema.virtual('isActive').get(function() {
  return this.status === 'active' && 
         this.daysLeft > 0 &&
         this.raised < this.goal;
});

// Amount still needed
campaignSchema.virtual('amountRemaining').get(function() {
  return Math.max(0, this.goal - this.raised);
});

// ===================
// METHODS
// ===================

// Add donation
campaignSchema.methods.addDonation = async function(donationData) {
  this.donations.push(donationData);
  this.raised += donationData.amount;
  this.donorCount = new Set(this.donations.map(d => d.donor.toString())).size;
  
  // Check if goal reached
  if (this.raised >= this.goal) {
    this.status = 'completed';
  }
  
  await this.save();
  return this;
};

// Post update
campaignSchema.methods.postUpdate = async function(updateData) {
  this.updates.push(updateData);
  await this.save();
  return this;
};

// Format for API response
campaignSchema.methods.toPublicCampaign = function(currentUserId) {
  return {
    id: this._id,
    title: this.title,
    description: this.description,
    shortDescription: this.shortDescription,
    organizer: this.organizer,
    organizerName: this.organizerName,
    coverImage: this.coverImage,
    images: this.images,
    video: this.video,
    category: this.category,
    tags: this.tags,
    goal: this.goal,
    raised: this.raised,
    percentFunded: this.percentFunded,
    donorCount: this.donorCount,
    daysLeft: this.daysLeft,
    isActive: this.isActive,
    amountRemaining: this.amountRemaining,
    location: this.location,
    status: this.status,
    isVerified: this.isVerified,
    isFeatured: this.isFeatured,
    isFollowing: currentUserId ? this.followers.includes(currentUserId) : false,
    updatesCount: this.updates.length,
    createdAt: this.createdAt,
    endDate: this.endDate
  };
};

// Get recent donations (for display)
campaignSchema.methods.getRecentDonations = function(limit = 10) {
  return this.donations
    .filter(d => d.status === 'completed')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(d => ({
      donor: d.isAnonymous ? null : d.donor,
      amount: d.amount,
      message: d.message,
      isAnonymous: d.isAnonymous,
      createdAt: d.createdAt
    }));
};

// ===================
// STATICS
// ===================

// Get featured campaigns
campaignSchema.statics.getFeatured = async function(limit = 6) {
  return this.find({ 
    status: 'active',
    isFeatured: true 
  })
  .sort({ raised: -1 })
  .limit(limit)
  .populate('organizer', 'name avatar');
};

// Get trending campaigns
campaignSchema.statics.getTrending = async function(limit = 10) {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  
  return this.aggregate([
    { 
      $match: { 
        status: 'active',
        'donations.createdAt': { $gte: threeDaysAgo }
      } 
    },
    {
      $addFields: {
        recentDonations: {
          $filter: {
            input: '$donations',
            cond: { $gte: ['$$this.createdAt', threeDaysAgo] }
          }
        }
      }
    },
    {
      $addFields: {
        recentTotal: { $sum: '$recentDonations.amount' }
      }
    },
    { $sort: { recentTotal: -1 } },
    { $limit: limit }
  ]);
};

// Search campaigns
campaignSchema.statics.search = async function(query, options = {}) {
  const { category, status = 'active', limit = 20, page = 1 } = options;
  const skip = (page - 1) * limit;
  
  const filter = {
    status,
    $text: { $search: query }
  };
  
  if (category) filter.category = category;
  
  return this.find(filter)
    .sort({ score: { $meta: 'textScore' }, raised: -1 })
    .skip(skip)
    .limit(limit)
    .populate('organizer', 'name avatar');
};

const Campaign = mongoose.model('Campaign', campaignSchema);

module.exports = Campaign;
