const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, teacherOrAdmin } = require('../middleware/auth');
const { addNotification, getChildIds } = require('../utils');

function formatLesson(l) {
  return {
    id: l.id,
    studentId: l.student_id,
    teacherId: l.teacher_id,
    subject: l.subject,
    date: l.date,
    time: l.time,
    meetUrl: l.meet_url,
    trial: !!l.trial,
    status: l.status,
    notes: l.notes,
    createdAt: l.created_at,
  };
}

// ── GET /api/lessons ──────────────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user;
    let lessons;

    if (me.role === 'admin') {
      lessons = db.prepare('SELECT * FROM lessons ORDER BY date DESC, time DESC').all();
    } else if (me.role === 'teacher') {
      lessons = db.prepare('SELECT * FROM lessons WHERE teacher_id = ? ORDER BY date DESC, time DESC').all(me.id);
    } else if (me.role === 'student') {
      lessons = db.prepare('SELECT * FROM lessons WHERE student_id = ? ORDER BY date DESC, time DESC').all(me.id);
    } else if (me.role === 'parent') {
      // Батько бачить уроки своїх дітей
      const childIds = getChildIds(db, me.id);
      lessons = childIds.length
        ? db.prepare(`SELECT * FROM lessons WHERE student_id IN (${childIds.map(() => '?').join(',')}) ORDER BY date DESC, time DESC`).all(...childIds)
        : [];
    } else {
      lessons = [];
    }

    res.json({ lessons: lessons.map(formatLesson) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/lessons ─────────────────────────────────────────
router.post('/', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const { studentId, teacherId, subject, date, time, meetUrl, trial, notes } = req.body;
    if (!studentId || !date || !time) {
      return res.status(400).json({ error: 'Заповніть обов\'язкові поля (студент, дата, час)' });
    }

    const effectiveTeacherId = teacherId || req.user.id;
    const id = uuidv4();

    db.prepare(`
      INSERT INTO lessons (id, student_id, teacher_id, subject, date, time, meet_url, trial, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, studentId, effectiveTeacherId, subject || 'Математика', date, time,
           meetUrl || null, trial ? 1 : 0, notes || null);

    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);

    // Сповіщаємо учня
    addNotification(studentId, `Новий урок призначено на ${date} о ${time} 📅`, 'lesson');

    res.json({ lesson: formatLesson(lesson) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/lessons/:id ────────────────────────────────────
router.patch('/:id', auth, (req, res) => {
  try {
    const db = getDB();
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Урок не знайдено' });

    // Перевірка доступу
    if (req.user.role !== 'admin' && lesson.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }

    const allowed = ['subject', 'date', 'time', 'meet_url', 'meetUrl', 'status', 'notes', 'trial'];
    const fieldMap = { meetUrl: 'meet_url' };
    const updates = [];
    const vals = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const col = fieldMap[key] || key;
        updates.push(`${col} = ?`);
        vals.push(key === 'trial' ? (req.body[key] ? 1 : 0) : req.body[key]);
      }
    }

    if (!updates.length) return res.json({ lesson: formatLesson(lesson) });
    vals.push(req.params.id);
    db.prepare(`UPDATE lessons SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    const updated = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);

    // Якщо урок позначено як завершений — сповіщаємо учня
    if (req.body.status === 'completed') {
      addNotification(lesson.student_id, `Урок ${updated.date} завершено ✅`, 'lesson');
    }

    res.json({ lesson: formatLesson(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/lessons/:id ───────────────────────────────────
router.delete('/:id', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Урок не знайдено' });

    if (req.user.role !== 'admin' && lesson.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }

    db.prepare('DELETE FROM lessons WHERE id = ?').run(req.params.id);
    res.json({ message: 'Урок видалено' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
