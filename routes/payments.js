const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- إعدادات Cloudinary لصور الحوالات البنكية ---
cloudinary.config({ 
    cloud_name: 'dt8vqalj1', 
    api_key: '393213937149196', 
    api_secret: 'اكتب_هنا_الـ_API_Secret_الخاص_بك' // تأكد من وضع السر هنا
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'captin_bank_receipts', // مجلد خاص بإيصالات البنك
        allowed_formats: ['jpg', 'png', 'jpeg'],
        transformation: [{ width: 1000, quality: "auto" }]
    },
});

const upload = multer({ storage: storage });

const dbPath = path.join(__dirname, '../database.json');

function getData() {
    try {
        if (!fs.existsSync(dbPath)) return { contracts: [] };
        const content = fs.readFileSync(dbPath, 'utf8');
        return content ? JSON.parse(content) : { contracts: [] };
    } catch (e) {
        return { contracts: [] };
    }
}

function saveData(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 1. عرض صفحة البنك والمعاملات
 */
router.get('/', (req, res) => {
    try {
        const data = getData();
        let allTransactions = [];

        // تجميع العمليات البنكية
        data.contracts.forEach(c => {
            if (c.payments) {
                c.payments.forEach(p => {
                    if (p.isBank || p.bankName || p.source === 'bank_transfer') {
                        allTransactions.push({
                            clientName: c.name,
                            amount: Number(p.val) * Number(p.rate), 
                            bank: p.bankName || p.bank || 'غير محدد',
                            date: p.date,
                            currency: p.currency || 'EGP',
                            originalAmount: p.val,
                            rate: p.rate,
                            receipt: p.receipt || null, // الرابط السحابي سيكون هنا
                            timestamp: p.timestamp || p.date
                        });
                    }
                });
            }
        });

        // فلترة العقود المديونة فقط
        const activeDebtors = data.contracts.filter(c => {
            const total = Number(c.price) || 0;
            const deposit = (Number(c.dep_value) || 0) * (Number(c.dep_currency_rate) || 1);
            const paid = (c.payments || []).reduce((acc, p) => acc + (Number(p.val) * Number(p.rate)), 0);
            const remaining = total - deposit - paid;
            return remaining > 0; 
        });

        allTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.render('bank-accounts', { 
            contracts: activeDebtors, 
            allTransactions: allTransactions 
        });
    } catch (e) {
        console.error("Error in bank GET:", e);
        res.render('bank-accounts', { contracts: [], allTransactions: [] });
    }
});

/**
 * 2. معالجة الدفعة البنكية (الرفع للسحاب)
 */
router.post('/process', upload.single('receiptImage'), (req, res) => {
    const data = getData();
    const { customerId, amount, currency, exchangeRate, bankAccount } = req.body;
    
    const amountNum = Number(amount);
    const rateNum = Number(exchangeRate);
    const totalEgp = amountNum * rateNum;

    const contract = data.contracts.find(c => String(c.id) === String(customerId));

    if (contract) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-CA'); 
        const timestamp = now.toISOString();

        if (!contract.payments) contract.payments = [];
        
        contract.payments.push({
            val: amountNum,
            rate: rateNum,
            date: dateStr,
            timestamp: timestamp,
            isBank: true,
            bankName: bankAccount, 
            currency: currency,
            // التعديل: حفظ الرابط السحابي الكامل بدلاً من اسم الملف
            receipt: req.file ? req.file.path : null
        });

        saveData(data);
        
        res.send(`
            <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
            <body style="background: #0b1120;">
            <script>
                Swal.fire({
                    icon: 'success',
                    title: 'تم تسجيل الدفعة بنجاح',
                    text: 'المبلغ: ${totalEgp.toLocaleString()} ج.م للعميل ${contract.name}',
                    confirmButtonColor: '#10b981',
                    background: '#1e293b',
                    color: '#fff'
                }).then(() => { window.location.href = "/bank-accounts"; });
            </script>
            </body>
        `);
    } else {
        res.status(404).send("العميل غير موجود");
    }
});

module.exports = router;