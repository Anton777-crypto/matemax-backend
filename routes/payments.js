const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, teacherOrAdmin, adminOnly } = require('../middleware/auth');
const { addNotification, getChildIds } = require('../utils');

const ALLOWED_CURRENCIES = ['UAH', 'EUR', 'USD'];
const RECEIPTS_DIR = path.join(__dirname, '..', 'uploads', 'receipts');
if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

// Приймає data URL (напр. "data:image/png;base64,...."), зберігає файл на диск
// і повертає відносний URL, за яким його віддає статика /uploads.
function saveReceiptFromDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;

  const mime = match[1];
  const base64 = match[2];

  // Обмежуємо розмір квитанції (~15MB у base64), щоб не засмічувати диск
  if (base64.length > 15 * 1024 * 1024) return null;

  const extFromMime = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const ext = extFromMime[mime] || 'bin';
  const filename = `${uuidv4()}.${ext}`;

  fs.writeFileSync(path.join(RECEIPTS_DIR, filename), Buffer.from(base64, 'base64'));
  return `/uploads/receipts/${filename}`;
}

function formatPayment(p) {
  return {
    id: p.id,
    studentId: p.student_id,
    teacherId: p.teacher_id,
    amount: p.amount,
    currency: p.currency || 'UAH',
    lessons: p.lessons,
    desc: p.desc,
    status: p.status,
    receiptUrl: p.receipt_url,
    receiptFilename: p.receipt_filename,
    adminComment: p.admin_comment,
    reviewedAt: p.reviewed_at,
    date: p.created_at,
    createdAt: p.created_at,
  };
}

// ── GET /api/payments ─────────────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user;
    let payments;

    if (me.role === 'admin') {
      payments = db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all();
    } else if (me.role === 'parent') {
      const childIds = getChildIds(db, me.id);
      payments = childIds.length
        ? db.prepare(`SELECT * FROM payments WHERE student_id IN (${childIds.map(() => '?').join(',')}) ORDER BY created_at DESC`).all(...childIds)
        : [];
    } else if (me.role === 'student') {
      payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY created_at DESC').all(me.id);
    } else {
      // Вчитель НЕ бачить суми оплат учнів школі — це конфіденційна інформація
      payments = [];
    }

    res.json({ payments: payments.map(formatPayment) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments ────────────────────────────────────────
// Учень/батько створює заявку на оплату: сума, валюта, опис, скріншот квитанції.
router.post('/', auth, (req, res) => {
  try {
    const db = getDB();
    const {
      studentId, teacherId, amount, lessons = 1, currency = 'UAH',
      desc, receiptBase64, receiptFilename,
    } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Вкажіть суму' });
    const normCurrency = String(currency || 'UAH').toUpperCase();
    if (!ALLOWED_CURRENCIES.includes(normCurrency)) {
      return res.status(400).json({ error: 'Невірна валюта. Дозволено: UAH, EUR, USD' });
    }

    // Якщо платить батько — оплачувати можна тільки за СВОЮ дитину
    let effStudentId = studentId || req.user.id;
    if (req.user.role === 'parent') {
      if (!studentId) return res.status(400).json({ error: 'Вкажіть дитину, за яку оплачуєте' });
      const child = db.prepare("SELECT id, parent_id FROM users WHERE id = ? AND role = 'student'").get(studentId);
      if (!child || child.parent_id !== req.user.id) {
        return res.status(403).json({ error: 'Ви можете оплачувати навчання лише власних дітей' });
      }
      effStudentId = studentId;
    }

    // Якщо викладача не передали — беремо закріпленого за учнем, інакше самого учня
    // (щоб не порушити NOT NULL у колонці teacher_id)
    let effTeacherId = teacherId;
    if (!effTeacherId) {
      const studentRow = db.prepare('SELECT teacher_id FROM users WHERE id = ?').get(effStudentId);
      effTeacherId = (studentRow && studentRow.teacher_id) || effStudentId;
    }

    const id = uuidv4();
    let receiptUrl = null;
    try {
      receiptUrl = saveReceiptFromDataUrl(receiptBase64);
    } catch (e) {
      console.error('Receipt save error:', e.message);
    }

    db.prepare(`
      INSERT INTO payments (id, student_id, teacher_id, amount, currency, lessons, desc, status, receipt_url, receipt_filename)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, effStudentId, effTeacherId, amount, normCurrency, lessons, desc || null, receiptUrl, receiptFilename || null);

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    const student = db.prepare('SELECT name FROM users WHERE id = ?').get(effStudentId);
    const studentName = (student && student.name) || 'Учень';

    // Сповіщаємо ВСІХ адміністраторів — саме вони підтверджують оплату
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    admins.forEach(a => {
      addNotification(a.id, `${studentName}: нова оплата ${amount} ${normCurrency} очікує підтвердження 💳`, 'payment');
    });
    // Також повідомляємо викладача, якщо він відрізняється від учня
    if (effTeacherId && effTeacherId !== effStudentId) {
      addNotification(effTeacherId, `${studentName} надіслав(ла) оплату ${amount} ${normCurrency} на підтвердження адміністратору`, 'payment');
    }

    res.json({ payment: formatPayment(payment) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/payments/:id ───────────────────────────────────
// Адмін (або викладач) підтверджує чи відхиляє оплату, з коментарем.
router.patch('/:id', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Платіж не знайдено' });

    const { status, comment } = req.body;
    if (!['confirmed', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Невірний статус' });
    }

    db.prepare(`
      UPDATE payments SET status = ?, admin_comment = ?, reviewed_at = datetime('now') WHERE id = ?
    `).run(status, comment || null, req.params.id);

    const currency = payment.currency || 'UAH';
    // Якщо платник — дитина під керуванням батька, усі сповіщення йдуть батькові
    // (у дитини немає власного логіна, вона нічого не побачить)
    const payerRow = db.prepare('SELECT parent_id, managed_by_parent, name FROM users WHERE id = ?').get(payment.student_id);
    const notifyTarget = (payerRow && payerRow.managed_by_parent && payerRow.parent_id) ? payerRow.parent_id : payment.student_id;
    const childLabel = (payerRow && payerRow.managed_by_parent) ? ` (${payerRow.name})` : '';

    if (status === 'confirmed') {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payment.amount, payment.student_id);
      // Активуємо дитину, якщо вона ще очікувала оплату (вчителя адмін призначає окремо вручну)
      db.prepare("UPDATE users SET activation_status = 'active' WHERE id = ? AND activation_status = 'pending_payment'")
        .run(payment.student_id);
      addNotification(notifyTarget, `Платіж ${payment.amount} ${currency}${childLabel} підтверджено ✅ Дякуємо!`, 'payment');
    } else if (status === 'rejected') {
      const contact = process.env.SUPPORT_CONTACT || 'адміністратора школи';
      const reason = comment ? ` Причина: ${comment}.` : '';
      addNotification(
        notifyTarget,
        `Оплату ${payment.amount} ${currency}${childLabel} не підтверджено.${reason} Зв'яжіться з ${contact} для уточнення.`,
        'payment'
      );
    }

    const updated = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    res.json({ payment: formatPayment(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
