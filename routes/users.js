const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, adminOnly, teacherOrAdmin } = require('../middleware/auth');
const { formatUser, addNotification } = require('../utils');

// ── GET /api/users ─────────────────────────────────────────────
// Адмін: усі юзери; вчитель: свої учні; батько: свої діти
router.get('/', auth, (req, res) => {
  try {
    const db = getDB();
    const { role } = req.query;
    const me = req.user;
    let users;

    if (me.role === 'admin') {
      const q = role ? 'SELECT * FROM users WHERE role = ? ORDER BY created_at DESC' : 'SELECT * FROM users ORDER BY created_at DESC';
      users = role ? db.prepare(q).all(role) : db.prepare(q).all();
    } else if (me.role === 'teacher') {
      // Вчитель бачить своїх учнів
      users = db.prepare('SELECT * FROM users WHERE teacher_id = ? ORDER BY name').all(me.id);
    } else {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }

    res.json({ users: users.map(formatUser) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/users/:id ────────────────────────────────────────
router.get('/:id', auth, (req, res) => {
  try {
    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Користувача не знайдено' });

    // Дозволено: сам юзер, його вчитель, адмін
    if (req.user.id !== user.id && req.user.role !== 'admin' && user.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }

    res.json({ user: formatUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/users/admin-create ──────────────────────────────
router.post('/admin-create', auth, adminOnly, async (req, res) => {
  try {
    const { email, name, role = 'student', phone, password, teacherId } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'Email та ім\'я обов\'язкові' });

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return res.status(400).json({ error: 'Цей email вже зареєстрований' });

    const id = uuidv4();
    const tempPassword = password || Math.random().toString(36).slice(-8);
    const password_hash = await bcrypt.hash(tempPassword, 10);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, role, phone, email_verified, teacher_id)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, email.toLowerCase().trim(), password_hash, name.trim(), role, phone || null, teacherId || null);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    addNotification(id, `Вітаємо в МатеМакс! Ваш акаунт створено. 🎉`, 'success');

    res.json({ user: formatUser(user), tempPassword });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/users/admin-reset-password ──────────────────────
router.post('/admin-reset-password', auth, adminOnly, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Пароль — мінімум 6 символів' });

    const db = getDB();
    const password_hash = await bcrypt.hash(newPassword, 10);
    const info = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, userId);
    if (!info.changes) return res.status(404).json({ error: 'Користувача не знайдено' });

    res.json({ message: 'Пароль скинуто' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/users/:id ──────────────────────────────────────
router.patch('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Користувача не знайдено' });

    // Дозволено: сам юзер або адмін
    if (req.user.id !== user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ заборонено' });
    }

    const allowed = ['name', 'phone', 'bio', 'subjects', 'teacher_id', 'balance', 'trial_used'];
    // Адмін може змінювати баланс і роль
    if (req.user.role === 'admin') allowed.push('role', 'email_verified');

    const updates = [];
    const vals = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        vals.push(req.body[key]);
      }
    }
    // Також підтримуємо camelCase з фронтенду
    const camelToSnake = { teacherId: 'teacher_id', trialUsed: 'trial_used', emailVerified: 'email_verified' };
    for (const [camel, snake] of Object.entries(camelToSnake)) {
      if (req.body[camel] !== undefined && !vals.includes(req.body[camel])) {
        updates.push(`${snake} = ?`);
        vals.push(req.body[camel]);
      }
    }

    if (!updates.length) return res.json({ user: formatUser(user) });

    vals.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    res.json({ user: formatUser(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/users/:id ─────────────────────────────────────
router.delete('/:id', auth, adminOnly, (req, res) => {
  try {
    const db = getDB();
    const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Користувача не знайдено' });
    res.json({ message: 'Користувача видалено' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
