const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../database.json');

// دالة قراءة البيانات
function readDatabase() {
    try {
        if (!fs.existsSync(dbPath)) return { contracts: [], cashActions: [] };
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data || '{"contracts":[], "cashActions":[]}');
    } catch (err) {
        console.error("Error reading DB:", err);
        return { contracts: [], cashActions: [] };
    }
}

// دالة كتابة البيانات
function writeDatabase(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

// --- [ عرض الصفحة الرئيسية ] ---
router.get('/', (req, res) => {
    try {
        const data = readDatabase();
        // تأمين الجلسة وبيانات المستخدم
        const user = req.session.user || { role: 'user', branch: 'فرع غير معروف' }; 
        
        let allTransactions = [];
        let balances = { EGP: 0, USD: 0, EUR: 0 };
        let filteredContracts = [];

        // 1. تصفية العقود بناءً على الصلاحيات
        if (data.contracts && Array.isArray(data.contracts)) {
            // الموظف يرى عقود فرعه فقط، المدير يرى كل العقود
            filteredContracts = data.contracts.filter(c => user.role === 'admin' || c.branch === user.branch);

            filteredContracts.forEach(contract => {
                if (contract.payments && Array.isArray(contract.payments)) {
                    contract.payments.forEach(p => {
                        const val = Number(p.val) || 0;
                        // إضافة المدفوعات لرصيد الجنيه (بناءً على الفلترة أعلاه)
                        balances.EGP += val;
                        
                        allTransactions.push({
                            id: contract.id,
                            date: p.date,
                            type: 'إيداع عقد',
                            details: `دفعة من العميل: ${contract.name || 'مجهول'} (${contract.branch || ''})`,
                            amount: val,
                            currency: 'EGP',
                            // تنسيق رقم المرجع ليظهر بشكل احترافي
                            ref: contract.id.toString().startsWith('CAPT-') ? contract.id : `CAPT-${contract.id}`,
                            color: 'emerald',
                            canDelete: false // دفعات العقود مرتبطة بالعقد نفسه لا تحذف من هنا
                        });
                    });
                }
            });
        }

        // 2. معالجة حركات الدرج اليدوية بناءً على الصلاحيات
        if (data.cashActions && Array.isArray(data.cashActions)) {
            data.cashActions.forEach(act => {
                // فلترة: المدير يرى الكل، الموظف يرى فرعه فقط
                if (user.role === 'admin' || act.branch === user.branch) {
                    const amt = Number(act.amount) || 0;
                    const curr = act.currency || 'EGP';
                    
                    if (act.type === 'deposit') {
                        balances[curr] += amt;
                    } else {
                        balances[curr] -= amt;
                    }

                    allTransactions.push({
                        id: act.id,
                        date: act.date,
                        type: act.type === 'deposit' ? 'إيداع يدوي' : 'سحب يدوي',
                        details: `${act.details || 'بدون بيان'} (${act.branch || ''})`,
                        amount: amt,
                        currency: curr,
                        ref: 'الدرج',
                        color: act.type === 'deposit' ? 'emerald' : 'rose',
                        canDelete: true // الحركات اليدوية مسموح للمدير حذفها
                    });
                }
            });
        }

        // ترتيب الحركات من الأحدث للأقدم
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        // تحديد "آخر عقد" بناءً على الصلاحية (آخر عقد للفرع أو للنظام)
        const lastContractForDisplay = filteredContracts.length > 0 ? filteredContracts[filteredContracts.length - 1] : null;

        res.render('transfers', { 
            transactions: allTransactions, 
            balances: balances,
            lastContract: lastContractForDisplay,
            user: user 
        });

    } catch (err) {
        console.error("GET Transfers Error:", err);
        res.status(500).send("خطأ في تحميل صفحة الخزينة");
    }
});

// --- [ إضافة حركة جديدة ] ---
router.post('/add', (req, res) => {
    try {
        const data = readDatabase();
        if (!data.cashActions) data.cashActions = [];

        const newAction = {
            id: "TRX-" + Date.now(),
            date: new Date().toISOString(),
            type: req.body.type,
            amount: Number(req.body.amount) || 0,
            currency: req.body.currency || 'EGP',
            details: req.body.details || '',
            branch: req.session.user ? req.session.user.branch : 'غير محدد' // التأكد من وجود الجلسة
        };

        data.cashActions.push(newAction);
        writeDatabase(data);
        res.redirect('/transfers');
    } catch (err) {
        console.error("POST Add Action Error:", err);
        res.redirect('/transfers?error=1');
    }
});

// --- [ مسار الحذف - للمدير فقط ] ---
router.post('/delete/:id', (req, res) => {
    try {
        const user = req.session.user;
        // حماية إضافية: التحقق من الصلاحية برمجياً
        if (!user || user.role !== 'admin') {
            return res.status(403).send("غير مسموح لك بالحذف، هذه الصلاحية للمدير فقط.");
        }

        const data = readDatabase();
        // حذف الحركة من مصفوفة العمليات اليدوية فقط
        data.cashActions = data.cashActions.filter(act => act.id !== req.params.id);
        
        writeDatabase(data);
        res.redirect('/transfers');
    } catch (err) {
        console.error("Delete Error:", err);
        res.redirect('/transfers?error=delete');
    }
});

module.exports = router;