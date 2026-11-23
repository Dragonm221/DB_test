require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Product = require('./models/Product');
const Order = require('./models/Order');
const User = require('./models/User');

const app = express();

// ตั้งค่าโฟลเดอร์เก็บรูปสลิปโอนเงิน
const slipDir = path.join(__dirname, 'public/uploads/slips');
if (!fs.existsSync(slipDir)) fs.mkdirSync(slipDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, slipDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ตั้งค่า Express, ไฟล์ตกแต่ง (public) และ EJS
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ตั้งค่า Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'it_store_secret',
  resave: false,
  saveUninitialized: false
}));

// ส่งข้อมูล user, cart และ cartCount ให้ไฟล์ header.ejs และทุกหน้าเว็บอัตโนมัติ
app.use((req, res, next) => {
  if (!req.session.cart) {
    req.session.cart = { items: [], totalPrice: 0 };
  }
  res.locals.user = req.session.user || null;
  res.locals.cart = req.session.cart;
  res.locals.cartCount = req.session.cart.items.reduce((sum, item) => sum + item.qty, 0);
  next();
});

// เชื่อมต่อฐานข้อมูล MongoDB Atlas และสร้างบัญชีทดสอบให้ตรงกับหน้า login.ejs
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ เชื่อมต่อฐานข้อมูล IT_Store บน MongoDB สำเร็จ');
    // อัปเดตหรือสร้างบัญชี admin / 1234 และ user1 / 1234 ให้ตรงกับหน้า login.ejs
    await User.updateOne(
      { email: 'admin@example.com' },
      { $set: { username: 'admin', password: '1234', fullName: 'ผู้ดูแลระบบ', role: 'admin' } },
      { upsert: true }
    );
    await User.updateOne(
      { email: 'customer@example.com' },
      { $set: { username: 'user1', password: '1234', fullName: 'สมชาย ใจดี', role: 'customer' } },
      { upsert: true }
    );
  })
  .catch(err => console.error('❌ เชื่อมต่อฐานข้อมูลล้มเหลว:', err));

// Middleware ตรวจสอบสิทธิ์ Admin
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).send('<h3>ไม่มีสิทธิ์เข้าถึงหน้านี้ (เฉพาะ Admin เท่านั้น) <a href="/login">เข้าสู่ระบบ</a></h3>');
  }
  next();
}

// ฟังก์ชันแปลงฟิลด์ imageUrl จาก MongoDB ให้เป็น image ตามที่หน้าเว็บเพื่อนเรียกใช้
function formatProduct(p) {
  const obj = p.toObject ? p.toObject() : p;
  return {
    ...obj,
    image: obj.imageUrl || obj.image || 'https://placehold.co/600x400?text=IT+Store',
    price: Number(obj.price) || 0,
    stock: Number(obj.stock) || 0
  };
}

// ==========================================
// 1. ฝั่งลูกค้า (Customer Routes)
// ==========================================

