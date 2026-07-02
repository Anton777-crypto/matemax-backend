const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { auth } = require('../middleware/auth');

// ── GET /api/notifications ────────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY date DESC
      LIMIT 50
    `).all(req.user.id);

    res.json({
      notifications: notifications.map(n => ({
        id: n.id,
        type: n.type,
        text: n.text,
        date: n.date,
        read: !!n.read,
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/notifications/read-all ────────────────────────
router.patch('/read-all', auth, (req, res) => {
  try {
    const db = getDB();
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ message: 'Усі сповіщення позначено як прочитані' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
