const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, teacherOrAdmin } = require('../middleware/auth');
const { addNotification, getChildIds } = require('../utils');

// Дитина під керуванням батька не має логіна — сповіщення йдуть батькові
function notifyStudentOrParent(db, studentId, text, type) {
  const row = db.prepare('SELECT parent_id, managed_by_parent FROM users WHERE id = ?').get(studentId);
  const target = (row && row.managed_by_parent && row.parent_id) ? row.parent_id : studentId;
  addNotification(target, text, type);
}

function formatHW(h) {
  return {
    id: h.id,
    studentId: h.student_id,
    teacherId: h.teacher_id,
    title: h.title,
    desc: h.desc,
    due: h.due,
    done: !!h.done,
    doneAt: h.done_at,
    grade: h.grade,
    fileUrl: h.file_url,
    fileName: h.file_name,
    audioBase64: h.audio_base64,
    createdAt: h.created_at,
  };
}

// ── GET /api/homework ─────────────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user;
    let hw;

    if (me.role === 'admin') {
      hw = db.prepare('SELECT * FROM homework ORDER BY created_at DESC').all();
    } else if (me.role === 'teacher') {
      hw = db.prepare('SELECT * FROM homework WHERE teacher_id = ? ORDER BY created_at DESC').all(me.id);
    } else if (me.role === 'student') {
      hw = db.prepare('SELECT * FROM homework WHERE student_id = ? ORDER BY created_at DESC').all(me.id);
    } else if (me.role === 'parent') {
      const childIds = getChildIds(db, me.id);
      hw = childIds.length
        ? db.prepare(`SELECT * FROM homework WHERE student_id IN (${childIds.map(() => '?').join(',')}) ORDER BY created_at DESC`).all(...childIds)
        : [];
    } else {
      hw = [];
    }

    res.json({ homework: hw.map(formatHW) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/homework ────────────────────────────────────────
router.post('/', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const { studentId, teacherId, title, desc, due, fileUrl, fileName, audioBase64 } = req.body;
    if (!studentId || !title) return res.status(400).json({ error: 'Студент та назва обов\'язкові' });

    const effectiveTeacherId = teacherId || req.user.id;
    const id = uuidv4();

    db.prepare(`
      INSERT INTO homework (id, student_id, teacher_id, title, desc, due, file_url, file_name, audio_base64)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, studentId, effectiveTeacherId, title, desc || null, due || null,
           fileUrl || null, fileName || null, audioBase64 || null);

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(id);
    notifyStudentOrParent(db, studentId, `Нове домашнє завдання: "${title}" 📚`, 'homework');

    res.json({ homework: formatHW(hw) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/homework/:id ───────────────────────────────────
router.patch('/:id', auth, (req, res) => {
  try {
    const db = getDB();
    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(req.params.id);
    if (!hw) return res.status(404).json({ error: 'Завдання не знайдено' });

    const me = req.user;
    // Учень може тільки позначати done/audioBase64; вчитель може ставити оцінку;
    // батько може діяти від імені своєї (керованої) дитини
    const isOwnerParent = me.role === 'parent' && (() => {
      const st = db.prepare('SELECT parent_id FROM users WHERE id = ?').get(hw.student_id);
      return st && st.parent_id === me.id;
    })();
    if (me.role !== 'admin' && hw.teacher_id !== me.id && hw.student_id !== me.id && !isOwnerParent) {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }

    const updates = [];
    const vals = [];

    // Учень може відмітити виконання та прикріпити аудіо
    if (req.body.done !== undefined && (me.role === 'student' || me.role === 'admin' || me.role === 'teacher' || me.role === 'parent')) {
      updates.push('done = ?'); vals.push(req.body.done ? 1 : 0);
      if (req.body.done) {
        updates.push('done_at = ?'); vals.push(new Date().toISOString());
        if (hw.teacher_id) {
      addNotification(hw.teacher_id, `Учень виконав завдання "${hw.title}" ✅`, 'homework');
        }
      } else {
        updates.push('done_at = ?'); vals.push(null);
      }
    }

    if (req.body.audioBase64 !== undefined) {
      updates.push('audio_base64 = ?'); vals.push(req.body.audioBase64);
    }
    if (req.body.fileUrl !== undefined) {
      updates.push('file_url = ?'); vals.push(req.body.fileUrl);
    }
    if (req.body.fileName !== undefined) {
      updates.push('file_name = ?'); vals.push(req.body.fileName);
    }

    // Тільки вчитель/адмін може ставити оцінку
    if (req.body.grade !== undefined && ['teacher', 'admin'].includes(me.role)) {
      updates.push('grade = ?'); vals.push(req.body.grade);
      notifyStudentOrParent(db, hw.student_id, `Ви отримали оцінку "${req.body.grade}" за завдання "${hw.title}" 🏆`, 'grade');
    }

    if (!updates.length) return res.json({ homework: formatHW(hw) });
    vals.push(req.params.id);
    db.prepare(`UPDATE homework SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    const updated = db.prepare('SELECT * FROM homework WHERE id = ?').get(req.params.id);
    res.json({ homework: formatHW(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/homework/:id ──────────────────────────────────
router.delete('/:id', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(req.params.id);
    if (!hw) return res.status(404).json({ error: 'Завдання не знайдено' });

    if (req.user.role !== 'admin' && hw.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }
    db.prepare('DELETE FROM homework WHERE id = ?').run(req.params.id);
    res.json({ message: 'Завдання видалено' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
