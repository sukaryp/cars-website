const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- إعدادات Cloudinary لرفع صور السيارات الجاهزة للسحاب ---
cloudinary.config({ 
    cloud_name: 'dt8vqalj1', 
    api_key: '393213937149196', 
    api_secret: 'اكتب_هنا_الـ_API_Secret_الخاص_بك' // ضع هنا الـ Secret الخاص بك
});

// إعداد المخزن السحابي (Cloudinary Storage)
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'captin_ready_stock', // اسم المجلد الخاص بالسيارات الجاهزة على السحاب
        allowed_formats: ['jpg', 'png', 'jpeg'],
        transformation: [{ width: 1000, crop: "limit" }]
    },
});

const upload = multer({ storage: storage });
const dbPath = path.join(__dirname, '../database.json');

/**
 * 1. عرض الصفحة (مع الفلترة حسب الصلاحيات)
 */
router.get('/', (req, res) => {
    try {
        if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ invoices: [] }));
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        
        // استخراج بيانات المستخدم الحالي من السيشين
        const user = req.user || req.session.user; 
        
        if (!user) {
            return res.redirect('/login'); // لو مفيش يوزر يرجع للوجين
        }

        let filteredInvoices = [];

        // منطق الفلترة
        if (user.role === 'admin') {
            // المدير يشوف كل حاجة
            filteredInvoices = data.invoices || [];
        } else {
            // اليوزر العادي يشوف بس اللي هو ضافه بناءً على اسم المستخدم
            filteredInvoices = (data.invoices || []).filter(inv => inv.addedBy === user.username);
        }
        
        res.render('ready-stock', { 
            user: user, 
            invoices: filteredInvoices 
        });

    } catch (err) {
        console.error("خطأ في العرض:", err);
        res.render('ready-stock', { user: req.user, invoices: [] });
    }
});

/**
 * 2. حفظ البيانات (تسجيل البيانات مع الصور السحابية)
 */
router.post('/save', upload.array('invoicePhotos', 10), (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const user = req.user || req.session.user;

        const newInvoice = {
            id: Date.now(),
            // نضمن تسجيل اسم اليوزر الحقيقي اللي فاتح السيشين
            addedBy: user ? user.username : "غير معروف", 
            salesPerson: req.body.salesPerson, 
            branch: req.body.branch,           
            customerName: req.body.customerName,
            customerPhone: req.body.customerPhone,
            carBrand: req.body.carBrand,
            carModel: req.body.carModel,
            carYear: req.body.carYear,
            carColor: req.body.carColor,
            vinNumber: req.body.vinNumber,
            price: req.body.price,
            paymentMethod: req.body.paymentMethod,
            // التعديل: حفظ روابط الصور السحابية (URLs) بدلاً من أسماء الملفات المحلية
            photos: req.files ? req.files.map(f => f.path) : [],
            createdAt: new Date()
        };

        if (!data.invoices) data.invoices = [];
        data.invoices.unshift(newInvoice);
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

        res.redirect('/ready-stock');
    } catch (err) {
        console.error("خطأ في الحفظ:", err);
        res.status(500).send("حدث خطأ أثناء حفظ البيانات");
    }
});

module.exports = router;