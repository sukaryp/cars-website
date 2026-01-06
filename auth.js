const express = require('express');
const router = express.Router();
const fs = require('fs');

// 1. حارس التأكد من أن المستخدم "مدير"
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).render('error', { message: 'عذراً.. هذه المنطقة تتطلب صلاحيات القائد الأعلى فقط!' });
}

// 2. راوت عرض المستخدمين
// التعديل في auth.js
router.get('/users', isAdmin, (req, res) => {
    // تأكد إن المسار هنا هو users.json
    const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
    res.render('users', { users: users }); 
});

// 3. راوت إضافة مستخدم
router.post('/add-user', isAdmin, (req, res) => {
    const { name, username, password, role } = req.body;

    // 1. القراءة من ملف المستخدمين المنفصل
    // تأكد إنك عملت ملف اسمه users.json وحطيت فيه [] على الأقل
    const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));

    // 2. إضافة المستخدم الجديد للمصفوفة
    users.push({ id: Date.now(), name, username, password, role });

    // 3. الحفظ في ملف users.json فقط
    // كدة مهما حصل في database.json الأدمن هيفضل سليم
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

    res.redirect('/admin/users');
});

// 4. راوت مسح مستخدم (تأكد إنه قبل الـ exports)
router.get('/delete-user/:id', isAdmin, (req, res) => {
    const data = JSON.parse(fs.readFileSync('database.json', 'utf8'));
    data.users = data.users.filter(u => u.id != req.params.id);
    fs.writeFileSync('database.json', JSON.stringify(data, null, 2));
    res.redirect('/admin/users');
});

// 5. تصدير الراوتر (لازم يكون آخر سطر)
module.exports = router;