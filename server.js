require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');

const Product = require('./models/Product');
const Order = require('./models/Order');
const User = require('./models/User');

const app = express();

// ตั้งค่าให้ Express อ่านข้อมูลจากฟอร์มหน้าเว็บ และใช้ EJS แสดงผล
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ตั้งค่า Session สำหรับเก็บสถานะการล็อกอินและตะกร้าสินค้า
app.use(session({
  secret: process.env.SESSION_SECRET || 'it_store_secret',
  resave: false,
  saveUninitialized: false
}));

// ส่งข้อมูล user และ cart ไปให้ทุกหน้าเว็บใช้งานได้อัตโนมัติ
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.cart = req.session.cart || [];
  next();
});

// เชื่อมต่อฐานข้อมูล MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ เชื่อมต่อฐานข้อมูล IT_Store บน MongoDB สำเร็จ'))
  .catch(err => console.error('❌ เชื่อมต่อฐานข้อมูลล้มเหลว:', err));

// Middleware ตรวจสอบสิทธิ์เฉพาะ Admin (ลูกค้าเข้าไม่ได้)
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).send('<h3>ไม่มีสิทธิ์เข้าถึงหน้านี้ (เฉพาะผู้ดูแลระบบเท่านั้น) <a href="/login">เข้าสู่ระบบ</a></h3>');
  }
  next();
}

// ==========================================
// 1. ฝั่งลูกค้า (Customer Routes)
// ==========================================

// หน้าแรก: ดึงสินค้าทั้งหมดจาก MongoDB + ค้นหา + กรองตามหมวดหมู่
app.get('/', async (req, res) => {
  try {
    const { search, category } = req.query;
    let query = {};

    // กรองตามหมวดหมู่ (ถ้าไม่ได้เลือก 'all')
    if (category && category !== 'all') {
      query.category = category;
    }
    // ค้นหาจากชื่อสินค้า (ไม่สนตัวพิมพ์เล็ก-ใหญ่)
    if (search && search.trim() !== '') {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    // ดึงรายชื่อหมวดหมู่ทั้งหมดที่มีในคอลเลกชัน products แบบไม่ซ้ำ
    const categories = await Product.distinct('category');
    // ดึงรายการสินค้าตามเงื่อนไขจาก MongoDB
    const products = await Product.find(query);

    res.render('index', {
      products,
      categories,
      search: search || '',
      selectedCategory: category || 'all'
    });
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาดในการดึงข้อมูลสินค้า: ' + err.message);
  }
});

// หน้ารายละเอียดสินค้าทีละชิ้น
app.get('/product/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).send('ไม่พบสินค้านี้');
    res.render('detail', { product });
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// เพิ่มสินค้าลงตะกร้า (เก็บใน Session ก่อนกดยืนยันสั่งซื้อ)
app.post('/cart/add/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product || product.stock <= 0) return res.redirect('/');

    if (!req.session.cart) req.session.cart = [];
    const existingItem = req.session.cart.find(item => item.productId === product._id.toString());

    if (existingItem) {
      if (existingItem.quantity < product.stock) existingItem.quantity += 1;
    } else {
      req.session.cart.push({
        productId: product._id.toString(),
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        quantity: 1
      });
    }
    res.redirect('/cart');
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// หน้าตะกร้าสินค้า
app.get('/cart', (req, res) => {
  const cart = req.session.cart || [];
  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  res.render('cart', { cart, totalAmount, successMessage: null });
});

// ลบสินค้าออกจากตะกร้า
app.post('/cart/remove/:id', (req, res) => {
  if (req.session.cart) {
    req.session.cart = req.session.cart.filter(item => item.productId !== req.params.id);
  }
  res.redirect('/cart');
});

// ยืนยันคำสั่งซื้อ -> บันทึกลงคอลเลกชัน orders และตัดสต็อกใน products
app.post('/checkout', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const cart = req.session.cart || [];
    if (cart.length === 0) return res.redirect('/cart');

    const { customerName, shippingAddress } = req.body;
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // 1. บันทึกคำสั่งซื้อใหม่ลง MongoDB (Collection: orders)
    const newOrder = await Order.create({
      userId: req.session.user._id,
      customerName,
      shippingAddress,
      items: cart.map(item => ({
        productId: item.productId,
        name: item.name,
        priceAtPurchase: item.price,
        quantity: item.quantity
      })),
      totalAmount
    });

    // 2. ลดจำนวนสต็อกสินค้าในคอลเลกชัน products
    for (const item of cart) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: -item.quantity }
      });
    }

    // ล้างตะกร้าสินค้า
    req.session.cart = [];
    res.render('cart', {
      cart: [],
      totalAmount: 0,
      successMessage: `สั่งซื้อสำเร็จ! รหัสคำสั่งซื้อของคุณคือ ${newOrder._id}`
    });
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาดในการสั่งซื้อ: ' + err.message);
  }
});

// ==========================================
// 2. ระบบเข้าสู่ระบบ / ออกจากระบบ (Authentication)
// ==========================================

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // ค้นหาผู้ใช้ในคอลเลกชัน users
    const user = await User.findOne({ email, password });

    if (!user) {
      return res.render('login', { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    // เก็บข้อมูลผู้ใช้และบทบาท (role) ลงใน Session
    req.session.user = {
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    };

    if (user.role === 'admin') {
      res.redirect('/admin');
    } else {
      res.redirect('/');
    }
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ==========================================
// 3. ฝั่งผู้ดูแลระบบ (Admin CRUD Routes)
// ==========================================

// หน้าจัดการสินค้าของ Admin
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const products = await Product.find({}).sort({ _id: -1 });
    const orders = await Order.find({}).sort({ createdAt: -1 });
    res.render('admin', { products, orders });
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// Admin: เพิ่มสินค้าใหม่ลง MongoDB
app.post('/admin/products/add', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, stock, imageUrl, description } = req.body;
    await Product.create({
      name,
      category,
      price: Number(price),
      stock: Number(stock),
      imageUrl,
      description
    });
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('เพิ่มสินค้าไม่สำเร็จ: ' + err.message);
  }
});

// Admin: แก้ไขข้อมูล / อัปเดตราคาและสต็อกใน MongoDB
app.post('/admin/products/edit/:id', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, stock, imageUrl, description } = req.body;
    await Product.findByIdAndUpdate(req.params.id, {
      name,
      category,
      price: Number(price),
      stock: Number(stock),
      imageUrl,
      description
    });
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('แก้ไขสินค้าไม่สำเร็จ: ' + err.message);
  }
});

// Admin: ลบสินค้าออกจาก MongoDB
app.post('/admin/products/delete/:id', requireAdmin, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('ลบสินค้าไม่สำเร็จ: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 เซิร์ฟเวอร์เปิดทำงานที่ http://localhost:${PORT}`);
});