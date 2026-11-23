const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  // Reference: อ้างอิง _id ไปยังคอลเลกชัน users
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerName: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  paymentMethod: { type: String, required: true },
  slipUrl: { type: String, default: '' },
  // Embed: ฝังรายการสินค้าและราคา ณ วันที่สั่งซื้อลงในออเดอร์โดยตรง
  items: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      name: String,
      priceAtPurchase: Number,
      quantity: Number
    }
  ],
  totalAmount: { type: Number, required: true },
  status: { type: String, default: 'รอดำเนินการ' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema, 'orders');