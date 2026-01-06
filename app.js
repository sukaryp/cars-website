const express = require('express');
const fs = require('fs'); // خلي دي بس وامسح التانية اللي تحت
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const axios = require('axios');
const ExcelJS = require('exceljs');

// امسح السطر ده لأنه مكرر وبيعمل Error:
// const fs = require('fs'); 

const app = express();

// 1. الإعدادات الأساسية (دلوقتي الـ app بقت معروفة للسيرفر)
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. إعدادات السيشن
app.use(session({
    secret: 'al-captain-secret-2024',
    resave: false,
    saveUninitialized: true
}));

// 3. توزيع بيانات المستخدم
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// 4. استدعاء وربط المسارات (تأكد إنك كاتبهم مرة واحدة بس)
const financeRoutes = require('./finance');
const adminRoutes = require('./auth');

// 5. تفعيل المسارات
app.use('/finance', financeRoutes);
app.use('/admin', adminRoutes);

// راوت صفحة فواتير الشراء
app.get('/purchase-invoices', (req, res) => {
    res.render('purchase_invoices', { user: req.session.user });
});

// ... كمل باقي كود الـ DB_FILE والـ Functions اللي عندك ...
// --- [خطوة 4: حماية الصفحات العامة] ---
app.use((req, res, next) => {
    if (!req.session.user && req.path !== '/login' && !req.path.startsWith('/uploads')) {
        return res.redirect('/login');
    }
    next();
});

// --- [خطوة 5: استدعاء واستخدام مسارات الإدارة - بعد الحماية] ---
// السطرين دول هم المترجم اللي بيخلي السيرفر يفهم البيانات اللي جاية من الفورم
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// تأكد إنهم فوق السطر ده:لـ auth.js هيشوف الـ session بوضوح

// ... باقي الكود (app.listen) ...

// 4. إعدادات الـ Express العادية
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

const DB_FILE = 'database.json';

// --- إعداد رفع الصور (Multer) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });


// متغيرات لتخزين الأسعار عالمياً في السيرفر
let exchangeRates = {
    USD: 50.0, // سعر افتراضي في حالة فشل الاتصال
    EUR: 55.0,
    lastUpdate: 'لم يتم التحديث'
};

// وظيفة لجلب الأسعار من API خارجي (مثال باستخدام API مجاني)
async function updateExchangeRates() {
    try {
        // بنستخدم خدمة v6.exchangerate-api.com (تقدر تعمل حساب مجاني وتغير الـ API Key)
        const response = await axios.get('https://open.er-api.com/v6/latest/USD');
        if (response.data && response.data.rates) {
            const egpRate = response.data.rates.EGP; // سعر الدولار مقابل الجنيه
            const eurRate = response.data.rates.EUR; // سعر الدولار مقابل اليورو

            exchangeRates.USD = parseFloat(egpRate).toFixed(2);
            // تحويل اليورو لجنيه (سعر الجنيه / سعر اليورو)
            exchangeRates.EUR = (egpRate / eurRate).toFixed(2);
            exchangeRates.lastUpdate = new Date().toLocaleString('ar-EG');

            console.log(`✅ تم تحديث الأسعار تلقائياً: USD: ${exchangeRates.USD}, EUR: ${exchangeRates.EUR}`);
        }
    } catch (error) {
        console.error('❌ فشل تحديث أسعار الصرف، سيتم استخدام الأسعار الافتراضية');
    }
}

// تحديث الأسعار أول ما السيرفر يشتغل
updateExchangeRates();
// تحديث تلقائي كل 6 ساعات (اختياري)
setInterval(updateExchangeRates, 6 * 60 * 60 * 1000);

