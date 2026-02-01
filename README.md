# World Economic Federation - Backend API

A Node.js/Express backend for the WEF social platform with authentication, social features, groups, crowdfunding, and Stripe integration.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- MongoDB (local or MongoDB Atlas)
- Stripe account

### Installation

1. **Clone and install dependencies:**
```bash
cd wef-backend
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
```
Then edit `.env` with your values:
- `MONGODB_URI` - Your MongoDB connection string
- `JWT_SECRET` - A secure random string
- `STRIPE_SECRET_KEY` - From Stripe Dashboard
- `STRIPE_PREMIUM_PRICE_ID` - Create a product in Stripe

3. **Start the server:**
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The API will be running at `http://localhost:5000`

## 📁 Project Structure

```
wef-backend/
├── server.js           # Main entry point
├── package.json        # Dependencies
├── .env.example        # Environment template
├── models/             # Mongoose schemas
│   ├── User.js         # User accounts & auth
│   ├── Post.js         # Social feed posts
│   ├── Group.js        # Community groups
│   └── Campaign.js     # Crowdfunding campaigns
├── routes/             # API endpoints
│   ├── auth.js         # Authentication
│   ├── users.js        # User profiles
│   ├── posts.js        # Social feed
│   ├── groups.js       # Groups
│   ├── campaigns.js    # Crowdfunding
│   └── payments.js     # Stripe integration
└── middleware/
    └── auth.js         # JWT verification
```

## 🔗 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/refresh` | Refresh JWT token |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/:id` | Get user profile |
| PUT | `/api/users/profile` | Update profile |
| POST | `/api/users/:id/follow` | Follow user |
| DELETE | `/api/users/:id/follow` | Unfollow user |
| GET | `/api/users/:id/posts` | Get user's posts |

### Posts (Social Feed)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/posts/feed` | Get personalized feed |
| GET | `/api/posts/trending` | Get trending posts |
| POST | `/api/posts` | Create post |
| PUT | `/api/posts/:id` | Update post |
| DELETE | `/api/posts/:id` | Delete post |
| POST | `/api/posts/:id/like` | Like/unlike post |
| POST | `/api/posts/:id/comment` | Add comment |
| POST | `/api/posts/:id/bookmark` | Bookmark post |

### Groups
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/groups` | Get all groups |
| GET | `/api/groups/my-groups` | Get joined groups |
| POST | `/api/groups` | Create group |
| GET | `/api/groups/:id` | Get group details |
| POST | `/api/groups/:id/join` | Join group |
| POST | `/api/groups/:id/leave` | Leave group |
| GET | `/api/groups/:id/posts` | Get group posts |
| POST | `/api/groups/:id/posts` | Post in group |

### Campaigns (Crowdfunding)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/campaigns` | Get all campaigns |
| GET | `/api/campaigns/featured` | Get featured campaigns |
| POST | `/api/campaigns` | Create campaign |
| GET | `/api/campaigns/:id` | Get campaign details |
| PUT | `/api/campaigns/:id` | Update campaign |
| POST | `/api/campaigns/:id/updates` | Post campaign update |
| GET | `/api/campaigns/:id/donations` | Get donations |

### Payments (Stripe)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/payments/create-checkout-session` | Start subscription |
| POST | `/api/payments/create-portal-session` | Manage subscription |
| GET | `/api/payments/subscription-status` | Check subscription |
| POST | `/api/payments/donate` | Make donation |
| POST | `/api/payments/webhook` | Stripe webhooks |

## 💳 Stripe Setup

1. **Create a Stripe account** at https://stripe.com

2. **Create a Product** (Premium Subscription):
   - Go to Products → Add Product
   - Name: "WEF Premium Membership"
   - Price: $11.99/month (recurring)
   - Copy the Price ID (starts with `price_`)

3. **Get API Keys**:
   - Dashboard → Developers → API Keys
   - Copy `Secret key` to `STRIPE_SECRET_KEY`
   - Copy `Publishable key` to `STRIPE_PUBLISHABLE_KEY`

4. **Set up Webhook** (for production):
   - Developers → Webhooks → Add endpoint
   - URL: `https://yourdomain.com/api/payments/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`
   - Copy Signing secret to `STRIPE_WEBHOOK_SECRET`

## 🚀 Deployment

### Deploy to Hostinger

Hostinger supports Node.js on Business and Cloud plans:

1. **Upgrade** to Business or Cloud plan if needed
2. **Go to** hPanel → Node.js Apps
3. **Upload** your code via ZIP or connect GitHub
4. **Set environment variables** in the panel
5. **Deploy!**

### Deploy to Azure

1. **Create** an Azure App Service (Node.js runtime)
2. **Connect** your GitHub repository
3. **Configure** environment variables in Configuration
4. **Enable** continuous deployment

### Environment Variables for Production

Make sure to set these in your hosting provider:
- `NODE_ENV=production`
- `MONGODB_URI` (use MongoDB Atlas for production)
- `JWT_SECRET` (use a strong random string)
- `STRIPE_SECRET_KEY` (use live keys, not test)
- `STRIPE_WEBHOOK_SECRET`
- `FRONTEND_URL` (your frontend domain)

## 🔒 Security Notes

- Always use HTTPS in production
- Keep `.env` file secret (never commit to git)
- Use strong JWT secrets
- Enable rate limiting (already configured)
- Validate all user inputs (using express-validator)

## 📧 Support

For questions about deployment or customization, contact the World Economic Federation team.
