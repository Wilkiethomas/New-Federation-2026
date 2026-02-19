/**
 * Post Model
 * Handles user posts, likes, comments for the social feed
 */

const mongoose = require('mongoose');

// Comment sub-schema
const commentSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: [true, 'Comment content is required'],
    maxlength: [1000, 'Comment cannot exceed 1000 characters']
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Main Post schema
const postSchema = new mongoose.Schema({
  // Author
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Content
  content: {
    type: String,
    required: [true, 'Post content is required'],
    maxlength: [5000, 'Post cannot exceed 5000 characters']
  },
  
  // Media attachments
  media: [{
    type: {
      type: String,
      enum: ['image', 'video', 'document'],
      required: true
    },
    url: {
      type: String,
      required: true
    },
    thumbnail: String,
    caption: String
  }],
  
  // Post type
  postType: {
    type: String,
    enum: ['standard', 'poll', 'article', 'event'],
    default: 'standard'
  },
  
  // If posted in a group
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null
  },
  
  // Engagement
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  comments: [commentSchema],
  
  shares: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    sharedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Bookmarks (saved posts)
  bookmarkedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Visibility
  visibility: {
    type: String,
    enum: ['public', 'followers', 'group', 'private'],
    default: 'public'
  },
  
  // Tags/mentions
  tags: [{
    type: String,
    trim: true
  }],
  
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Status
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: Date,
  
  isPinned: {
    type: Boolean,
    default: false
  },
  
  isDeleted: {
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

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ group: 1, createdAt: -1 });
postSchema.index({ content: 'text', tags: 'text' }); // For search
postSchema.index({ createdAt: -1 }); // For feed sorting

// ===================
// VIRTUALS
// ===================

postSchema.virtual('likeCount').get(function() {
  return this.likes ? this.likes.length : 0;
});

postSchema.virtual('commentCount').get(function() {
  return this.comments ? this.comments.length : 0;
});

postSchema.virtual('shareCount').get(function() {
  return this.shares ? this.shares.length : 0;
});

// ===================
// METHODS
// ===================

// Check if user has liked this post
postSchema.methods.isLikedBy = function(userId) {
  return this.likes.some(id => id.toString() === userId.toString());
};

// Check if user has bookmarked this post
postSchema.methods.isBookmarkedBy = function(userId) {
  return this.bookmarkedBy.some(id => id.toString() === userId.toString());
};

// Format for API response - NOW INCLUDES COMMENTS
postSchema.methods.toFeedItem = function(currentUserId) {
  return {
    id: this._id,
    author: this.author,
    content: this.content,
    media: this.media,
    postType: this.postType,
    group: this.group,
    likeCount: this.likeCount,
    commentCount: this.commentCount,
    shareCount: this.shareCount,
    comments: this.comments || [], // Include comments array for frontend
    liked: currentUserId ? this.isLikedBy(currentUserId) : false,
    bookmarked: currentUserId ? this.isBookmarkedBy(currentUserId) : false,
    visibility: this.visibility,
    tags: this.tags,
    isEdited: this.isEdited,
    isPinned: this.isPinned,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// ===================
// STATICS
// ===================

/**
 * GLOBAL FEED - Shows ALL public posts from ALL users
 * Similar to Instagram/Twitter/Facebook explore feed
 */
postSchema.statics.getFeed = async function(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  // Show ALL public posts from ALL users (global feed)
  const posts = await this.find({
    isDeleted: false,
    visibility: 'public',
    group: null // Exclude group posts from main feed
  })
  .sort({ isPinned: -1, createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .populate('author', 'name avatar role')
  .populate('comments.author', 'name avatar');
  
  return posts;
};

/**
 * PERSONALIZED FEED - Shows posts from people user follows
 * Can be used for "Following" tab in the future
 */
postSchema.statics.getPersonalizedFeed = async function(userId, page = 1, limit = 20) {
  const User = mongoose.model('User');
  const user = await User.findById(userId).select('following');
  
  const followingIds = user.following || [];
  followingIds.push(userId); // Include own posts
  
  const skip = (page - 1) * limit;
  
  const posts = await this.find({
    author: { $in: followingIds },
    isDeleted: false,
    visibility: { $in: ['public', 'followers'] },
    group: null
  })
  .sort({ isPinned: -1, createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .populate('author', 'name avatar role')
  .populate('comments.author', 'name avatar');
  
  return posts;
};

/**
 * Get trending posts (most engagement in last 24 hours)
 */
postSchema.statics.getTrending = async function(limit = 10) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const posts = await this.aggregate([
    {
      $match: {
        createdAt: { $gte: oneDayAgo },
        isDeleted: false,
        visibility: 'public',
        group: null
      }
    },
    {
      $addFields: {
        engagement: {
          $add: [
            { $size: '$likes' },
            { $multiply: [{ $size: '$comments' }, 2] },
            { $multiply: [{ $size: '$shares' }, 3] }
          ]
        }
      }
    },
    { $sort: { engagement: -1 } },
    { $limit: limit }
  ]);
  
  return this.populate(posts, { path: 'author', select: 'name avatar role' });
};

const Post = mongoose.model('Post', postSchema);

module.exports = Post;
