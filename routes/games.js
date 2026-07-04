const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth } = require('../middleware/auth');

// ── GET /api/games/progress ───────────────────────────────────
router.get('/progress', auth, (req, res) => {
  try {
    const db = getDB();
    let targetId = req.user.id;

    // Батько грає "за дитину" — прогрес пишеться на ID дитини, не батька
    if (req.query.studentId && req.user.role === 'parent') {
      const child = db.prepare("SELECT id FROM users WHERE id = ? AND parent_id = ? AND role = 'student'").get(req.query.studentId, req.user.id);
      if (!child) return res.status(403).json({ error: 'Доступ заборонено' });
      targetId = child.id;
    }

    const rows = db.prepare('SELECT game_id, score FROM game_progress WHERE user_id = ?').all(targetId);
    const progress = {};
    for (const row of rows) progress[row.game_id] = row.score;
    res.json({ progress });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/games/progress ──────────────────────────────────
router.post('/progress', auth, (req, res) => {
  try {
    const db = getDB();
    const { gameId, score, studentId } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId обов\'язковий' });

    let targetId = req.user.id;
    if (studentId && req.user.role === 'parent') {
      const child = db.prepare("SELECT id FROM users WHERE id = ? AND parent_id = ? AND role = 'student'").get(studentId, req.user.id);
      if (!child) return res.status(403).json({ error: 'Доступ заборонено' });
      targetId = child.id;
    }

    // Зберігаємо лише якщо новий рекорд
    db.prepare(`
      INSERT INTO game_progress (id, user_id, game_id, score, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, game_id) DO UPDATE SET
        score = MAX(score, excluded.score),
        updated_at = excluded.updated_at
    `).run(uuidv4(), targetId, gameId, score || 0);

    res.json({ message: 'Прогрес збережено' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
