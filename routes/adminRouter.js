const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// تحديد مسار ملف المستخدمين
const usersFilePath = path.join(__dirname, '../users.json');

function readUsersFromFile() {
    try {
        if (!fs.existsSync(usersFilePath)) {
            const initialAdmin = [{ username: "admin", password: "123", role: "admin", name: "المدير العام", branch: "الكل" }];
            fs.writeFileSync(usersFilePath, JSON.stringify(initialAdmin, null, 2));
            return initialAdmin;
        }
        return JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
    } catch (err) {
        console.error("خطأ في قراءة ملف المستخدمين:", err);
        return [];
    }
}

router.get('/', (req, res) => {
    const usersList = readUsersFromFile();
    res.render('admin', { user: req.session.user, usersList: usersList });
});

router.post('/users/create', (req, res) => {
    try {
        const { name, username, password, branch, role } = req.body;
        const users = readUsersFromFile();
        users.push({ name, username, password, branch, role });
        fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("حدث خطأ أثناء حفظ بيانات الموظف");
    }
});

// --- API التقارير المصلح تماماً ---
router.get('/api/reports/detailed', (req, res) => {
    const { branch, from, to } = req.query;
    const dbPath = path.join(__dirname, '../database.json');
    
    if (!fs.existsSync(dbPath)) {
        return res.json({ totalContractValue: 0, totalCollected: 0, totalOwed: 0, contracts: [] });
    }

    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    let filtered = data.contracts || [];

    // 1. فلترة الفرع
    if (branch && branch !== 'all') {
        filtered = filtered.filter(c => c.branchName === branch);
    }

    // 2. فلترة التاريخ (تعديل جذري لضمان ظهور البيانات)
    if (from && to) {
        const start = new Date(from).setHours(0, 0, 0, 0);
        const end = new Date(to).setHours(23, 59, 59, 999);
        
        filtered = filtered.filter(c => {
            // تحويل تاريخ العقد (سواء كان timestamp أو نص) لرقم للمقارنة
            const cDate = new Date(c.timestamp || c.date).getTime();
            return cDate >= start && cDate <= end;
        });
    }

    let reportData = {
        totalContractValue: 0,
        totalCollected: 0,
        totalOwed: 0,
        contracts: []
    };

    filtered.forEach(c => {
        const price = Number(c.price) || 0;
        
        // الحسابات المالية الدقيقة (تطابق صفحة التعاقدات)
        const rateAtContract = Number(c.dep_currency_rate) || 1;
        const depositEgp = (Number(c.dep_value) || 0) * rateAtContract;
        
        const officePaid = (c.payments || []).reduce((sum, p) => sum + (Number(p.val) * Number(p.rate || 1)), 0);
        const bankPaid = (c.paymentHistory || []).reduce((sum, ph) => sum + Number(ph.amount), 0);
        
        const totalPaid = depositEgp + officePaid + bankPaid;
        const remaining = price - totalPaid;

        reportData.totalContractValue += price;
        reportData.totalCollected += totalPaid;
        reportData.totalOwed += remaining;

        reportData.contracts.push({
            contractNumber: c.id || 'N/A',
            clientName: c.name || 'عميل مجهول',
            branchName: c.branchName || 'غير محدد',
            carName: `${c.brand || ''} ${c.model || ''}`,
            totalPrice: price,
            bankPaid: bankPaid,
            officePaid: officePaid + depositEgp,
            remaining: remaining
        });
    });

    res.json(reportData);
});

module.exports = router;