// --- 1. وظيفة قراءة وحفظ البيانات ---
function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initialData = {
                cars: [], bankTransfers: [], expenses: [],
                employees: [], imports: [], contracts: [], payments: []
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
            return initialData;
        }
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        let data = fileContent.trim() ? JSON.parse(fileContent) : {};
        return {
            cars: data.cars || [],
            bankTransfers: data.bankTransfers || [],
            expenses: data.expenses || [],
            employees: data.employees || [],
            imports: data.imports || [],
            contracts: data.contracts || [],
            payments: data.payments || []
        };
    } catch (err) {
        return { cars: [], bankTransfers: [], expenses: [], employees: [], imports: [], contracts: [], payments: [] };
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- 2. الصفحة الرئيسية ---
app.get('/', (req, res) => {
    const db = readDB();
    const getBalance = (curr) => {
        let inc = db.expenses.filter(e => e.type === 'in' && (e.currency === curr || (!e.currency && curr === 'EGP')))
            .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        let out = db.expenses.filter(e => e.type === 'out' && (e.currency === curr || (!e.currency && curr === 'EGP')))
            .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        return inc - out;
    };

    res.render('index', {
        balanceEGP: getBalance('EGP').toLocaleString(),
        balanceUSD: getBalance('USD').toLocaleString(),
        balanceEUR: getBalance('EUR').toLocaleString(),
        carsCount: db.cars.filter(c => c.status !== 'sold' && c.status !== 'shipping').length,
        importsCount: db.cars.filter(i => i.status === 'shipping').length
    });
});

// --- 3. إدارة السيارات (الجرد) ---
app.get('/cars', (req, res) => {
    try {
        const db = readDB();
        const payments = db.payments || [];
        const user = req.session.user;
        let needsUpdate = false;

        const updatedCars = (db.cars || []).map(car => {
            // حساب المدفوعات
            const totalPaid = payments
                .filter(p => p.chassis === car.chassis)
                .reduce((sum, p) => sum + (parseFloat(p.amount) * parseFloat(p.rate || 1)), 0);

            // حل مشكلة السعر (لو مفيش price ياخد buyPrice)
            const currentPrice = parseFloat(car.price) || parseFloat(car.buyPrice) || 0;
            let currentStatus = car.status || 'available';

            // البيع التلقائي
            if (currentPrice > 0 && totalPaid >= currentPrice) {
                if (currentStatus !== 'sold') {
                    currentStatus = 'sold';
                    car.status = 'sold';
                    needsUpdate = true;
                }
            }

            return {
                ...car,
                price: currentPrice,
                paid: totalPaid,
                status: currentStatus,
                remaining: Math.max(0, currentPrice - totalPaid)
            };
        });

        if (needsUpdate) {
            writeDB(db);
        }

        // عرض المتاح فقط (أو اللي سعره 0 عشان تعدله)
        const filteredCars = updatedCars.filter(car => 
            car.status !== 'sold' || (parseFloat(car.price) || 0) <= 0
        );

        res.render('cars', {
            cars: filteredCars,
            user: user
        });
    } catch (error) {
        console.error("خطأ في حارس البيانات:", error);
        res.status(500).send("حدث خطأ أثناء تحميل البيانات");
    }
});
app.post('/add-car', (req, res) => {
    const db = readDB();

    // 1. تحديد اسم الشخص اللي بيضيف من السيشن
    const userName = req.session.user ? req.session.user.name : "المدير";

    const price = parseFloat(req.body.price) || 0;
    const paid = parseFloat(req.body.paid) || 0;

    const newCar = {
        id: Date.now(),
        brand: req.body.brand,
        model: req.body.model,
        year: req.body.year,
        chassis: req.body.chassis,
        engine: req.body.engine,
        color: req.body.color,
        price: price,
        paid: paid,
        remaining: price - paid,
        status: 'available',
        notes: req.body.notes || "",

        // 2. تسجيل مين اللي ضاف العربية
        createdBy: userName,
        createdAt: new Date().toLocaleString('ar-EG')
    };

    db.cars.push(newCar);

    if (paid > 0) {
        db.payments.push({
            chassis: req.body.chassis,
            amount: paid,
            rate: 1,
            currency: 'EGP',
            date: new Date().toLocaleDateString('ar-EG'),

            // 3. تسجيل مين اللي استلم الفلوس دي ودخلها الخزنة
            receivedBy: userName
        });
    }

    writeDB(db);
    res.redirect('/cars');
});

// --- 4. الموظفين ---
app.get('/employees', (req, res) => {
    const db = readDB();
    const allExpenses = db.expenses || [];
    const updatedEmployees = db.employees.map(emp => {
        const empTransactions = allExpenses.filter(e => e.reason && e.reason.includes(emp.name));
        const loans = empTransactions.filter(e => e.category === 'سلفة' || e.category === 'مرتب').reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const deductions = empTransactions.filter(e => e.category === 'خصم').reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        return { ...emp, totalPaid: loans, totalDeductions: deductions, netSalary: (parseFloat(emp.salary) || 0) - loans - deductions };
    });
    res.render('employees', { employees: updatedEmployees });
});

app.post('/add-employee', (req, res) => {
    const db = readDB();
    const { name, position, salary } = req.body;
    db.employees.push({ id: Date.now(), name: name.trim(), position, salary: parseFloat(salary) || 0 });
    writeDB(db);
    res.redirect('/employees');
});

// --- 5. الخزنة العامة ---
app.get('/expenses', (req, res) => {
    const db = readDB();
    const getCurrBalance = (curr) => {
        let inc = db.expenses.filter(e => e.type === 'in' && (e.currency === curr || (!e.currency && curr === 'EGP'))).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        let out = db.expenses.filter(e => e.type === 'out' && (e.currency === curr || (!e.currency && curr === 'EGP'))).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        return inc - out;
    };
    res.render('expenses', { expenses: db.expenses, balEGP: getCurrBalance('EGP'), balUSD: getCurrBalance('USD'), balEUR: getCurrBalance('EUR') });
});

app.post('/add-expense', (req, res) => {
    const db = readDB();

    // تأكد إن السطر ده بيجيب الاسم من السيشن صح
    const creator = req.session.user ? req.session.user.name : "المدير";

    db.expenses.push({
        id: Date.now(),
        ...req.body, // بياخد البيان والنوع والفئة والعملة من الفورم
        amount: parseFloat(req.body.amount) || 0,
        date: new Date().toLocaleDateString('ar-EG'),
        createdAt: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),

        // السطر السحري اللي هيخلي "بلال" يظهر في الجدول
        createdBy: creator
    });

    writeDB(db);
    res.redirect('/expenses'); // بيرجعك لصفحة المصاريف عشان تشوف النتيجة
});

