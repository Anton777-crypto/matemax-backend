const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, teacherOrAdmin, adminOnly } = require('../middleware/auth');
const { addNotification } = require('../utils');

// ── GET /api/payments ─────────────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user;
    let payments;

    if (me.role === 'admin') {
      payments = db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all();
    } else if (me.role === 'teacher') {
      payments = db.prepare('SELECT * FROM payments WHERE teacher_id = ? ORDER BY created_at DESC').all(me.id);
    } else {
      payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY created_at DESC').all(me.id);
    }

    res.json({ payments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments ────────────────────────────────────────
router.post('/', auth, (req, res) => {
  try {
    const db = getDB();
    const { studentId, teacherId, amount, lessons = 1 } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Вкажіть суму' });

    const effStudentId = studentId || req.user.id;
    const effTeacherId = teacherId || req.user.id;
    const id = uuidv4();

    db.prepare(`
      INSERT INTO payments (id, student_id, teacher_id, amount, lessons, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(id, effStudentId, effTeacherId, amount, lessons);

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    addNotification(effTeacherId, `Новий платіж на суму ${amount} грн очікує підтвердження 💳`, 'payment');

    res.json({ payment });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/payments/:id ───────────────────────────────────
router.patch('/:id', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Платіж не знайдено' });

    const { status } = req.body;
    if (!['confirmed', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Невірний статус' });
    }

    db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(status, req.params.id);

    // Якщо підтверджено — поповнюємо баланс учня
    if (status === 'confirmed') {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payment.amount, payment.student_id);
      addNotification(payment.student_id, `Платіж ${payment.amount} грн підтверджено ✅ Баланс поповнено.`, 'payment');
    } else if (status === 'rejected') {
      addNotification(payment.student_id, `Платіж ${payment.amount} грн відхилено ❌`, 'payment');
    }

    const updated = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    res.json({ payment: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
