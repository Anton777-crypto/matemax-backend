const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, teacherOrAdmin, adminOnly } = require('../middleware/auth');

// ── GET /api/payouts ──────────────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user;
    let payouts;

    if (me.role === 'admin') {
      payouts = db.prepare('SELECT * FROM payouts ORDER BY created_at DESC').all();
    } else {
      payouts = db.prepare('SELECT * FROM payouts WHERE teacher_id = ? ORDER BY created_at DESC').all(me.id);
    }

    res.json({ payouts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payouts ─────────────────────────────────────────
router.post('/', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const { amount, method, details } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Вкажіть суму' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO payouts (id, teacher_id, amount, method, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.user.id, amount, method || null, details || null);

    const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
    res.json({ payout });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/payouts/:id ────────────────────────────────────
router.patch('/:id', auth, adminOnly, (req, res) => {
  try {
    const db = getDB();
    const { status } = req.body;
    db.prepare('UPDATE payouts SET status = ? WHERE id = ?').run(status, req.params.id);
    const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(req.params.id);
    res.json({ payout });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
