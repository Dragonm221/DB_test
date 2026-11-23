const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String },
  password: { type: String, required: true },
  fullName: { type: String },
  role: {
    type: String,
    enum: ['customer', 'admin'],
    default: 'customer'
  }
});

module.exports = mongoose.model('User', userSchema, 'users');