// --- 6. مبيعات البنك والكاش ---
app.get('/bank-transfers', (req, res) => {
    const db = readDB();
    res.render('bank_transfers', {
        transfers: db.bankTransfers,
        cars: db.cars.filter(c => c.status !== 'sold'),
        rates: exchangeRates // بعتنا الأسعار هنا
    });
});

app.post('/add-transfer', upload.single('transferImage'), (req, res) => {
    const db = readDB();
    
    // 1. استلام البيانات من الفورم
    const { carId, targetAccount, refNumber, amount, currency } = req.body;
    const val = parseFloat(amount) || 0;
    const curr = currency || 'EGP';
    const imagePath = req.file ? '/uploads/' + req.file.filename : null;

    // --- منطقة الربط السحري مع الجرد والتقارير ---
    const carIndex = db.cars.findIndex(c => c.id == carId);
    let carChassis = "غير محدد";
    let amountInEGP = val;

    // تحويل المبلغ لجنيه بناءً على سعر الصرف المتوفر في السيستم
    if (curr === 'USD') {
        amountInEGP = val * (typeof exchangeRates !== 'undefined' ? exchangeRates.USD : 50);
    } else if (curr === 'EUR') {
        amountInEGP = val * (typeof exchangeRates !== 'undefined' ? exchangeRates.EUR : 54);
    }

    if (carIndex !== -1) {
        carChassis = db.cars[carIndex].chassis;

        // تحديث خانة المدفوع في جدول السيارات مباشرة
        db.cars[carIndex].paid = (Number(db.cars[carIndex].paid) || 0) + amountInEGP;

        // لو المدفوع وصل لسعر البيع أو عداه.. العربية حالتها بتبقى Sold أوتوماتيك
        if (db.cars[carIndex].paid >= parseFloat(db.cars[carIndex].price)) {
            db.cars[carIndex].status = 'sold';
        }
    }

    // تجهيز بيانات التحويل للحفظ
    const transferData = {
        id: Date.now(),
        date: new Date().toLocaleDateString('ar-EG'),
        chassis: carChassis,
        bankName: targetAccount,
        refNumber: refNumber,
        amount: val,
        currency: curr,
        image: imagePath,
        note: `تحويل بنكي (${targetAccount}) لشاسيه: ${carChassis}`
    };

    // 2. الحفظ في جدول التحويلات البنكية
    if (!db.bankTransfers) db.bankTransfers = [];
    db.bankTransfers.push(transferData);

    // 3. الحفظ في جدول المصاريف (نوع In) عشان تظهر في "الدرج" في التقارير
    if (!db.expenses) db.expenses = [];
    db.expenses.push({ 
        id: Date.now() + 1,
        date: transferData.date,
        amount: amountInEGP, 
        reason: transferData.note, 
        type: 'in', 
        category: 'مبيعات بنكية' 
    });

    // 4. الحفظ في جدول الـ Payments (ده أهم جدول لصفحة الجرد اللي بعتها في الأول)
    if (!db.payments) db.payments = [];
    db.payments.push({ 
        chassis: carChassis, 
        amount: amountInEGP, 
        rate: 1, 
        currency: 'EGP',
        date: new Date().toISOString()
    });

    // حفظ كل التغييرات في ملف database.json
    writeDB(db);

    // إعادة التوجيه لصفحة التحويلات
    res.redirect('/bank-transfers');
});

