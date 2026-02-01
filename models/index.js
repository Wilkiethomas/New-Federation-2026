/**
 * Models Index
 * Export all models from a single file
 */

const User = require('./User');
const Post = require('./Post');
const Group = require('./Group');
const Campaign = require('./Campaign');

module.exports = {
  User,
  Post,
  Group,
  Campaign
};
