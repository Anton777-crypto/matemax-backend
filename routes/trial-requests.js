const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { addNotification } = require('../utils');

function formatTrialRequest(r) {
  return {
    id: r.id,
    studentId: r.student_id,
    parentId: r.parent_id,
    parentName: r.parent_name,
    studentName: r.student_name,
    contact: r.contact,
    preferredTime: r.preferred_time,
    status: r.status,
    scheduledDate: r.scheduled_date,
    scheduledTime: r.scheduled_time,
    adminComment: r.admin_comment,
    createdAt: r.created_at,
  };
}

// ── GET /api/trial-requests ─────────────────────────────────────
// Тільки адмін бачить усі заявки на пробний урок
router.get('/', auth, adminOnly, (req, res) => {
  try {
    const db = getDB();
    const rows = db.prepare('SELECT * FROM trial_requests ORDER BY created_at DESC').all();
    res.json({ requests: rows.map(formatTrialRequest) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/trial-requests/:id ───────────────────────────────
// Адмін підтверджує (з датою/часом) або відхиляє заявку
router.patch('/:id', auth, adminOnly, (req, res) => {
  try {
    const db = getDB();
    const reqRow = db.prepare('SELECT * FROM trial_requests WHERE id = ?').get(req.params.id);
    if (!reqRow) return res.status(404).json({ error: 'Заявку не знайдено' });

    const { status, scheduledDate, scheduledTime, comment } = req.body;
    if (!['confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Невірний статус' });
    }

    db.prepare(`
      UPDATE trial_requests SET status = ?, scheduled_date = ?, scheduled_time = ?, admin_comment = ?
      WHERE id = ?
    `).run(status, scheduledDate || null, scheduledTime || null, comment || null, req.params.id);

    // Кому сповіщати: батько, якщо є, інакше сам учень (старий окремий акаунт)
    const notifyTarget = reqRow.parent_id || reqRow.student_id;

    if (status === 'confirmed') {
      addNotification(
        notifyTarget,
        `✅ Пробний урок для «${reqRow.student_name}» підтверджено: ${scheduledDate || ''} о ${scheduledTime || ''}`,
        'trial'
      );
    } else {
      const reason = comment ? ` Причина: ${comment}.` : '';
      addNotification(
        notifyTarget,
        `Пробний урок для «${reqRow.student_name}» відхилено.${reason} Зв'яжіться з адміністрацією для уточнення.`,
        'trial'
      );
    }

    const updated = db.prepare('SELECT * FROM trial_requests WHERE id = ?').get(req.params.id);
    res.json({ request: formatTrialRequest(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
