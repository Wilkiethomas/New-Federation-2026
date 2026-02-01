/**
 * Post Routes
 * Handles creating, reading, updating, deleting posts
 * Plus likes, comments, and shares
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const Post = require('../models/Post');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/posts/feed
 * Get personalized feed for logged-in user
 */
router.get('/feed', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    const posts = await Post.getFeed(req.userId, page, limit);
    
    res.json({
      posts: posts.map(p => p.toFeedItem(req.userId)),
      page,
      hasMore: posts.length === limit
    });
    
  } catch (error) {
    console.error('Get feed error:', error);
    res.status(500).json({ error: 'Failed to get feed.' });
  }
});

/**
 * GET /api/posts/trending
 * Get trending posts (public)
 */
router.get('/trending', optionalAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const posts = await Post.getTrending(limit);
    
    res.json({
      posts: posts.map(p => p.toFeedItem ? p.toFeedItem(req.userId) : p)
    });
    
  } catch (error) {
    console.error('Get trending error:', error);
    res.status(500).json({ error: 'Failed to get trending posts.' });
  }
});

/**
 * GET /api/posts/:id
 * Get single post by ID
 */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'name avatar role')
      .populate('comments.author', 'name avatar');
    
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json({ post: post.toFeedItem(req.userId) });
    
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to get post.' });
  }
});

/**
 * POST /api/posts
 * Create a new post
 */
router.post('/',
  authenticate,
  [
    body('content')
      .trim()
      .notEmpty().withMessage('Content is required')
      .isLength({ max: 5000 }).withMessage('Content cannot exceed 5000 characters'),
    body('visibility')
      .optional()
      .isIn(['public', 'followers', 'private']).withMessage('Invalid visibility'),
    body('tags')
      .optional()
      .isArray().withMessage('Tags must be an array')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { content, media, visibility, tags, group } = req.body;
      
      const post = new Post({
        author: req.userId,
        content,
        media: media || [],
        visibility: visibility || 'public',
        tags: tags || [],
        group: group || null
      });
      
      await post.save();
      await post.populate('author', 'name avatar role');
      
      res.status(201).json({
        message: 'Post created successfully',
        post: post.toFeedItem(req.userId)
      });
      
    } catch (error) {
      console.error('Create post error:', error);
      res.status(500).json({ error: 'Failed to create post.' });
    }
  }
);

/**
 * PUT /api/posts/:id
 * Update a post
 */
router.put('/:id',
  authenticate,
  [
    body('content')
      .optional()
      .trim()
      .isLength({ max: 5000 }).withMessage('Content cannot exceed 5000 characters')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const post = await Post.findById(req.params.id);
      
      if (!post || post.isDeleted) {
        return res.status(404).json({ error: 'Post not found' });
      }
      
      // Check ownership
      if (post.author.toString() !== req.userId.toString()) {
        return res.status(403).json({ error: 'Not authorized to edit this post' });
      }
      
      const { content, visibility, tags } = req.body;
      
      if (content) post.content = content;
      if (visibility) post.visibility = visibility;
      if (tags) post.tags = tags;
      
      post.isEdited = true;
      post.editedAt = new Date();
      
      await post.save();
      await post.populate('author', 'name avatar role');
      
      res.json({
        message: 'Post updated successfully',
        post: post.toFeedItem(req.userId)
      });
      
    } catch (error) {
      console.error('Update post error:', error);
      res.status(500).json({ error: 'Failed to update post.' });
    }
  }
);

/**
 * DELETE /api/posts/:id
 * Delete a post (soft delete)
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Check ownership
    if (post.author.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }
    
    post.isDeleted = true;
    await post.save();
    
    res.json({ message: 'Post deleted successfully' });
    
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post.' });
  }
});

/**
 * POST /api/posts/:id/like
 * Like a post
 */
router.post('/:id/like', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const isLiked = post.isLikedBy(req.userId);
    
    if (isLiked) {
      // Unlike
      post.likes = post.likes.filter(
        id => id.toString() !== req.userId.toString()
      );
    } else {
      // Like
      post.likes.push(req.userId);
    }
    
    await post.save();
    
    res.json({
      liked: !isLiked,
      likeCount: post.likeCount
    });
    
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Failed to like post.' });
  }
});

/**
 * POST /api/posts/:id/comment
 * Add comment to a post
 */
router.post('/:id/comment',
  authenticate,
  body('content')
    .trim()
    .notEmpty().withMessage('Comment content is required')
    .isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const post = await Post.findById(req.params.id);
      
      if (!post || post.isDeleted) {
        return res.status(404).json({ error: 'Post not found' });
      }
      
      const comment = {
        author: req.userId,
        content: req.body.content,
        createdAt: new Date()
      };
      
      post.comments.push(comment);
      await post.save();
      
      // Populate the new comment's author
      await post.populate('comments.author', 'name avatar');
      
      const newComment = post.comments[post.comments.length - 1];
      
      res.status(201).json({
        message: 'Comment added',
        comment: newComment,
        commentCount: post.commentCount
      });
      
    } catch (error) {
      console.error('Add comment error:', error);
      res.status(500).json({ error: 'Failed to add comment.' });
    }
  }
);

/**
 * DELETE /api/posts/:id/comment/:commentId
 * Delete a comment
 */
router.delete('/:id/comment/:commentId', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const comment = post.comments.id(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    // Check ownership (comment author or post author can delete)
    if (comment.author.toString() !== req.userId.toString() &&
        post.author.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }
    
    comment.deleteOne();
    await post.save();
    
    res.json({ 
      message: 'Comment deleted',
      commentCount: post.commentCount
    });
    
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment.' });
  }
});

/**
 * POST /api/posts/:id/bookmark
 * Bookmark/unbookmark a post
 */
router.post('/:id/bookmark', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const isBookmarked = post.isBookmarkedBy(req.userId);
    
    if (isBookmarked) {
      // Remove bookmark
      post.bookmarkedBy = post.bookmarkedBy.filter(
        id => id.toString() !== req.userId.toString()
      );
    } else {
      // Add bookmark
      post.bookmarkedBy.push(req.userId);
    }
    
    await post.save();
    
    res.json({ bookmarked: !isBookmarked });
    
  } catch (error) {
    console.error('Bookmark error:', error);
    res.status(500).json({ error: 'Failed to bookmark post.' });
  }
});

/**
 * GET /api/posts/bookmarks
 * Get user's bookmarked posts
 */
router.get('/bookmarks', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const posts = await Post.find({
      bookmarkedBy: req.userId,
      isDeleted: false
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'name avatar role');
    
    res.json({
      posts: posts.map(p => p.toFeedItem(req.userId)),
      page,
      hasMore: posts.length === limit
    });
    
  } catch (error) {
    console.error('Get bookmarks error:', error);
    res.status(500).json({ error: 'Failed to get bookmarks.' });
  }
});

/**
 * POST /api/posts/:id/share
 * Share a post
 */
router.post('/:id/share', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post || post.isDeleted) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    post.shares.push({
      user: req.userId,
      sharedAt: new Date()
    });
    
    await post.save();
    
    res.json({
      message: 'Post shared',
      shareCount: post.shareCount
    });
    
  } catch (error) {
    console.error('Share error:', error);
    res.status(500).json({ error: 'Failed to share post.' });
  }
});

module.exports = router;
