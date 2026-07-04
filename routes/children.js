const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth } = require('../middleware/auth');
const { addNotification, formatUser } = require('../utils');

// Дитина зберігається як рядок у users (role='student'), але:
//  - не має власного логіна (managed_by_parent = 1, email/пароль — випадкові, нікому не відомі)
//  - прив'язана до батька через parent_id
//  - activation_status: 'pending_payment' поки батько не оплатив, потім 'active'
//  - teacher_id призначається ТІЛЬКИ адміністратором вручну після оплати

function formatChild(u, extra = {}) {
  return { ...formatUser(u), ...extra };
}

// ── GET /api/children ──────────────────────────────────────────
// Батько бачить своїх дітей; адмін — усіх дітей (+ ім'я батька); вчитель — призначених йому дітей
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user;
    let rows;

    if (me.role === 'parent') {
      rows = db.prepare("SELECT * FROM users WHERE parent_id = ? AND role = 'student' ORDER BY created_at DESC").all(me.id);
      return res.json({ children: rows.map(r => formatChild(r)) });
    }

    if (me.role === 'admin') {
      rows = db.prepare("SELECT * FROM users WHERE role = 'student' AND managed_by_parent = 1 ORDER BY created_at DESC").all();
      const withParent = rows.map(r => {
        const parent = r.parent_id ? db.prepare('SELECT id, name, email, phone FROM users WHERE id = ?').get(r.parent_id) : null;
        return formatChild(r, { parentName: parent?.name || null, parentEmail: parent?.email || null, parentPhone: parent?.phone || null });
      });
      return res.json({ children: withParent });
    }

    if (me.role === 'teacher') {
      rows = db.prepare("SELECT * FROM users WHERE teacher_id = ? AND role = 'student' ORDER BY name").all(me.id);
      return res.json({ children: rows.map(r => formatChild(r)) });
    }

    return res.status(403).json({ error: 'Доступ заборонено' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/children ───────────────────────────────────────────
// Батько додає дитину: ім'я, клас, предмети. Логін/пароль не потрібні —
// дитина вчиться через акаунт батька.
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ error: 'Додавати дітей може лише акаунт батьків' });
    }
    const { name, grade, subjects } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Вкажіть ім'я дитини" });

    const db = getDB();
    const id = uuidv4();
    // Технічний унікальний email та випадковий пароль — дитина ніколи ними не користується
    const internalEmail = `child.${id}@managed.matemax.local`;
    const randomPassword = uuidv4() + uuidv4();
    const password_hash = await bcrypt.hash(randomPassword, 10);

    db.prepare(`
      INSERT INTO users (
        id, email, password_hash, name, role, grade, subjects,
        parent_id, managed_by_parent, activation_status, email_verified, teacher_id
      ) VALUES (?, ?, ?, ?, 'student', ?, ?, ?, 1, 'pending_payment', 1, NULL)
    `).run(
      id, internalEmail, password_hash, name.trim(),
      grade || null, JSON.stringify(subjects || []), req.user.id
    );

    const child = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    const parent = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
    admins.forEach(a => addNotification(a.id, `${parent?.name || 'Батьки'} додав(ла) дитину «${name.trim()}» — очікує оплати`, 'info'));

    res.json({ child: formatChild(child) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/children/:id ───────────────────────────────────────
// Батько: може редагувати ім'я/клас/предмети ТІЛЬКИ поки дитина не оплачена.
// Адмін: може призначити/змінити вчителя, або вручну змінити статус активації.
router.patch('/:id', auth, (req, res) => {
  try {
    const db = getDB();
    const child = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(req.params.id);
    if (!child) return res.status(404).json({ error: 'Дитину не знайдено' });

    const me = req.user;
    const isOwnerParent = me.role === 'parent' && child.parent_id === me.id;
    const isAdmin = me.role === 'admin';
    if (!isOwnerParent && !isAdmin) return res.status(403).json({ error: 'Доступ заборонено' });

    const updates = [];
    const vals = [];

    if (isOwnerParent) {
      if (child.activation_status !== 'pending_payment') {
        return res.status(400).json({ error: 'Дитину вже оплачено — зміни імені/класу можливі лише через адміністратора' });
      }
      if (req.body.name !== undefined) { updates.push('name = ?'); vals.push(String(req.body.name).trim()); }
      if (req.body.grade !== undefined) { updates.push('grade = ?'); vals.push(req.body.grade); }
      if (req.body.subjects !== undefined) { updates.push('subjects = ?'); vals.push(JSON.stringify(req.body.subjects || [])); }
    }

    if (isAdmin) {
      if (req.body.teacherId !== undefined) {
        updates.push('teacher_id = ?'); vals.push(req.body.teacherId || null);
        if (req.body.teacherId) {
          addNotification(child.parent_id, `Дитині «${child.name}» призначено вчителя 🍎`, 'info');
        }
      }
      if (req.body.activationStatus !== undefined) {
        updates.push('activation_status = ?'); vals.push(req.body.activationStatus);
      }
      if (req.body.name !== undefined) { updates.push('name = ?'); vals.push(String(req.body.name).trim()); }
      if (req.body.grade !== undefined) { updates.push('grade = ?'); vals.push(req.body.grade); }
    }

    if (!updates.length) return res.json({ child: formatChild(child) });
    vals.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    res.json({ child: formatChild(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/children/:id ──────────────────────────────────────
// Батько може видалити дитину лише поки вона не оплачена; адмін — завжди.
router.delete('/:id', auth, (req, res) => {
  try {
    const db = getDB();
    const child = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(req.params.id);
    if (!child) return res.status(404).json({ error: 'Дитину не знайдено' });

    const me = req.user;
    const isOwnerParent = me.role === 'parent' && child.parent_id === me.id;
    if (!isOwnerParent && me.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });

    if (isOwnerParent && child.activation_status !== 'pending_payment') {
      return res.status(400).json({ error: "Оплачену дитину може видалити лише адміністратор" });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ message: 'Дитину видалено' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
