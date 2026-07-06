const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, teacherOrAdmin } = require('../middleware/auth');

const MATERIALS_DIR = path.join(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'), 'materials');
if (!fs.existsSync(MATERIALS_DIR)) fs.mkdirSync(MATERIALS_DIR, { recursive: true });

// Приймає data URL (напр. "data:application/pdf;base64,...."), зберігає файл на диск
// і повертає відносний URL, за яким його віддає статика /uploads.
function saveMaterialFile(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;

  const mime = match[1];
  const base64 = match[2];
  if (base64.length > 8 * 1024 * 1024) return null; // ~6MB файлу, з запасом під ліміт 5MB на фронті

  const extFromMime = {
    'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  const ext = extFromMime[mime] || 'bin';
  const filename = `${uuidv4()}.${ext}`;

  fs.writeFileSync(path.join(MATERIALS_DIR, filename), Buffer.from(base64, 'base64'));
  return `/uploads/materials/${filename}`;
}

function formatMaterial(m) {
  return {
    id: m.id,
    teacherId: m.teacher_id,
    title: m.title,
    desc: m.desc,
    type: m.type,
    fileUrl: m.url,
    fileName: m.file_name,
    grade: JSON.parse(m.grades || '[]'),
    subject: m.subject,
    uploadedAt: m.uploaded_at,
  };
}

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
      // Учень/батько бачать усі матеріали (фільтрація за класом — на фронті)
      mats = db.prepare('SELECT * FROM materials ORDER BY uploaded_at DESC').all();
    }

    res.json({ materials: mats.map(formatMaterial) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/materials ───────────────────────────────────────
// Приймає або пряме посилання (url), або файл у вигляді base64 (fileData) — тоді
// зберігаємо на диск і формуємо власний URL.
router.post('/', auth, teacherOrAdmin, (req, res) => {
  try {
    const db = getDB();
    const { title, desc, grades = [], subject, url, fileData, fileName } = req.body;
    if (!title) return res.status(400).json({ error: 'Назва обов\'язкова' });

    let finalUrl = null;
    let finalFileName = fileName || null;
    let type = 'link';

    if (fileData) {
      const savedUrl = saveMaterialFile(fileData);
      if (!savedUrl) return res.status(400).json({ error: 'Не вдалося зберегти файл (перевірте формат/розмір)' });
      finalUrl = savedUrl;
      type = 'file';
    } else if (url) {
      finalUrl = url;
      type = 'link';
    } else {
      return res.status(400).json({ error: 'Додайте файл або посилання' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO materials (id, teacher_id, title, desc, type, url, file_name, grades, subject)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, title, desc || null, type, finalUrl, finalFileName,
           JSON.stringify(grades), subject || null);

    const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
    res.json({ material: formatMaterial(m) });
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