// --- 7. الاستيراد (الرادار) ---
app.get('/import', (req, res) => {
    const db = readDB();
    const payments = db.payments || [];

    // 1. تصفية سيارات الرادار (اللي لسه تحت الشحن)
    const radarCars = db.cars.filter(c => c.status === 'shipping').map(car => {
        const paidSoFar = payments
            .filter(p => p.chassis === car.chassis)
            .reduce((sum, p) => sum + (parseFloat(p.amount) * (p.currency === 'USD' ? 50 : 1)), 0);

        return {
            id: car.id,
            name: `${car.brand} ${car.model} (${car.year})`,
            chassis: car.chassis,
            customerName: car.customerName || "غير محدد",
            salesName: car.salesName || "الإدارة",
            expectedArrival: car.expectedArrival,
            status: car.shippingStatus || "تجهيز",
            totalPrice: parseFloat(car.price) || 0,
            paidSoFar: paidSoFar
        };
    });

    // 2. تصفية سيارات الأرشيف (العربيات اللي اتباعت عن طريق الرادار)
    // بنفلتر أي عربية حالتها sold وليها اسم عميل (عشان نضمن إنها جاية من الرادار)
    const archivedCars = db.cars.filter(c => c.status === 'sold' && c.customerName).map(car => {
        const totalPaid = payments
            .filter(p => p.chassis === car.chassis)
            .reduce((sum, p) => sum + (parseFloat(p.amount) * (p.currency === 'USD' ? 50 : 1)), 0);

        return {
            id: car.id,
            name: `${car.brand} ${car.model} (${car.year})`,
            chassis: car.chassis,
            customerName: car.customerName,
            deliveryDate: car.deliveryDate || car.date,
            totalPrice: parseFloat(car.price) || 0,
            totalPaid: totalPaid
        };
    });

    // إرسال المصفوفين لصفحة الرادار
    res.render('import', {
        imports: radarCars,
        archived: archivedCars
    });
});

app.post('/update-import-payment', (req, res) => {
    const db = readDB();
    const { importId, amount, status, type } = req.body;
    const carIdx = db.cars.findIndex(c => c.id == importId);

    if (carIdx !== -1) {
        const car = db.cars[carIdx];

        if (type === 'collection' && amount) {
            const val = parseFloat(amount);
            if (!db.payments) db.payments = [];
            db.payments.push({
                chassis: car.chassis,
                amount: val,
                currency: 'EGP',
                rate: 1,
                date: new Date().toLocaleDateString('ar-EG'),
                note: `تحصيل من الرادار - ${car.brand}`
            });

            if (!db.expenses) db.expenses = [];
            db.expenses.push({
                id: Date.now(),
                amount: val,
                type: 'in',
                category: 'مبيعات كاش',
                reason: `تحصيل متبقي سيارة: ${car.chassis}`,
                date: new Date().toLocaleDateString('ar-EG'),
                currency: 'EGP'
            });
        } else if (type === 'status_only' && status) {
            car.shippingStatus = status;
        }
        writeDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "السيارة غير موجودة" });
    }
});

app.post('/complete-delivery', (req, res) => {
    const db = readDB();
    const { importId } = req.body;
    const carIdx = db.cars.findIndex(c => c.id == importId);
    if (carIdx !== -1) {
        db.cars[carIdx].status = 'sold';
        db.cars[carIdx].deliveryDate = new Date().toLocaleDateString('ar-EG');
        writeDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false });
    }
});

// --- 8. إدارة التعاقدات ---
app.get('/contracts', (req, res) => {
    const db = readDB();
    res.render('contracts', {
        contracts: db.contracts || [],
        cars: db.cars.filter(c => c.status === 'available'),
        rates: exchangeRates // بعتنا الأسعار هنا
    });
});

app.post('/add-contract', upload.single('transferImage'), (req, res) => {
    const db = readDB();
    const { customerName, customerPhone, chassis, brand, carModel, totalPrice, amount, targetAccount, year } = req.body;
    const valPaid = parseFloat(amount) || 0;
    const valTotal = parseFloat(totalPrice) || 0;

    let carIdx = db.cars.findIndex(c => c.chassis === chassis);
    if (carIdx === -1) {
        db.cars.push({
            id: Date.now(),
            chassis: chassis,
            brand: brand,
            model: carModel,
            year: year || "",
            status: 'contracted',
            price: valTotal,
            customerName: customerName,
            date: new Date().toLocaleDateString('ar-EG')
        });
    }

    const newContract = {
        id: Date.now(),
        date: new Date().toLocaleDateString('ar-EG'),
        customerName, customerPhone, chassis, brand, carModel,
        totalPrice: valTotal,
        amount: valPaid,
        targetAccount: targetAccount || "كاش (الخزنة)",
        status: "جاري إرسال فيديو الفحص"
    };

    if (!db.contracts) db.contracts = [];
    db.contracts.push(newContract);

    if (!db.payments) db.payments = [];
    db.payments.push({
        chassis: chassis,
        amount: valPaid,
        rate: targetAccount && targetAccount.includes('دولار') ? 50 : 1,
        currency: targetAccount && targetAccount.includes('دولار') ? 'USD' : 'EGP',
        date: newContract.date
    });

    if (targetAccount && targetAccount !== "كاش (الخزنة)") {
        const transfer = {
            id: Date.now() + 1,
            date: newContract.date,
            bankName: targetAccount,
            amount: valPaid,
            chassis: chassis,
            refNumber: "عقد: " + customerName,
            note: `مقدم تعاقد شاسيه: ${chassis}`
        };
        db.bankTransfers.push(transfer);
        db.expenses.push({ ...transfer, reason: transfer.note, type: 'in', category: 'مبيعات بنكية' });
    } else {
        db.expenses.push({
            id: Date.now() + 1,
            date: newContract.date,
            amount: valPaid,
            type: 'in',
            category: 'مبيعات كاش',
            reason: `مقدم تعاقد كاش - عميل: ${customerName}`,
            currency: 'EGP'
        });
    }
    writeDB(db);
    res.redirect('/contracts');
});

