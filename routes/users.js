/**
 * User Routes
 * Handles user profiles, following, settings
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Post = require('../models/Post');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/users/:id
 * Get user profile by ID
 */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('followers', 'name avatar')
      .populate('following', 'name avatar');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get user's post count
    const postCount = await Post.countDocuments({ 
      author: user._id, 
      isDeleted: false 
    });
    
    const profile = user.toPublicProfile();
    profile.postCount = postCount;
    
    // Check if current user is following this user
    if (req.userId) {
      profile.isFollowing = user.followers.some(
        f => f._id.toString() === req.userId.toString()
      );
    }
    
    res.json({ user: profile });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user profile.' });
  }
});

/**
 * PUT /api/users/profile
 * Update current user's profile
 */
router.put('/profile', 
  authenticate,
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('bio')
      .optional()
      .isLength({ max: 500 }).withMessage('Bio cannot exceed 500 characters'),
    body('location')
      .optional()
      .isLength({ max: 100 }).withMessage('Location cannot exceed 100 characters'),
    body('website')
      .optional()
      .isURL().withMessage('Please enter a valid URL')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const allowedUpdates = ['name', 'bio', 'location', 'website', 'avatar', 'role'];
      const updates = {};
      
      for (const field of allowedUpdates) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
      
      const user = await User.findByIdAndUpdate(
        req.userId,
        { $set: updates },
        { new: true, runValidators: true }
      );
      
      res.json({ 
        message: 'Profile updated successfully',
        user: user.toPublicProfile() 
      });
      
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Failed to update profile.' });
    }
  }
);

/**
 * POST /api/users/:id/follow
 * Follow a user
 */
router.post('/:id/follow', authenticate, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.id);
    
    if (!userToFollow) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (userToFollow._id.toString() === req.userId.toString()) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }
    
    // Check if already following
    const isFollowing = userToFollow.followers.includes(req.userId);
    
    if (isFollowing) {
      return res.status(400).json({ error: 'You are already following this user' });
    }
    
    // Add to followers/following
    await User.findByIdAndUpdate(req.params.id, {
      $addToSet: { followers: req.userId }
    });
    
    await User.findByIdAndUpdate(req.userId, {
      $addToSet: { following: req.params.id }
    });
    
    res.json({ message: 'Now following user' });
    
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({ error: 'Failed to follow user.' });
  }
});

/**
 * DELETE /api/users/:id/follow
 * Unfollow a user
 */
router.delete('/:id/follow', authenticate, async (req, res) => {
  try {
    const userToUnfollow = await User.findById(req.params.id);
    
    if (!userToUnfollow) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Remove from followers/following
    await User.findByIdAndUpdate(req.params.id, {
      $pull: { followers: req.userId }
    });
    
    await User.findByIdAndUpdate(req.userId, {
      $pull: { following: req.params.id }
    });
    
    res.json({ message: 'Unfollowed user' });
    
  } catch (error) {
    console.error('Unfollow error:', error);
    res.status(500).json({ error: 'Failed to unfollow user.' });
  }
});

/**
 * GET /api/users/:id/followers
 * Get user's followers
 */
router.get('/:id/followers', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const user = await User.findById(req.params.id)
      .populate({
        path: 'followers',
        select: 'name avatar bio role',
        options: { skip, limit }
      });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      followers: user.followers,
      total: user.followers.length,
      page,
      pages: Math.ceil(user.followers.length / limit)
    });
    
  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({ error: 'Failed to get followers.' });
  }
});

/**
 * GET /api/users/:id/following
 * Get users that this user follows
 */
router.get('/:id/following', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const user = await User.findById(req.params.id)
      .populate({
        path: 'following',
        select: 'name avatar bio role',
        options: { skip, limit }
      });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      following: user.following,
      total: user.following.length,
      page,
      pages: Math.ceil(user.following.length / limit)
    });
    
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ error: 'Failed to get following.' });
  }
});

/**
 * GET /api/users/:id/posts
 * Get user's posts
 */
router.get('/:id/posts', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Determine visibility based on relationship
    let visibilityFilter = ['public'];
    if (req.userId) {
      if (req.userId.toString() === req.params.id) {
        // Own posts - show all
        visibilityFilter = ['public', 'followers', 'private'];
      } else if (user.followers.includes(req.userId)) {
        // Following - show public and followers
        visibilityFilter = ['public', 'followers'];
      }
    }
    
    const posts = await Post.find({
      author: req.params.id,
      isDeleted: false,
      visibility: { $in: visibilityFilter },
      group: null
    })
    .sort({ isPinned: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'name avatar role');
    
    const total = await Post.countDocuments({
      author: req.params.id,
      isDeleted: false,
      visibility: { $in: visibilityFilter },
      group: null
    });
    
    res.json({
      posts: posts.map(p => p.toFeedItem(req.userId)),
      total,
      page,
      pages: Math.ceil(total / limit)
    });
    
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({ error: 'Failed to get posts.' });
  }
});

/**
 * GET /api/users/search
 * Search users
 */
router.get('/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    
    const skip = (page - 1) * limit;
    
    const users = await User.find({
      $text: { $search: q },
      isActive: true
    })
    .select('name avatar bio role followerCount')
    .sort({ score: { $meta: 'textScore' } })
    .skip(skip)
    .limit(parseInt(limit));
    
    res.json({ users });
    
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Search failed.' });
  }
});

module.exports = router;
