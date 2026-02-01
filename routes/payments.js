/**
 * Payment Routes
 * Handles Stripe integration for subscriptions and donations
 */

const express = require('express');
const Stripe = require('stripe');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ===================
// SUBSCRIPTION ENDPOINTS
// ===================

/**
 * POST /api/payments/create-checkout-session
 * Create a Stripe Checkout session for premium subscription
 */
router.post('/create-checkout-session', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    // Create or get Stripe customer
    let customerId = user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user._id.toString()
        }
      });
      customerId = customer.id;
      
      // Save customer ID
      user.stripeCustomerId = customerId;
      await user.save();
    }
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PREMIUM_PRICE_ID,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/upgrade/cancel`,
      metadata: {
        userId: user._id.toString()
      }
    });
    
    res.json({ 
      sessionId: session.id,
      url: session.url 
    });
    
  } catch (error) {
    console.error('Create checkout session error:', error);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

/**
 * POST /api/payments/create-portal-session
 * Create a Stripe Customer Portal session for managing subscription
 */
router.post('/create-portal-session', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }
    
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/settings`
    });
    
    res.json({ url: session.url });
    
  } catch (error) {
    console.error('Create portal session error:', error);
    res.status(500).json({ error: 'Failed to create portal session.' });
  }
});

/**
 * GET /api/payments/subscription-status
 * Get current subscription status
 */
router.get('/subscription-status', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    res.json({
      tier: user.tier,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionEndDate: user.subscriptionEndDate,
      isPremium: user.isPremium
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to get subscription status.' });
  }
});

// ===================
// DONATION ENDPOINTS
// ===================

/**
 * POST /api/payments/donate
 * Create a payment intent for campaign donation
 */
router.post('/donate', authenticate, async (req, res) => {
  try {
    const { campaignId, amount, message, isAnonymous } = req.body;
    
    if (!campaignId || !amount) {
      return res.status(400).json({ error: 'Campaign ID and amount are required' });
    }
    
    if (amount < 1) {
      return res.status(400).json({ error: 'Minimum donation is $1' });
    }
    
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaign.status !== 'active') {
      return res.status(400).json({ error: 'Campaign is not accepting donations' });
    }
    
    const user = await User.findById(req.userId);
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      customer: user.stripeCustomerId || undefined,
      metadata: {
        campaignId: campaign._id.toString(),
        userId: user._id.toString(),
        donorName: isAnonymous ? 'Anonymous' : user.name,
        message: message || '',
        isAnonymous: isAnonymous ? 'true' : 'false'
      },
      description: `Donation to: ${campaign.title}`
    });
    
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
    
  } catch (error) {
    console.error('Create donation error:', error);
    res.status(500).json({ error: 'Failed to process donation.' });
  }
});

/**
 * POST /api/payments/confirm-donation
 * Confirm donation after payment success (called from frontend)
 */
router.post('/confirm-donation', authenticate, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    
    // Retrieve payment intent to get metadata
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }
    
    const { campaignId, userId, message, isAnonymous } = paymentIntent.metadata;
    
    // Add donation to campaign
    const campaign = await Campaign.findById(campaignId);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    await campaign.addDonation({
      donor: userId,
      amount: paymentIntent.amount / 100, // Convert from cents
      message,
      isAnonymous: isAnonymous === 'true',
      stripePaymentIntentId: paymentIntentId,
      status: 'completed'
    });
    
    res.json({
      message: 'Donation confirmed',
      raised: campaign.raised,
      percentFunded: campaign.percentFunded
    });
    
  } catch (error) {
    console.error('Confirm donation error:', error);
    res.status(500).json({ error: 'Failed to confirm donation.' });
  }
});

// ===================
// STRIPE WEBHOOK
// ===================

/**
 * POST /api/payments/webhook
 * Handle Stripe webhooks
 */
router.post('/webhook', 
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutComplete(session);
        break;
      }
      
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCanceled(subscription);
        break;
      }
      
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
        break;
      }
      
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        // Handle donation success if it's a donation
        if (paymentIntent.metadata.campaignId) {
          await handleDonationSuccess(paymentIntent);
        }
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
  }
);

// ===================
// WEBHOOK HANDLERS
// ===================

async function handleCheckoutComplete(session) {
  try {
    const userId = session.metadata.userId;
    const subscriptionId = session.subscription;
    
    const user = await User.findById(userId);
    if (!user) return;
    
    user.stripeSubscriptionId = subscriptionId;
    user.tier = 'premium';
    user.subscriptionStatus = 'active';
    
    await user.save();
    
    console.log(`User ${userId} upgraded to premium`);
  } catch (error) {
    console.error('Handle checkout complete error:', error);
  }
}

async function handleSubscriptionUpdate(subscription) {
  try {
    const user = await User.findOne({ stripeCustomerId: subscription.customer });
    if (!user) return;
    
    user.subscriptionStatus = subscription.status;
    user.stripeSubscriptionId = subscription.id;
    
    if (subscription.status === 'active') {
      user.tier = 'premium';
      user.subscriptionEndDate = new Date(subscription.current_period_end * 1000);
    }
    
    await user.save();
  } catch (error) {
    console.error('Handle subscription update error:', error);
  }
}

async function handleSubscriptionCanceled(subscription) {
  try {
    const user = await User.findOne({ stripeCustomerId: subscription.customer });
    if (!user) return;
    
    user.tier = 'free';
    user.subscriptionStatus = 'canceled';
    user.stripeSubscriptionId = null;
    
    await user.save();
    
    console.log(`User ${user._id} subscription canceled`);
  } catch (error) {
    console.error('Handle subscription canceled error:', error);
  }
}

async function handlePaymentFailed(invoice) {
  try {
    const user = await User.findOne({ stripeCustomerId: invoice.customer });
    if (!user) return;
    
    user.subscriptionStatus = 'past_due';
    await user.save();
    
    // TODO: Send email notification about failed payment
  } catch (error) {
    console.error('Handle payment failed error:', error);
  }
}

async function handleDonationSuccess(paymentIntent) {
  try {
    const { campaignId, userId, message, isAnonymous } = paymentIntent.metadata;
    
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return;
    
    // Check if donation already recorded
    const existingDonation = campaign.donations.find(
      d => d.stripePaymentIntentId === paymentIntent.id
    );
    
    if (!existingDonation) {
      await campaign.addDonation({
        donor: userId,
        amount: paymentIntent.amount / 100,
        message,
        isAnonymous: isAnonymous === 'true',
        stripePaymentIntentId: paymentIntent.id,
        status: 'completed'
      });
    }
  } catch (error) {
    console.error('Handle donation success error:', error);
  }
}

module.exports = router;