// ضيف upload.single('receipt80') عشان يفك تشفير البيانات ويستلم الصورة
app.post('/pay-80-percent', upload.single('receipt80'), (req, res) => {
    const db = readDB();

    // دلوقتى multer هيملا req.body بالبيانات وهيملا req.file بالصورة
    const { contractId, amount80, payMethod, targetAccount, chassis } = req.body;
    const val80 = parseFloat(amount80) || 0;

    // البحث عن العقد
    const cIdx = db.contracts.findIndex(c => c.id == contractId);

    if (cIdx !== -1) {
        const contract = db.contracts[cIdx];

        // حساب تاريخ الوصول المتوقع (بعد 90 يوم)
        const arrivalDate = new Date();
        arrivalDate.setDate(arrivalDate.getDate() + 90);
        const expectedArrivalISO = arrivalDate.toISOString();

        // 1. تحديث بيانات العقد وإضافة رابط صورة الإيصال
        contract.payment80 = val80;
        contract.status = "تم الشحن - محول للرادار";
        contract.chassis = chassis;
        // حفظ مسار الصورة لو اترفت، ولو مفيش بيفضل القديم أو null
        if (req.file) {
            contract.receipt80 = '/uploads/' + req.file.filename;
        }

        // 2. تحديث قائمة السيارات (الرادار)
        let carIdx = db.cars.findIndex(c => c.chassis === chassis);
        if (carIdx === -1) {
            db.cars.push({
                id: Date.now(),
                chassis: chassis,
                brand: contract.brand,
                model: contract.carModel,
                year: contract.year || "",
                status: 'shipping',
                shippingStatus: 'تجهيز',
                expectedArrival: expectedArrivalISO,
                price: contract.totalPrice,
                customerName: contract.customerName,
                date: new Date().toLocaleDateString('ar-EG')
            });
        } else {
            db.cars[carIdx].status = 'shipping';
            db.cars[carIdx].shippingStatus = 'تجهيز';
            db.cars[carIdx].expectedArrival = expectedArrivalISO;
        }

        // 3. إضافة الحركة المالية لقائمة المدفوعات
        if (!db.payments) db.payments = [];
        db.payments.push({
            chassis: chassis,
            amount: val80,
            rate: targetAccount && targetAccount.includes('دولار') ? 50 : 1,
            currency: targetAccount && targetAccount.includes('دولار') ? 'USD' : 'EGP',
            date: new Date().toLocaleDateString('ar-EG')
        });

        // 4. ترحيل البيانات للبنك أو الخزنة
        const reasonStr = `دفعة 80% - عميل: ${contract.customerName}`;
        if (payMethod === 'bank') {
            if (!db.bankTransfers) db.bankTransfers = [];
            db.bankTransfers.push({
                id: Date.now(),
                amount: val80,
                bankName: targetAccount,
                chassis: chassis,
                note: reasonStr,
                date: new Date().toLocaleDateString('ar-EG')
            });
            db.expenses.push({
                id: Date.now() + 2,
                amount: val80,
                reason: reasonStr,
                type: 'in',
                category: 'مبيعات بنكية',
                currency: targetAccount.includes('دولار') ? 'USD' : 'EGP',
                date: new Date().toLocaleDateString('ar-EG')
            });
        } else {
            db.expenses.push({
                id: Date.now() + 2,
                amount: val80,
                type: 'in',
                category: 'مبيعات كاش',
                reason: reasonStr,
                currency: 'EGP',
                date: new Date().toLocaleDateString('ar-EG')
            });
        }

        writeDB(db);
        res.redirect('/contracts');
    } else {
        res.status(404).send("العقد غير موجود");
    }
});

