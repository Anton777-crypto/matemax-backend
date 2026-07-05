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

    // Сповіщаємо учня (або батька, якщо дитина під керуванням батька)
    notifyStudentOrParent(db, studentId, `Новий урок призначено на ${date} о ${time} 📅`, 'lesson');
    // Якщо урок для вчителя створив хтось інший (адмін) — сповіщаємо і вчителя
    if (effectiveTeacherId !== req.user.id) {
      addNotification(effectiveTeacherId, `Адміністратор додав вам новий урок: ${date} о ${time}${trial ? ' (пробний)' : ''} 📅`, 'lesson');
    }

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

    // Захист від передчасного/помилкового нарахування оплати:
    // вчитель НЕ може напряму позначити урок як "completed" — лише як
    // "pending_confirmation", остаточне підтвердження робить тільки адмін.
    if (req.body.status === 'completed' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Тільки адміністратор може підтвердити проведення уроку' });
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

    // Вчитель позначив урок проведеним — просимо адміна підтвердити
    if (req.body.status === 'pending_confirmation') {
      const teacher = db.prepare('SELECT name FROM users WHERE id = ?').get(lesson.teacher_id);
      const student = db.prepare('SELECT name FROM users WHERE id = ?').get(lesson.student_id);
      const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
      admins.forEach(a => addNotification(
        a.id,
        `${teacher?.name || 'Вчитель'} позначив урок з «${student?.name || 'учнем'}» проведеним — потрібне підтвердження`,
        'lesson_confirm'
      ));
    }

    // Адмін підтвердив урок як проведений — сповіщаємо учня/батька і вчителя
    if (req.body.status === 'completed') {
      notifyStudentOrParent(db, lesson.student_id, `Урок ${updated.date} завершено ✅`, 'lesson');
      if (req.user.id !== lesson.teacher_id) {
        addNotification(lesson.teacher_id, `Адміністратор підтвердив проведення уроку ${updated.date} — оплату нараховано`, 'lesson');
      }
    }

    // Адмін відхилив запит на підтвердження — повернув у "заплановано"
    if (req.body.status === 'planned' && lesson.status === 'pending_confirmation' && req.user.role === 'admin') {
      addNotification(
        lesson.teacher_id,
        `Адміністратор не підтвердив проведення уроку ${lesson.date} о ${lesson.time}.${req.body.notes ? ' Причина: ' + req.body.notes : ''}`,
        'lesson'
      );
    }

    // Якщо зміни (дата/час/статус) вносить не сам вчитель (тобто адмін) — сповіщаємо вчителя
    const scheduleChanged = ['date', 'time'].some(k => req.body[k] !== undefined);
    if (scheduleChanged && req.user.id !== lesson.teacher_id) {
      addNotification(lesson.teacher_id, `Адміністратор оновив урок: ${updated.date} о ${updated.time}`, 'lesson');
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

    if (req.user.id !== lesson.teacher_id) {
      addNotification(lesson.teacher_id, `Урок "${lesson.subject}" (${lesson.date} о ${lesson.time}) скасовано адміністратором`, 'lesson');
    }
    notifyStudentOrParent(db, lesson.student_id, `Урок "${lesson.subject}" (${lesson.date} о ${lesson.time}) скасовано`, 'lesson');

    res.json({ message: 'Урок видалено' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
