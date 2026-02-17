/**
 * Group Routes
 * Handles group CRUD, membership, and group posts
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const Group = require('../models/Group');
const Post = require('../models/Post');
const User = require('../models/User');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/groups
 * Get all public groups
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { category, featured } = req.query;
    
    const filter = { isActive: true, privacy: { $ne: 'secret' } };
    if (category) filter.category = category;
    if (featured === 'true') filter.isFeatured = true;
    
    const groups = await Group.find(filter)
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('creator', 'name avatar');
    
    const total = await Group.countDocuments(filter);
    
    res.json({
      groups: groups.map(g => g.toPublicGroup(req.userId)),
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Failed to get groups.' });
  }
});

/**
 * GET /api/groups/my-groups
 */
router.get('/my-groups', authenticate, async (req, res) => {
  try {
    const groups = await Group.find({
      'members.user': req.userId,
      isActive: true
    }).populate('creator', 'name avatar');
    
    res.json({ groups: groups.map(g => g.toPublicGroup(req.userId)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get groups.' });
  }
});

/**
 * GET /api/groups/:id
 */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('creator', 'name avatar')
      .populate('admins', 'name avatar');
    
    if (!group || !group.isActive) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (group.privacy === 'secret' && !group.isMember(req.userId)) {
      return res.status(403).json({ error: 'This group is private' });
    }
    
    // Fetch recent posts for this group
    const recentPosts = await Post.find({ group: req.params.id, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('author', 'name avatar role');
    
    // Build response with recentPosts included
    const groupData = group.toPublicGroup(req.userId);
    const response = {
      ...groupData,
      recentPosts: recentPosts.map(p => {
        if (p.toFeedItem) {
          return p.toFeedItem(req.userId);
        }
        return {
          id: p._id,
          content: p.content,
          author: p.author,
          createdAt: p.createdAt
        };
      })
    };
    
    res.json({ group: response });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: 'Failed to get group.' });
  }
});

/**
 * POST /api/groups
 * Create a new group
 */
router.post('/',
  authenticate,
  [
    body('name').trim().notEmpty().isLength({ min: 3, max: 100 }),
    body('description').trim().notEmpty().isLength({ max: 2000 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { name, description, category, privacy, tags, coverImage } = req.body;
      
      const group = new Group({
        name,
        description,
        category: category || 'Other',
        privacy: privacy || 'public',
        tags: tags || [],
        coverImage,
        creator: req.userId,
        admins: [req.userId],
        members: [{ user: req.userId, role: 'admin', joinedAt: new Date() }]
      });
      
      await group.save();
      await User.findByIdAndUpdate(req.userId, { $addToSet: { groups: group._id } });
      await group.populate('creator', 'name avatar');
      
      res.status(201).json({
        message: 'Group created successfully',
        group: group.toPublicGroup(req.userId)
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create group.' });
    }
  }
);

/**
 * PUT /api/groups/:id
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    
    if (!group || !group.isActive) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (!group.isAdmin(req.userId)) {
      return res.status(403).json({ error: 'Only admins can update group settings' });
    }
    
    const updates = ['name', 'description', 'category', 'privacy', 'tags', 'coverImage', 'rules', 'settings'];
    updates.forEach(field => {
      if (req.body[field] !== undefined) group[field] = req.body[field];
    });
    
    await group.save();
    res.json({ message: 'Group updated', group: group.toPublicGroup(req.userId) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update group.' });
  }
});

/**
 * POST /api/groups/:id/join
 */
router.post('/:id/join', authenticate, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    
    if (!group || !group.isActive) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (group.isMember(req.userId)) {
      return res.status(400).json({ error: 'Already a member' });
    }
    
    if (group.privacy === 'private') {
      // Add to pending requests
      group.pendingRequests.push({ user: req.userId, requestedAt: new Date() });
      await group.save();
      return res.json({ message: 'Join request sent' });
    }
    
    await group.addMember(req.userId);
    await User.findByIdAndUpdate(req.userId, { $addToSet: { groups: group._id } });
    
    res.json({ message: 'Joined group successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join group.' });
  }
});

/**
 * POST /api/groups/:id/leave
 */
router.post('/:id/leave', authenticate, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (group.creator.toString() === req.userId.toString()) {
      return res.status(400).json({ error: 'Creator cannot leave. Transfer ownership first.' });
    }
    
    await group.removeMember(req.userId);
    await User.findByIdAndUpdate(req.userId, { $pull: { groups: group._id } });
    
    res.json({ message: 'Left group successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave group.' });
  }
});

/**
 * GET /api/groups/:id/members
 */
router.get('/:id/members', optionalAuth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.user', 'name avatar bio role');
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    res.json({ members: group.members, total: group.memberCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get members.' });
  }
});

/**
 * GET /api/groups/:id/posts
 */
router.get('/:id/posts', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const group = await Group.findById(req.params.id);
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Check membership for private groups
    if (group.privacy !== 'public' && !group.isMember(req.userId)) {
      return res.status(403).json({ error: 'Must be a member to view posts' });
    }
    
    const posts = await Post.find({ group: req.params.id, isDeleted: false })
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'name avatar role');
    
    res.json({
      posts: posts.map(p => p.toFeedItem(req.userId)),
      page,
      hasMore: posts.length === limit
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get posts.' });
  }
});

/**
 * POST /api/groups/:id/posts
 * Create a post in a group
 */
router.post('/:id/posts',
  authenticate,
  body('content').trim().notEmpty().isLength({ max: 5000 }),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const group = await Group.findById(req.params.id);
      
      if (!group || !group.isActive) {
        return res.status(404).json({ error: 'Group not found' });
      }
      
      if (!group.isMember(req.userId)) {
        return res.status(403).json({ error: 'Must be a member to post' });
      }
      
      if (!group.settings.allowMemberPosts && !group.isModerator(req.userId)) {
        return res.status(403).json({ error: 'Only moderators can post in this group' });
      }
      
      const post = new Post({
        author: req.userId,
        content: req.body.content,
        media: req.body.media || [],
        group: group._id,
        visibility: 'group'
      });
      
      await post.save();
      
      // Update group post count
      group.postCount += 1;
      await group.save();
      
      await post.populate('author', 'name avatar role');
      
      res.status(201).json({
        message: 'Post created',
        post: post.toFeedItem(req.userId)
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create post.' });
    }
  }
);

module.exports = router;