// --- 9. معاملات الموظفين ---
app.post('/add-employee-transaction', (req, res) => {
    const db = readDB();
    const { empName, type, amount } = req.body;
    const val = parseFloat(amount) || 0;
    let transactionDirection = (type === 'خصم') ? 'penalty' : 'out';

    const newTransaction = {
        id: Date.now(),
        date: new Date().toLocaleDateString('ar-EG'),
        amount: val,
        type: transactionDirection,
        category: type,
        reason: `${type} للموظف: ${empName}`,
        currency: 'EGP'
    };

    if (!db.expenses) db.expenses = [];
    db.expenses.push(newTransaction);
    writeDB(db);
    res.redirect('/employees');
});
// --- راوت صفحة الأرشيف المستقلة ---
// --- راوت صفحة الأرشيف المستقلة ---
app.get('/archive', (req, res) => {
    const db = readDB();

    // تعديل الفلترة: بنجيب أي عربية sold حتى لو معندهاش customerName (عشان تشمل الكاش)
    const archivedCars = (db.cars || []).filter(c => c.status === 'sold').map(car => {
        return {
            id: car.id,
            brand: car.brand, // ضفنا الماركة عشان الأرشيف ميضربش
            model: car.model,
            year: car.year,
            chassis: car.chassis,
            customerName: car.customerName || "عميل معرض", // لو مفيش اسم عميل استيراد
            salesName: car.salesName || car.addedBy || "الإدارة",
            deliveryDate: car.deliveryDate || new Date().toLocaleDateString('ar-EG'),
            totalPrice: parseFloat(car.price) || parseFloat(car.buyPrice) || 0,
            addedBy: car.addedBy || 'المدير',
            addedDate: car.addedDate || ''
        };
    });

    // بنبعت المتغيرين (cars و imports) عشان نرضي ملف الـ EJS القديم والجديد
    res.render('archive', { 
        imports: archivedCars, 
        cars: archivedCars, 
        user: req.session.user || { name: 'المدير', role: 'admin' } 
    });
});
// --- راوت أرشيف الجرد الفوري (cars_archive) ---
app.get('/cars_archive', (req, res) => {
    const db = readDB();
    const payments = db.payments || [];

    // هنجيب العربيات اللي حالتها sold بس اللي ملهاش بيانات استيراد (يعني مبيعات المعرض الفورية)
    const carsArchiveData = db.cars.filter(c => c.status === 'sold' && !c.shippingStatus).map(car => {
        // حساب مالي سريع
        const totalPaid = payments
            .filter(p => p.chassis === car.chassis)
            .reduce((sum, p) => sum + (parseFloat(p.amount) * (p.currency === 'USD' ? 50 : 1)), 0);

        return {
            ...car,
            price: parseFloat(car.price) || 0,
            paid: totalPaid,
            remaining: Math.max(0, (parseFloat(car.price) || 0) - totalPaid)
        };
    });

    // إرسال البيانات للملف اللي إنت سميته cars_archive.ejs
    res.render('cars_archive', { cars: carsArchiveData });
});
// 1. مسار عرض الصفحة (GET)
app.get('/cash-payments', (req, res) => {
    const db = readDB();
    // بنبعت العربيات اللي لسه متباعتش بس عشان نختار منها
    const availableCars = db.cars.filter(c => c.status !== 'sold');

    res.render('cash_payments', {
        user: req.session.user,
        cars: availableCars,
        payments: db.payments || [] // سجل الفواتير السابقة
    });
});