// หน้าแรก: ดึงสินค้า + ค้นหา + กรองตามหมวดหมู่
app.get('/', async (req, res) => {
  try {
    const { search, category } = req.query;
    let query = {};

    if (category && category !== 'all') {
      query.category = category;
    }
    if (search && search.trim() !== '') {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    const categories = await Product.distinct('category');
    const rawProducts = await Product.find(query);
    const products = rawProducts.map(formatProduct);

    res.render('index', {
      products,
      categories,
      selectedCategory: category || ''
    });
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาดในการดึงข้อมูล: ' + err.message);
  }
});

// หน้ารายละเอียดสินค้า
app.get('/product/:id', async (req, res) => {
  try {
    const rawProduct = await Product.findById(req.params.id);
    if (!rawProduct) return res.status(404).send('ไม่พบสินค้านี้');
    res.render('product-detail', { product: formatProduct(rawProduct) });
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// เพิ่มสินค้าลงตะกร้า (รองรับจำนวน quantity จากปุ่ม - / +)
app.post('/cart/add/:id', async (req, res) => {
  try {
    const rawProduct = await Product.findById(req.params.id);
    if (!rawProduct || rawProduct.stock <= 0) return res.redirect('/');
    const product = formatProduct(rawProduct);
    const qty = Math.max(1, parseInt(req.body.quantity || 1, 10));

    const cart = req.session.cart;
    const found = cart.items.find(i => i.productId === product._id.toString());

    if (found) {
      found.qty = Math.min(product.stock, found.qty + qty);
    } else {
      cart.items.push({
        productId: product._id.toString(),
        name: product.name,
        price: product.price,
        qty: Math.min(product.stock, qty),
        image: product.image
      });
    }
    cart.totalPrice = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
    res.redirect('/cart');
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// ปรับเพิ่ม/ลดจำนวนในหน้าตะกร้า
app.post('/cart/update/:id', async (req, res) => {
  try {
    const cart = req.session.cart;
    const found = cart.items.find(i => i.productId === req.params.id);
    if (found) {
      if (req.body.action === 'increase') {
        const product = await Product.findById(req.params.id);
        if (product && found.qty < product.stock) found.qty += 1;
      } else if (req.body.action === 'decrease') {
        found.qty -= 1;
        if (found.qty <= 0) {
          cart.items = cart.items.filter(i => i.productId !== req.params.id);
        }
      }
      cart.totalPrice = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
    }
    res.redirect('/cart');
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// ลบสินค้าออกจากตะกร้า
app.post('/cart/remove/:id', (req, res) => {
  const cart = req.session.cart;
  cart.items = cart.items.filter(i => i.productId !== req.params.id);
  cart.totalPrice = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  res.redirect('/cart');
});

// หน้าตะกร้าสินค้า
app.get('/cart', (req, res) => {
  res.render('cart', { cart: req.session.cart });
});

// หน้าชำระเงิน (บังคับล็อกอินก่อน เพื่อเก็บ userId Reference ลงใน Order)
app.get('/checkout', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.cart.items.length === 0) return res.redirect('/cart');
  res.render('checkout', { cart: req.session.cart });
});

// ยืนยันคำสั่งซื้อและอัปโหลดสลิป -> บันทึกลง MongoDB (orders) + ตัดสต็อก (products)
app.post('/checkout', upload.fields([
  { name: 'slipPromptpay', maxCount: 1 },
  { name: 'slipBank', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const cart = req.session.cart;
    if (cart.items.length === 0) return res.redirect('/cart');

    const { customerName, phone, address, paymentMethod } = req.body;
    const slipFile = (req.files?.slipPromptpay?.[0]) || (req.files?.slipBank?.[0]);
    const slipUrl = slipFile ? `/uploads/slips/${slipFile.filename}` : '';

    // 1. บันทึกคำสั่งซื้อลงคอลเลกชัน orders
    const newOrder = await Order.create({
      userId: req.session.user._id,
      customerName,
      phone,
      address,
      paymentMethod: paymentMethod || 'Credit Card',
      slipUrl,
      items: cart.items.map(i => ({
        productId: i.productId,
        name: i.name,
        priceAtPurchase: i.price,
        quantity: i.qty
      })),
      totalAmount: cart.totalPrice
    });

    // 2. ลดจำนวนสต็อกในคอลเลกชัน products
    for (const item of cart.items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: -item.qty }
      });
    }

    // ล้างตะกร้า
    req.session.cart = { items: [], totalPrice: 0 };

    res.send(`
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>สั่งซื้อสำเร็จ - iTechStore</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light d-flex align-items-center" style="min-height: 100vh;">
        <div class="container text-center">
          <div class="card shadow-sm p-5 mx-auto" style="max-width: 550px;">
            <h2 class="text-success fw-bold mb-3">✅ สั่งซื้อและบันทึกข้อมูลสำเร็จ!</h2>
            <p class="mb-1">รหัสคำสั่งซื้อ (Order ID): <code>${newOrder._id}</code></p>
            <p class="mb-1">ผู้รับสินค้า: <strong>${customerName}</strong></p>
            <p class="mb-3">ช่องทางชำระเงิน: <strong>${paymentMethod}</strong></p>
            <a href="/" class="btn btn-danger btn-lg">กลับหน้าร้านค้า</a>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาดในการบันทึกคำสั่งซื้อ: ' + err.message);
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
    const { username, password } = req.body;
    // ค้นหาจาก username หรือ email ในคอลเลกชัน users
    const user = await User.findOne({
      $or: [{ username }, { email: username }],
      password
    });

    if (!user) {
      return res.render('login', { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    req.session.user = {
      _id: user._id,
      username: user.username || user.fullName || user.email,
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

app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const rawProducts = await Product.find({}).sort({ _id: -1 });
    const categories = await Product.distinct('category');
    const orders = await Order.find({}).sort({ createdAt: -1 });
    res.render('admin', {
      products: rawProducts.map(formatProduct),
      categories,
      orders
    });
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// Admin: เพิ่มสินค้าใหม่ลง MongoDB
app.post('/admin/add', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, stock, image, description } = req.body;
    await Product.create({
      name,
      category,
      price: Number(price),
      stock: Number(stock),
      imageUrl: image,
      description
    });
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('เพิ่มสินค้าไม่สำเร็จ: ' + err.message);
  }
});

// Admin: แก้ไขข้อมูลสินค้าใน MongoDB
app.post('/admin/update/:id', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, stock, image, description } = req.body;
    await Product.findByIdAndUpdate(req.params.id, {
      name,
      category,
      price: Number(price),
      stock: Number(stock),
      imageUrl: image ? image.trim() : '',
      description
    });
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('แก้ไขสินค้าไม่สำเร็จ: ' + err.message);
  }
});

// Admin: ลบสินค้าออกจาก MongoDB
app.post('/admin/delete/:id', requireAdmin, async (req, res) => {
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