/**
 * Campaign Routes
 * Handles crowdfunding campaigns (GoFundMe-style)
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const Campaign = require('../models/Campaign');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/campaigns
 * Get all active campaigns
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { category, status = 'active', featured } = req.query;
    
    const filter = { status };
    if (category) filter.category = category;
    if (featured === 'true') filter.isFeatured = true;
    
    const campaigns = await Campaign.find(filter)
      .sort({ isFeatured: -1, raised: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('organizer', 'name avatar');
    
    const total = await Campaign.countDocuments(filter);
    
    res.json({
      campaigns: campaigns.map(c => c.toPublicCampaign(req.userId)),
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ error: 'Failed to get campaigns.' });
  }
});

/**
 * GET /api/campaigns/featured
 */
router.get('/featured', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const campaigns = await Campaign.getFeatured(limit);
    res.json({ campaigns });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get featured campaigns.' });
  }
});

/**
 * GET /api/campaigns/trending
 */
router.get('/trending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const campaigns = await Campaign.getTrending(limit);
    res.json({ campaigns });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get trending campaigns.' });
  }
});

/**
 * GET /api/campaigns/search
 */
router.get('/search', async (req, res) => {
  try {
    const { q, category, page, limit } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    
    const campaigns = await Campaign.search(q, {
      category,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    
    res.json({ campaigns });
  } catch (error) {
    res.status(500).json({ error: 'Search failed.' });
  }
});

/**
 * GET /api/campaigns/my-campaigns
 * Get campaigns created by the current user
 */
router.get('/my-campaigns', authenticate, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ organizer: req.userId })
      .sort({ createdAt: -1 });
    
    res.json({ campaigns: campaigns.map(c => c.toPublicCampaign(req.userId)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get campaigns.' });
  }
});

/**
 * GET /api/campaigns/:id
 */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate('organizer', 'name avatar bio')
      .populate('donations.donor', 'name avatar');
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const response = campaign.toPublicCampaign(req.userId);
    response.updates = campaign.updates;
    response.recentDonations = campaign.getRecentDonations(10);
    
    res.json({ campaign: response });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get campaign.' });
  }
});

/**
 * POST /api/campaigns
 * Create a new campaign
 */
router.post('/',
  authenticate,
  [
    body('title').trim().notEmpty().isLength({ min: 10, max: 200 }),
    body('description').trim().notEmpty().isLength({ min: 100, max: 10000 }),
    body('goal').isNumeric().custom(v => v >= 100),
    body('category').isIn([
      'Environment', 'Education', 'Economic Development', 'Healthcare',
      'Technology', 'Community', 'Emergency Relief', 'Research', 'Social Impact', 'Other'
    ]),
    body('endDate').isISO8601()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const {
        title, description, shortDescription, goal, category,
        endDate, coverImage, images, video, tags, location, beneficiary
      } = req.body;
      
      // Get organizer name
      const User = require('../models/User');
      const user = await User.findById(req.userId);
      
      const campaign = new Campaign({
        title,
        description,
        shortDescription: shortDescription || description.substring(0, 300),
        organizer: req.userId,
        organizerName: user.name,
        goal,
        category,
        endDate: new Date(endDate),
        coverImage: coverImage || 'https://via.placeholder.com/800x400',
        images: images || [],
        video,
        tags: tags || [],
        location,
        beneficiary,
        status: 'active' // Or 'pending_review' if you want moderation
      });
      
      await campaign.save();
      await campaign.populate('organizer', 'name avatar');
      
      res.status(201).json({
        message: 'Campaign created successfully',
        campaign: campaign.toPublicCampaign(req.userId)
      });
    } catch (error) {
      console.error('Create campaign error:', error);
      res.status(500).json({ error: 'Failed to create campaign.' });
    }
  }
);

/**
 * PUT /api/campaigns/:id
 * Update campaign
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaign.organizer.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const allowedUpdates = [
      'title', 'description', 'shortDescription', 'coverImage',
      'images', 'video', 'tags', 'location', 'beneficiary'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) campaign[field] = req.body[field];
    });
    
    await campaign.save();
    
    res.json({
      message: 'Campaign updated',
      campaign: campaign.toPublicCampaign(req.userId)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update campaign.' });
  }
});

/**
 * POST /api/campaigns/:id/updates
 * Add an update to campaign
 */
router.post('/:id/updates',
  authenticate,
  [
    body('title').trim().notEmpty(),
    body('content').trim().notEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const campaign = await Campaign.findById(req.params.id);
      
      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      
      if (campaign.organizer.toString() !== req.userId.toString()) {
        return res.status(403).json({ error: 'Not authorized' });
      }
      
      await campaign.postUpdate({
        title: req.body.title,
        content: req.body.content,
        media: req.body.media || []
      });
      
      res.status(201).json({
        message: 'Update posted',
        update: campaign.updates[campaign.updates.length - 1]
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to post update.' });
    }
  }
);

/**
 * POST /api/campaigns/:id/follow
 * Follow/unfollow a campaign
 */
router.post('/:id/follow', authenticate, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const isFollowing = campaign.followers.includes(req.userId);
    
    if (isFollowing) {
      campaign.followers = campaign.followers.filter(
        id => id.toString() !== req.userId.toString()
      );
    } else {
      campaign.followers.push(req.userId);
    }
    
    await campaign.save();
    
    res.json({ following: !isFollowing });
  } catch (error) {
    res.status(500).json({ error: 'Failed to follow campaign.' });
  }
});

/**
 * GET /api/campaigns/:id/donations
 * Get campaign donations
 */
router.get('/:id/donations', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    const campaign = await Campaign.findById(req.params.id)
      .populate('donations.donor', 'name avatar');
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const completedDonations = campaign.donations
      .filter(d => d.status === 'completed')
      .sort((a, b) => b.createdAt - a.createdAt);
    
    const start = (page - 1) * limit;
    const paginatedDonations = completedDonations.slice(start, start + limit);
    
    res.json({
      donations: paginatedDonations.map(d => ({
        donor: d.isAnonymous ? null : d.donor,
        amount: d.amount,
        message: d.message,
        isAnonymous: d.isAnonymous,
        createdAt: d.createdAt
      })),
      total: completedDonations.length,
      page,
      pages: Math.ceil(completedDonations.length / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get donations.' });
  }
});

module.exports = router;
