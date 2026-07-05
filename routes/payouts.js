const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { addNotification } = require('../utils');

const PAYOUTS_DIR = path.join(__dirname, '..', 'uploads', 'payouts');
if (!fs.existsSync(PAYOUTS_DIR)) fs.mkdirSync(PAYOUTS_DIR, { recursive: true });

function saveReceiptFromDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  if (base64.length > 15 * 1024 * 1024) return null;
  const extFromMime = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const ext = extFromMime[mime] || 'bin';
  const filename = `${uuidv4()}.${ext}`;
  fs.writeFileSync(path.join(PAYOUTS_DIR, filename), Buffer.from(base64, 'base64'));
  return `/uploads/payouts/${filename}`;
}

function formatPayout(p) {
  return {
    id: p.id,
    teacherId: p.teacher_id,
    amount: p.amount,
    note: p.note,
    receiptUrl: p.receipt_url,
    createdAt: p.created_at,
  };
}

// Заробіток вчителя: 175 грн (або індивідуальна ставка) за кожен ПРОВЕДЕНИЙ урок.
// Це рахуємо динамічно з таблиці lessons — жодних сум за навчання учнів вчитель не бачить.
function computeSummary(db, teacherId) {
  const teacher = db.prepare('SELECT rate_per_lesson FROM users WHERE id = ?').get(teacherId);
  const rate = (teacher && teacher.rate_per_lesson) || 175;

  const completedCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM lessons WHERE teacher_id = ? AND status = 'completed'"
  ).get(teacherId).cnt;

  const totalEarned = completedCount * rate;

  const totalPaid = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM payouts WHERE teacher_id = ?'
  ).get(teacherId).total;

  return {
    ratePerLesson: rate,
    completedLessons: completedCount,
    totalEarned,
    totalPaid,
    balance: Math.round((totalEarned - totalPaid) * 100) / 100,
  };
}

// ── GET /api/payouts/summary ───────────────────────────────────
// Вчитель бачить свій підсумок; адмін — підсумок будь-якого вчителя (?teacherId=)
router.get('/summary', auth, (req, res) => {
  try {
    const db = getDB();
    let teacherId = req.user.id;
    if (req.user.role === 'admin' && req.query.teacherId) {
      teacherId = req.query.teacherId;
    } else if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }
    res.json(computeSummary(db, teacherId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/payouts ──────────────────────────────────────────
// Історія виплат: вчитель бачить свої, адмін — усі (або конкретного вчителя)
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    let payouts;

    if (req.user.role === 'admin') {
      payouts = req.query.teacherId
        ? db.prepare('SELECT * FROM payouts WHERE teacher_id = ? ORDER BY created_at DESC').all(req.query.teacherId)
        : db.prepare('SELECT * FROM payouts ORDER BY created_at DESC').all();
    } else {
      payouts = db.prepare('SELECT * FROM payouts WHERE teacher_id = ? ORDER BY created_at DESC').all(req.user.id);
    }

    res.json({ payouts: payouts.map(formatPayout) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payouts ─────────────────────────────────────────
// Тільки адмін фіксує факт виплати вчителю (із чеком/скріншотом)
router.post('/', auth, adminOnly, (req, res) => {
  try {
    const db = getDB();
    const { teacherId, amount, note, receiptData } = req.body;
    if (!teacherId) return res.status(400).json({ error: 'Оберіть вчителя' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Вкажіть суму' });

    const teacher = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'teacher'").get(teacherId);
    if (!teacher) return res.status(404).json({ error: 'Вчителя не знайдено' });

    let receiptUrl = null;
    if (receiptData) {
      try { receiptUrl = saveReceiptFromDataUrl(receiptData); } catch (e) { console.error(e); }
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO payouts (id, teacher_id, amount, note, receipt_url, status)
      VALUES (?, ?, ?, ?, ?, 'paid')
    `).run(id, teacherId, amount, note || null, receiptUrl);

    const summary = computeSummary(db, teacherId);
    addNotification(
      teacherId,
      `💰 Вам надійшла виплата ${amount} грн. Залишок до сплати: ${summary.balance} грн`,
      'payout'
    );

    const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
    res.json({ payout: formatPayout(payout), summary });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/payouts/:id ────────────────────────────────────
// На випадок помилки — адмін може видалити запис про виплату
router.delete('/:id', auth, adminOnly, (req, res) => {
  try {
    const db = getDB();
    db.prepare('DELETE FROM payouts WHERE id = ?').run(req.params.id);
    res.json({ message: 'Запис видалено' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
