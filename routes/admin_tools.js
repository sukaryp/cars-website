const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../database.json');

router.post('/send-announcement', (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') {
            return res.status(403).send("غير مسموح");
        }

        // قراءة الملف الحالي
        let data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        // تحديث جزء الرسالة فقط
        data.announcement = {
            message: req.body.message,
            time: new Date().toISOString()
        };

        // حفظ البيانات
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

        // التوجيه لمسار محدد (الصفحة الرئيسية) بدلاً من back
        res.redirect('/'); 
        
    } catch (err) {
        console.error("Error saving announcement:", err);
        res.redirect('/');
    }
});

module.exports = router;