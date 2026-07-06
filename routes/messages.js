const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth } = require('../middleware/auth');
const { addNotification } = require('../utils');

// ── GET /api/messages/conversations ──────────────────────────
router.get('/conversations', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user.id;

    // Знаходимо всіх, з ким є листування
    const rows = db.prepare(`
      WITH conv AS (
        SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other_id, date, text, read, from_id, to_id
        FROM messages
        WHERE from_id = ? OR to_id = ?
      )
      SELECT other_id, MAX(date) as last_date,
        (SELECT text FROM conv c2 WHERE c2.other_id = conv.other_id ORDER BY c2.date DESC LIMIT 1) as last_text,
        (SELECT COUNT(*) FROM messages m3 WHERE m3.from_id = conv.other_id AND m3.to_id = ? AND m3.read = 0) as unread
      FROM conv
      GROUP BY other_id
      ORDER BY last_date DESC
    `).all(me, me, me, me);

    // Підтягуємо дані про співрозмовників
    const conversations = rows.map(row => {
      const other = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(row.other_id);
      return {
        userId: row.other_id,
        name: other?.name || 'Невідомий',
        role: other?.role || 'student',
        lastMessage: row.last_text,
        lastDate: row.last_date,
        unread: row.unread,
      };
    });

    res.json({ conversations });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/messages/:otherId ────────────────────────────────
router.get('/:otherId', auth, (req, res) => {
  try {
    const db = getDB();
    const me = req.user.id;
    const other = req.params.otherId;

    const messages = db.prepare(`
      SELECT * FROM messages
      WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
      ORDER BY date ASC
    `).all(me, other, other, me);

    // Позначаємо прочитаними
    db.prepare('UPDATE messages SET read = 1 WHERE from_id = ? AND to_id = ? AND read = 0')
      .run(other, me);

    res.json({
      messages: messages.map(m => ({
        id: m.id,
        fromId: m.from_id,
        toId: m.to_id,
        text: m.text,
        date: m.date,
        read: !!m.read,
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/messages ────────────────────────────────────────
// Модель спілкування: тільки через адміністратора.
// Вчитель ↔ Адмін, Батьки ↔ Адмін. Прямого зв'язку вчитель-батьки чи будь-хто-дитина немає.
router.post('/', auth, (req, res) => {
  try {
    const db = getDB();
    const { toId, text } = req.body;
    if (!toId || !text?.trim()) return res.status(400).json({ error: 'Вкажіть отримувача і текст' });

    const recipient = db.prepare('SELECT id, role FROM users WHERE id = ?').get(toId);
    if (!recipient) return res.status(404).json({ error: 'Отримувача не знайдено' });

    const me = req.user;
    const isAdminInvolved = me.role === 'admin' || recipient.role === 'admin';
    if (!isAdminInvolved) {
      return res.status(403).json({ error: 'Спілкування можливе лише через адміністрацію школи' });
    }
    if (me.role === 'admin' && !['teacher', 'parent'].includes(recipient.role) && recipient.id !== me.id) {
      return res.status(403).json({ error: 'Адміністрація може писати лише вчителям і батькам' });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO messages (id, from_id, to_id, text) VALUES (?, ?, ?, ?)')
      .run(id, req.user.id, toId, text.trim());

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

    const sender = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
    addNotification(toId, `💬 Нове повідомлення від ${sender?.name || 'користувача'}`, 'message');

    res.json({
      message: {
        id: message.id,
        fromId: message.from_id,
        toId: message.to_id,
        text: message.text,
        date: message.date,
        read: false,
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
