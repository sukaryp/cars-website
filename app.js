const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const app = express();

// --- [ إعدادات الجلسات (Sessions) ] ---
app.use(session({
    secret: 'al-captin-secure-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));

// --- [ إدارة قاعدة بيانات المستخدمين ] ---
const usersFilePath = path.join(__dirname, 'users.json');

function getAllUsers() {
    if (!fs.existsSync(usersFilePath)) {
        const initialUsers = [
            { username: "admin", password: "moh6060", role: "admin", name: " العقيد", branch:" العقيد" },
            { username: "cairo1", password: "123", role: "branch", name: "موظف القاهرة", branch: "كفر الشيخ" }
        ];
        fs.writeFileSync(usersFilePath, JSON.stringify(initialUsers, null, 2));
        return initialUsers;
    }
    return JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
}

// --- [ التأكد من وجود المجلدات ] ---
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// --- [ إعدادات المحرك ] ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// --- [ التعديل المهم لرفع الصور الكبيرة للسحاب ] ---
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.json({ limit: '50mb' }));

// --- [ Middleware الحماية ] ---
const isAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
};

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    res.status(403).send("عذراً، هذا القسم مخصص للمدير العام فقط");
};

// --- [ مسارات تسجيل الدخول ] ---
app.get('/login', (req, res) => {
    res.render('login'); 
});

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    const currentUsers = getAllUsers();
    const user = currentUsers.find(u => u.username === username && u.password === password);

    if (user) {
        req.session.user = user;
        res.json({ name: user.name, branchName: user.branch });
    } else {
        res.status(401).json({ message: "خطأ في اسم المستخدم أو كلمة المرور" });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- [ تفعيل الروترز ] ---
const contractsRouter = require('./routes/contracts');
const shippingRoutes = require('./routes/shipping');
const readyStockRouter = require('./routes/readyStock');
const paymentsRouter = require('./routes/payments');
const transfersRouter = require('./routes/transfers');
const adminRouter = require('./routes/adminRouter'); 
const adminToolsRouter = require('./routes/admin_tools');

app.use('/admin-tools', adminToolsRouter); 
app.use('/admin', isAuthenticated, isAdmin, adminRouter);
app.use('/bank-accounts', isAuthenticated, paymentsRouter);
app.use('/contracts', isAuthenticated, contractsRouter);
app.use('/ready-stock', isAuthenticated, readyStockRouter);
app.use('/shipping', isAuthenticated, shippingRoutes);
app.use('/transfers', isAuthenticated, transfersRouter);

// --- [ المسارات الأساسية - Dashboard ] ---

app.get(['/', '/dashboard'], isAuthenticated, async (req, res) => {
    try {
        const user = req.session.user;
        const dbPath = path.join(__dirname, 'database.json');
        
        // 1. جلب أسعار العملات الخمسة من API واحد لضمان السرعة
        let currencies = { usd: 0, eur: 0, sar: 0, aed: 0, krw: 0 };
        try {
            const currencyResponse = await fetch('https://api.exchangerate-api.com/v4/latest/EGP');
            const currencyData = await currencyResponse.json();
            
            currencies.usd = (1 / currencyData.rates.USD).toFixed(2);
            currencies.eur = (1 / currencyData.rates.EUR).toFixed(2);
            currencies.sar = (1 / currencyData.rates.SAR).toFixed(2);
            currencies.aed = (1 / currencyData.rates.AED).toFixed(2);
            currencies.krw = (1 / currencyData.rates.KRW).toFixed(4); 
        } catch (cErr) {
            console.error("Currency Fetch Error:", cErr);
            currencies = { usd: "50.50", eur: "54.20", sar: "13.45", aed: "13.75", krw: "0.0380" };
        }

        // 2. قراءة البيانات
        let data = { contracts: [], announcement: null };
        if (fs.existsSync(dbPath)) {
            data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        }

        const today = new Date();
        const notifications = [];
        let filteredContracts = data.contracts || [];

        if (user.role !== 'admin') {
            filteredContracts = filteredContracts.filter(c => c.branchName === user.branch);
        }

        // 3. حساب الإشعارات (المتأخرين)
        filteredContracts.forEach(contract => {
            if (contract.status === 'active' || contract.status === 'shipping') {
                const total = Number(contract.price) || Number(contract.totalPrice) || 0;
                const deposit = (Number(contract.dep_value) || 0) * (Number(contract.dep_currency_rate) || 1);
                const paidManual = (contract.payments || []).reduce((acc, p) => acc + (Number(p.val) * Number(p.rate)), 0);
                const paidBank = (contract.paymentHistory || []).reduce((acc, ph) => acc + Number(ph.amount), 0);
                
                const totalPaid = deposit + paidManual + paidBank;
                const remaining = total - totalPaid;

                if (remaining > 0) {
                    const contractDate = contract.createdAt ? new Date(contract.createdAt) : new Date();
                    const daysDiff = Math.floor((today - contractDate) / (1000 * 3600 * 24));

                    notifications.push({
                        id: contract.id || 'N/A',
                        name: contract.name || 'عميل مجهول',
                        remaining: remaining,
                        days: daysDiff,
                        branch: contract.branchName,
                        carName: contract.carName || ''
                    });
                }
            }
        });

        // 4. حساب الإحصائيات (Stats)
        const stats = {
            totalContracts: filteredContracts.filter(c => c.status === 'active').length,
            activeShipping: filteredContracts.filter(c => c.status === 'shipping').length,
            totalCollected: filteredContracts.reduce((sum, c) => {
                const dep = (Number(c.dep_value) || 0) * (Number(c.dep_currency_rate) || 1);
                const pM = (c.payments || []).reduce((acc, p) => acc + (p.val * p.rate), 0);
                const pB = (c.paymentHistory || []).reduce((acc, ph) => acc + Number(ph.amount), 0);
                return sum + dep + pM + pB;
            }, 0)
        };

        // 5. إرسال كل البيانات للصفحة
        res.render('index', { 
            user: user,
            stats: stats, 
            notifications: notifications,
            shippingCount: stats.activeShipping,
            totalPayments: stats.totalCollected,
            activeCount: stats.totalContracts,
            announcement: data.announcement || null,
            currencies: currencies 
        });

    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send("Internal Server Error");
    }
});

// --- [ مسار الأرشيف ] ---
app.get('/archive', isAuthenticated, (req, res) => {
    try {
        const user = req.session.user;
        const dbPath = path.join(__dirname, 'database.json');
        
        let archivedContracts = [];

        if (fs.existsSync(dbPath)) {
            const fileContent = fs.readFileSync(dbPath, 'utf8');
            if (fileContent.trim()) {
                const data = JSON.parse(fileContent);
                if (data && Array.isArray(data.contracts)) {
                    archivedContracts = data.contracts.filter(c => c.status === 'archived');
                }
            }
        }
        
        if (user.role !== 'admin') {
            archivedContracts = archivedContracts.filter(c => c.branchName === user.branch);
        }

        res.render('archive', { 
            archivedContracts: archivedContracts, 
            user: user 
        });

    } catch (error) {
        console.error("❌ خطأ حاد في الأرشيف:", error);
        res.render('archive', { 
            archivedContracts: [], 
            user: req.session.user,
            error: "حدث خطأ في قراءة ملف البيانات" 
        });
    }
});

// --- [ معالجة الـ 404 ] ---
app.use((req, res) => {
    res.status(404).render('index', {
        user: req.session.user || { name: 'زائر', role: 'guest' },
        stats: { totalContracts: 0, activeShipping: 0, totalCollected: 0, archivedCount: 0 },
        notifications: [],
        shippingCount: 0, 
        totalPayments: 0, 
        activeCount: 0,
        announcement: null,
        currencies: { usd: 0, eur: 0, sar: 0, aed: 0, krw: 0 }, // تم تصفيرها للـ 404
        msg: 'عذراً، هذه الصفحة غير موجودة'
    });
});

// --- [ تشغيل السيرفر ] ---
// التعديل الأخير: استخدام منفذ البيئة الخاص بـ Render أو 3000 محلياً
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});