// 2. مسار تسجيل الفاتورة والخصم التلقائي (POST)
app.post('/add-cash-payment', (req, res) => {
    const db = readDB();
    const { customerName, chassis, currency, amount, rate } = req.body;

    const val = parseFloat(amount) || 0;
    const exchangeRate = parseFloat(rate) || 1;
    const totalInEGP = val * exchangeRate;

    // البحث عن السيارة بالشاسيه
    const carIndex = db.cars.findIndex(c => c.chassis === chassis);

    if (carIndex !== -1) {
        // 1. تحويل البيانات لأرقام لضمان الحساب الصحيح
        let currentPaid = parseFloat(db.cars[carIndex].paid) || 0;
        let carPrice = parseFloat(db.cars[carIndex].price) || 0;

        // 2. تحديث المدفوع
        db.cars[carIndex].paid = currentPaid + totalInEGP;

        // 3. التغيير التلقائي للحالة (Automatic Status Update)
        // لو المدفوع الجديد أكبر من أو يساوي السعر، والسعر مش صفر
        if (db.cars[carIndex].paid >= carPrice && carPrice > 0) {
            db.cars[carIndex].status = 'sold';
        }
    }

    // تسجيل الفاتورة في السجلات
    const newPayment = {
        id: Date.now(),
        date: new Date().toLocaleDateString('ar-EG'),
        customerName,
        chassis,
        amount: val,
        currency,
        rate: exchangeRate,
        totalEGP: totalInEGP,
        reason: `فاتورة كاش - عميل: ${customerName} - شاسيه: ${chassis}`
    };

    if (!db.payments) db.payments = [];
    db.payments.push(newPayment);

    // تحديث الإيرادات العامة
    db.expenses.push({
        id: Date.now(),
        date: newPayment.date,
        reason: newPayment.reason,
        amount: totalInEGP,
        type: 'in',
        category: 'مبيعات كاش'
    });

    writeDB(db);
    res.redirect('/cash-payments');
});
// 1. راوت إضافة تعاقد جديد (المقدم)
app.post('/add-contract', (req, res) => {
    const db = readDB();
    const {
        customerName, customerPhone, chassis, brand,
        carModel, year, salesName, totalPrice, amount, targetAccount
    } = req.body;

    // إنشاء العقد
    const newContract = {
        id: Date.now(),
        date: new Date().toLocaleDateString('en-GB'),
        customerName,
        customerPhone,
        chassis,
        brand,
        carModel,
        year,
        salesName,
        totalPrice: parseFloat(totalPrice) || 0,
        amount: parseFloat(amount) || 0, // مبلغ الحجز
        payment80: 0,
        status: 'تعاقد جديد',
        targetAccount // الحساب اللي اخترته
    };

    if (!db.contracts) db.contracts = [];
    db.contracts.push(newContract);

    // --- الربط مع الحسابات البنكية ---
    if (db.accounts) {
        const account = db.accounts.find(a => a.name === targetAccount);
        if (account) {
            const val = parseFloat(amount);
            account.balance = (parseFloat(account.balance) || 0) + val;

            if (!account.transactions) account.transactions = [];
            account.transactions.push({
                id: Date.now() + 1,
                date: new Date().toLocaleDateString('en-GB'),
                type: 'وارد',
                amount: val,
                description: `مقدم تعاقد: ${customerName} - سيارة ${brand} (${chassis})`
            });
        }
    }

    saveDB(db);
    res.redirect('/contracts');
});

// 2. راوت دفع الـ 80% والتحويل للرادار
app.post('/pay-80-percent', (req, res) => {
    const db = readDB();
    const { contractId, amount80, targetAccount } = req.body;

    const contract = db.contracts.find(c => c.id == contractId);
    if (contract) {
        const val80 = parseFloat(amount80) || 0;
        contract.payment80 = (parseFloat(contract.payment80) || 0) + val80;
        contract.status = 'محول للشحن (رادار)';

        // --- الربط مع الحسابات البنكية ---
        if (db.accounts) {
            const account = db.accounts.find(a => a.name === targetAccount);
            if (account) {
                account.balance = (parseFloat(account.balance) || 0) + val80;

                if (!account.transactions) account.transactions = [];
                account.transactions.push({
                    id: Date.now() + 2,
                    date: new Date().toLocaleDateString('en-GB'),
                    type: 'وارد',
                    amount: val80,
                    description: `دفع 80%: ${contract.customerName} - شاسيه ${contract.chassis}`
                });
            }
        }
    }

    saveDB(db);
    res.redirect('/contracts');
});
app.get('/calculator', (req, res) => {
    res.render('calculator', { rates: exchangeRates });
});
// راوت فتح صفحة تحرير العقد من الصفحة الرئيسية
app.get('/write-contract', (req, res) => {
    // بنبعت كائن (c) فاضي عشان الصفحة متضربش وهي بتحاول تقرأ البيانات
    res.render('write_contract', { c: {} });
});
// جوه سكريبت صفحة reports.ejs
function exportExcel() {
    const startDate = document.querySelector('input[name="startDate"]').value;
    const endDate = document.querySelector('input[name="endDate"]').value;
    const userFilter = document.querySelector('select[name="userFilter"]').value;
    
    // بيبعت الموظف لمسار الـ export مع الفلاتر الحالية
    window.location.href = `/reports/export?startDate=${startDate}&endDate=${endDate}&userFilter=${userFilter}`;
}

// صفحة تسجيل الدخول
app.get('/login', (req, res) => {
    res.render('login');
});

// عملية تسجيل الدخول
// عملية تسجيل الدخول المحسنة
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    // القراءة من الملف الجديد المنفصل
    const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        req.session.user = user;
        res.redirect('/');
    } else {
        res.render('login', { error: 'بيانات الدخول غير صحيحة' });
    }
});
// تسجيل الخروج
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});


