const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { auth, adminOnly } = require('../middleware/auth');
const { getDB } = require('../db');

// SQLite працює в режимі WAL (для швидкодії) — реальні дані певний час можуть
// лежати в окремому службовому файлі (-wal), а не в самому matemax.db. Перед
// будь-яким бекапом ОБОВ'ЯЗКОВО робимо checkpoint, інакше скопійований файл
// може виявитись порожнім або застарілим.
function forceCheckpoint() {
  try {
    getDB().pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.error('Checkpoint error:', e.message);
  }
}

// ── GET /api/backup/full ────────────────────────────────────────
// Тільки адмін може завантажити повний бекап: файл бази даних (matemax.db)
// + всі завантажені файли (чеки, матеріали, домашка, чеки виплат) одним zip.
// Безкоштовна альтернатива автоматичним бекапам Railway (тільки на Pro).
router.get('/full', auth, adminOnly, (req, res) => {
  try {
    forceCheckpoint();

    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'matemax.db');
    const uploadsPath = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Файл бази даних не знайдено' });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.attachment(`matemax-backup-${stamp}.zip`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    archive.file(dbPath, { name: 'matemax.db' });
    if (fs.existsSync(uploadsPath)) {
      archive.directory(uploadsPath, 'uploads');
    }

    archive.finalize();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── GET /api/backup/database ───────────────────────────────────
// Тільки файл бази даних, без завантажених файлів (швидший, менший)
router.get('/database', auth, adminOnly, (req, res) => {
  try {
    forceCheckpoint();

    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'matemax.db');
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Файл бази даних не знайдено' });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.download(dbPath, `matemax-backup-${stamp}.db`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
