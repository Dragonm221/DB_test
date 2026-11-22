require('dotenv').config(); // โหลดค่าตัวแปรจากไฟล์ .env
const mongoose = require('mongoose');
const User = require('./models/User');

// เตรียมข้อมูลบัญชีทดสอบ 2 บทบาท (ดึงอีเมลและรหัส Admin จากไฟล์ .env)
const usersData = [
  { 
    email: process.env.ADMIN_EMAIL || 'admin@example.com', 
    password: process.env.ADMIN_PASSWORD || 'NongBoss888', 
    fullName: 'ผู้ดูแลระบบ ร้านคอมเทค', 
    role: 'admin' 
  },
  { 
    email: 'customer@example.com', 
    password: '123456', 
    fullName: 'สมชาย นักประกอบคอม', 
    role: 'customer' 
  }
];

async function seedUsers() {
  try {
    // 1. เชื่อมต่อไปยัง MongoDB Atlas ผ่านลิงก์ในไฟล์ .env
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ เชื่อมต่อ MongoDB สำเร็จ');

    // 2. ล้างเฉพาะข้อมูลเก่าในคอลเลกชัน users (ไม่ยุ่งกับ products)
    await User.deleteMany({});

    // 3. บันทึกบัญชีผู้ใช้ทั้ง 2 รายการลงคอลเลกชัน users
    await User.insertMany(usersData);
    console.log('✅ สร้างบัญชี Admin และ Customer ลงฐานข้อมูลเรียบร้อยแล้ว!');

    // 4. ปิดการเชื่อมต่อฐานข้อมูลเมื่อทำงานเสร็จ
    mongoose.connection.close();
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาด:', err);
  }
}

seedUsers();