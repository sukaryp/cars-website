const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- إعداد Cloudinary (بياناتك كاملة) ---
cloudinary.config({ 
    cloud_name: 'dt8vqalj1', 
    api_key: '393213937149196', 
    api_secret: 'T9n1kf-7ufVedaUZXSehFQO0QSw' 
});

// إعداد مخزن الصور السحابي
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'captin_shipping_receipts', 
        allowed_formats: ['jpg', 'png', 'jpeg'],
        transformation: [{ width: 1000, crop: "limit" }] 
    },
});
const upload = multer({ storage: storage });

// تحديد مسار قاعدة البيانات
const dbPath = path.join(__dirname, '../database.json');

const readDB = () => {
    try {
        if (!fs.existsSync(dbPath)) return { contracts: [], settings: {} };
        const data = fs.readFileSync(dbPath, 'utf8');
        return data ? JSON.parse(data) : { contracts: [], settings: {} };
    } catch (err) {
        console.error("Read DB Error:", err);
        return { contracts: [], settings: {} };
    }
};

const writeDB = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

/**
 * 1. عرض صفحة الشحن (بنفس الهيكل والبيانات)
 */
router.get('/', (req, res) => {
    try {
        const db = readDB();

        // جلب أسعار الصرف من الإعدادات (ستظل موجودة كاحتياطي)
        const globalRates = db.settings?.rates || {
            dollar: 50,
            euro: 55,
            won: 0.038,
            dirham: 13.5
        };

        const shippingContracts = (db.contracts || []).filter(c => c.status === 'shipping').map(c => {
            // حساب إجمالي المدفوع (كل دفعة بسعر صرفها)
            const paidTotal = (c.payments || []).reduce((acc, p) => acc + (Number(p.val) * Number(p.rate || 1)), 0);
            
            // حساب العربون بالمصري
            const rateAtContract = Number(c.dep_currency_rate) || 1;
            const depositEgp = (Number(c.dep_value) || 0) * rateAtContract;

            // المتبقي الصافي
            const remainingEgp = (Number(c.price) || 0) - depositEgp - paidTotal;

            return { 
                ...c, 
                remaining_final: remainingEgp,
                liveRates: globalRates // سيتم استبدالها في الواجهة بأسعار البورصة اللحظية
            };
        });

        res.render('shipping', { shippingContracts });
    } catch (err) {
        console.error("Shipping Page Error:", err);
        res.status(500).send("خطأ في تحميل صفحة الشحن");
    }
});

/**
 * 2. تحصيل دفعة متبقية (تعديل بسيط لاستقبال سعر البورصة)
 */
router.post('/pay-partial', upload.single('photos'), (req, res) => {
    try {
        const { id, amount, rate } = req.body;
        let db = readDB();
        const index = db.contracts.findIndex(c => String(c.id) === String(id));

        if (index === -1) return res.status(404).json({ success: false, error: "العقد غير موجود" });

        // التأكد من نجاح الرفع لـ Cloudinary
        if (!req.file) {
            return res.status(400).json({ success: false, error: "يجب إرفاق صورة الإيصال" });
        }

        const contract = db.contracts[index];
        if (!contract.payments) contract.payments = [];

        contract.payments.push({
            val: Number(amount),
            rate: Number(rate) || 1, // هنا سيتم تخزين سعر البورصة الذي جاء من الصفحة
            date: new Date().toISOString(),
            receipt: req.file.path, 
            type: 'shipping_payment'
        });

        writeDB(db);
        res.json({ success: true, url: req.file.path });
    } catch (err) {
        console.error("Pay Partial Error:", err);
        res.status(500).json({ success: false, error: "فشل تسجيل الدفعة" });
    }
});

/**
 * 3. تحديث مرحلة الشحن والأرشفة (كما هو)
 */
router.post('/update-stage', (req, res) => {
    try {
        const { id, stage } = req.body;
        let db = readDB();
        const index = db.contracts.findIndex(c => String(c.id) === String(id));
        
        if (index !== -1) {
            const contract = db.contracts[index];
            
            if (stage === 'delivered') {
                const paidTotal = (contract.payments || []).reduce((acc, p) => acc + (Number(p.val) * Number(p.rate || 1)), 0);
                const rateAtContract = Number(contract.dep_currency_rate) || 1;
                const depositEgp = (Number(contract.dep_value) || 0) * rateAtContract;
                const remaining = (Number(contract.price) || 0) - depositEgp - paidTotal;

                if (remaining > 10) { 
                    return res.json({ success: false, error: `لا يمكن الأرشفة. المتبقي ${remaining.toLocaleString()} ج.م.` });
                }
                contract.status = 'archived';
                contract.delivery_date = new Date().toISOString();
            }
            
            contract.ship_stage = stage;
            writeDB(db);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'العقد غير موجود' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "خطأ في التحديث" });
    }
});

module.exports = router;