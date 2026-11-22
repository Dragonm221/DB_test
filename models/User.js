const mongoose = require('mongoose');

// กำหนดโครงสร้างข้อมูล (Schema) ของคอลเลกชัน users
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true }, // อีเมลที่ใช้ล็อกอิน (ห้ามซ้ำ)
  password: { type: String, required: true },            // รหัสผ่าน
  fullName: { type: String, required: true },            // ชื่อ-นามสกุลสมมติ
  role: { 
    type: String, 
    enum: ['customer', 'admin'], // บังคับให้เป็นได้แค่ 2 บทบาทตามโจทย์
    default: 'customer' 
  }
});

// ส่งออก Model ชื่อ 'User' (MongoDB จะสร้างคอลเลกชันชื่อ 'users' ให้อัตโนมัติ)
module.exports = mongoose.model('User', userSchema);