// دالة "الحارس" - وظيفتها التأكد من وجود الأدمن دائماً
// امسح السطر اللي كان هنا
function protectAdmin() {
    try {
        const filePath = 'database.json';
        let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (!data.users || data.users.length === 0) {
            console.log("⚠️ تنبيه: تم اكتشاف محاولة مسح الأدمن.. جاري الاستعادة فوراً!");
            data.users = [
                {
                    "id": 1,
                    "name": "المدير العام",
                    "username": "admin",
                    "password": "123",
                    "role": "admin"
                }
            ];
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error("خطأ في حارس البيانات");
    }
}

app.use((req, res, next) => {
    protectAdmin();
    next();
});

// تشغيل الحارس كل ما حد يطلب أي صفحة في السيستم
app.use((req, res, next) => {
    protectAdmin();
    next();
});
app.get('/purchase-invoices', (req, res) => {
    // لازم نمرر بيانات المستخدم عشان الـ Navbar يشتغل وميطلعش Error
    res.render('purchase_invoices', { user: req.session.user });
});
app.get('/reports', (req, res) => {
    const db = readDB();
    const { startDate, endDate, userFilter } = req.query;

    // 1. تجميع كل الموظفين (لضمان ظهور الجميع في القائمة والجدول)
    let allStaff = [];
    const seenNames = new Set();
    const addStaff = (list, roleDefault) => {
        if (Array.isArray(list)) {
            list.forEach(s => {
                if (!seenNames.has(s.name)) {
                    allStaff.push({ name: s.name, salary: Number(s.salary) || 0, position: s.position || roleDefault });
                    seenNames.add(s.name);
                }
            });
        }
    };
    addStaff(db.employees, 'موظف');
    addStaff(db.users, 'إدارة');

    // 2. فلترة المصاريف
    let expenses = Array.isArray(db.expenses) ? db.expenses : [];
    if (startDate && endDate) {
        expenses = expenses.filter(exp => exp.date >= startDate && exp.date <= endDate);
    }

    // 3. الحساب الدقيق لأرباح السيارات (حل مشكلة الصفر في سعر البيع)
   // البحث عن مبيعات السيارات وحساب الأرباح بدقة
const carProfits = (db.cars || []).filter(c => c.status === 'sold').map(car => {
    const buyPrice = Number(car.buyPrice) || 0; // سعر الشراء (2,000,000)
    
    // التعديل السحري هنا: السيستم عندك بيستخدم كلمة 'paid' لسعر البيع
    const sellPrice = Number(car.paid) || Number(car.sellingPrice) || 0; 
    
    // حساب أي مصاريف إضافية مربوطة بشاسيه العربية
    const extraCosts = (db.expenses || [])
        .filter(e => e.carChassis === car.chassis)
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);

    return {
        type: car.brand + " " + (car.model || ""), // هيظهر: مرسيدس 2025
        chassis: car.chassis,
        cost: buyPrice + extraCosts,
        sellingPrice: sellPrice, // كدة هيقرأ الـ 2,700,000 صح
        profit: sellPrice - (buyPrice + extraCosts) // كدة هيحسب الـ 700,000 صح
    };
});

    // 4. إجماليات التقرير
    const totalCarProfit = carProfits.reduce((s, c) => s + c.profit, 0);
    const totalOut = expenses.filter(e => e.type === 'out' || e.type === 'penalty').reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalIn = expenses.filter(e => e.type === 'in').reduce((s, e) => s + (Number(e.amount) || 0), 0);

    res.render('reports', {
        user: req.session.user || { name: 'المدير العام', role: 'admin' },
        employees: allStaff,
        expenses: expenses,
        filters: req.query || {},
        drawerCash: (totalIn - totalOut) + totalCarProfit,
        netProfit: totalCarProfit - totalOut, // صافي الربح الحقيقي
        carProfits: carProfits,
        totalLoans: expenses.filter(e => e.category === 'سلفة').reduce((s, e) => s + (Number(e.amount) || 0), 0),
        totalPenalties: expenses.filter(e => e.category === 'خصم').reduce((s, e) => s + (Number(e.amount) || 0), 0),
        totalSalaries: expenses.filter(e => e.category === 'مرتب').reduce((s, e) => s + (Number(e.amount) || 0), 0),
        totalGeneralExpenses: expenses.filter(e => e.category === 'مصاريف عامة').reduce((s, e) => s + (Number(e.amount) || 0), 0),
        inventoryCount: (db.cars || []).filter(c => c.status !== 'sold').length,
        lastUpdate: new Date().toLocaleString('ar-EG')
    });
});
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 السيستم شغال ومربوط بالكامل على http://localhost:${PORT}`);
});