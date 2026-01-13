const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- إعدادات Cloudinary لرفع الصور للسحاب بدلاً من الهارد ---
cloudinary.config({ 
    cloud_name: 'dt8vqalj1', 
    api_key: '393213937149196', 
    api_secret: 'اكتب_هنا_الـ_API_Secret_الخاص_بك' // تأكد من وضع السر هنا
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'captin_contracts_photos', 
        allowed_formats: ['jpg', 'png', 'jpeg'],
    },
});
const upload = multer({ storage: storage });

const dbPath = path.join(__dirname, '../database.json');

// دالة جلب البيانات مع تأمين ضد ملفات الـ JSON الفارغة أو التالفة
function getData() {
    try {
        if (!fs.existsSync(dbPath)) {
            const initialData = { contracts: [] };
            fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2), 'utf8');
            return initialData;
        }

        const fileContent = fs.readFileSync(dbPath, 'utf8');
        
        if (!fileContent.trim()) {
            return { contracts: [] };
        }

        let data = JSON.parse(fileContent);

        if (!data || !Array.isArray(data.contracts)) {
            data = { contracts: [] };
        }

        data.contracts.forEach(c => {
            if (!c.paymentHistory) c.paymentHistory = [];
            if (!c.payments) c.payments = [];
        });
        
        return data;
    } catch (error) {
        console.error("خطأ في قراءة قاعدة البيانات، تم تصفير البيانات لتجنب الانهيار:", error);
        return { contracts: [] };
    }
}

function saveData(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

// Middleware للتأكد من تسجيل الدخول
const checkAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};

// عرض التعاقدات
router.get('/', checkAuth, (req, res) => {
    const data = getData();
    const user = req.session.user;
    
    let filteredContracts;
    if (user.role === 'admin') {
        filteredContracts = data.contracts;
    } else {
        filteredContracts = data.contracts.filter(c => 
            c.branchName === user.branch || 
            c.branch === user.branch || 
            c.createdBy === user.name
        );
    }

    // تجهيز العقود للعرض مع حساب المديونية وتنسيق الدفعات
    filteredContracts = filteredContracts.map(c => {
        const depositEgp = (Number(c.dep_value) || 0) * (Number(c.dep_currency_rate) || 1);
        
        // حساب إجمالي المدفوع من المصفوفة الموحدة
        const totalPaid = (c.payments || []).reduce((sum, p) => sum + (Number(p.val) * Number(p.rate)), 0);
        
        c.calculatedRemaining = (Number(c.price) || 0) - depositEgp - totalPaid;

        // ميزة إضافية: ترتيب الدفعات من الأحدث للأقدم عشان تظهر صح في الجدول
        if (c.payments) {
            c.payments.sort((a, b) => new Date(b.date) - new Date(a.date));
        }

        return c;
    });
    
    res.render('contracts', { 
        contracts: filteredContracts, 
        user: user 
    });
});

// حفظ التعاقد الجديد وربطه باسم الموظف الحالي ودعم الفرع اليدوي
router.post('/save', checkAuth, upload.array('photos', 10), (req, res) => {
    const data = getData();
    // التعديل هنا: نأخذ رابط الصورة من السحاب (f.path) بدلاً من الاسم المحلي
    const photos = req.files ? req.files.map(f => f.path) : [];
    const user = req.session.user; 

    const newRecord = {
        id: "CAPT-" + Math.floor(1000 + Math.random() * 9000),
        name: req.body.name,
        phone: req.body.phone,
        nid: req.body.nid,
        brand: req.body.brand,
        model: req.body.model,
        year: req.body.year,
        sales: req.body.sales,
        supervisor: req.body.supervisor,
        class: req.body.class,
        price: Number(req.body.price),
        dep_currency: req.body.dep_currency, 
        dep_currency_rate: Number(req.body.dep_currency_rate), 
        dep_value: Number(req.body.dep_value),
        link: req.body.link,
        photos: photos, // الروابط السحابية الآن جاهزة
        payments: [],            
        paymentHistory: [],      
        status: 'active', 
       
        // --- حفظ الفرع والموظف في الداتا بيز ---
        branchName: req.body.branchName || user.branch, // يحفظ القيمة المكتوبة يدوياً في الفورم
        createdBy: user.name,                           // يحفظ اسم الموظف الذي قام بالإدخال
        
        date: new Date().toLocaleString('ar-EG'),
        timestamp: new Date().toISOString()            // يحفظ الوقت بالثواني
    };

    data.contracts.push(newRecord);
    saveData(data);
    res.redirect('/contracts');
});

// تصدير للشحن
router.post('/export-to-shipping', checkAuth, (req, res) => {
    const data = getData();
    const { id, duration } = req.body;
    const user = req.session.user;
    
    const contract = data.contracts.find(c => c.id === id);
    if (contract) {
        // السماح للآدمين أو صاحب الفرع بالتعديل
        if (user.role !== 'admin' && contract.branchName !== user.branch && contract.branch !== user.branch) {
            return res.status(403).json({ error: "غير مصرح لك بتعديل هذا العقد" });
        }
        contract.status = 'shipping'; 
        contract.ship_duration = Number(duration);
        contract.ship_start_date = new Date().toISOString();
        contract.exportedBy = user.name; 

        saveData(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "العميل غير موجود" });
    }
});

// تحصيل دفعة وتسجيل الموظف المحصل
router.post('/pay-partial', checkAuth, (req, res) => {
    const data = getData();
    const { id, amount, rate } = req.body;
    const user = req.session.user;
    const contract = data.contracts.find(c => c.id === id);
    
    if (contract) {
        if (user.role !== 'admin' && contract.branchName !== user.branch && contract.branch !== user.branch) {
            return res.status(403).json({ error: "غير مصرح لك بالتحصيل لهذا العقد" });
        }

        // التأكد من وجود المصفوفة
        if (!contract.payments) contract.payments = [];

        contract.payments.push({
            val: Number(amount), 
            rate: Number(rate),  
            date: new Date().toISOString(),
            collectedBy: user.name, 
            branch: user.branch,
            type: 'cash' 
        });

        saveData(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "العميل غير موجود" });
    }
});

// المسح (لمدير النظام فقط)
router.post('/delete', checkAuth, (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin') {
        return res.status(403).json({ error: "صلاحية المدير فقط مطلوب لمسح العقود" });
    }
    const data = getData();
    const { id } = req.body;
    data.contracts = data.contracts.filter(c => c.id !== id);
    saveData(data);
    res.json({ success: true });
});

module.exports = router;