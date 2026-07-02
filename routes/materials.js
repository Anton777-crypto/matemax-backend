const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, teacherOrAdmin } = require('../middleware/auth');

// ── GET /api/materials ────────────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user;
    let mats;

    if (['admin', 'teacher'].includes(me.role)) {
      mats = me.role === 'admin'
        ? db.prepare('SELECT * FROM materials ORDER BY uploaded_at DESC').all()
        : db.prepare('SELECT * FROM materials WHERE teacher_id = ? ORDER BY uploaded_at DESC').all(me.id);
    } else {
      // Учень/батько бачать матеріали
      mats = db.prepare('SELECT * FROM materials ORDER BY uploaded_at DESC').all();
    }

    res.json({ materials: mats.map(m => ({ ...m, grades: JSON.parse(m.grades || '[]') })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/materials ───────────────────────────────────────
router.post('/', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const { title, type, url, grades = [], subject } = req.body;
    if (!title) return res.status(400).json({ error: 'Назва обов\'язкова' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO materials (id, teacher_id, title, type, url, grades, subject)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, title, type || 'link', url || null,
           JSON.stringify(grades), subject || null);

    const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
    res.json({ material: { ...m, grades: JSON.parse(m.grades || '[]') } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/materials/:id ─────────────────────────────────
router.delete('/:id', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Матеріал не знайдено' });

    if (req.user.role !== 'admin' && m.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }
    db.prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);
    res.json({ message: 'Матеріал видалено' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
