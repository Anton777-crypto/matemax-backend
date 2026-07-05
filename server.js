require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDB } = require('./db');
const { isEmailConfigured } = require('./utils');
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/users');
const lessonRoutes     = require('./routes/lessons');
const homeworkRoutes   = require('./routes/homework');
const materialRoutes   = require('./routes/materials');
const paymentRoutes    = require('./routes/payments');
const childrenRoutes   = require('./routes/children');
const trialRequestRoutes = require('./routes/trial-requests');
const payoutRoutes     = require('./routes/payouts');
const messageRoutes    = require('./routes/messages');
const notificationRoutes = require('./routes/notifications');
const gameRoutes       = require('./routes/games');

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5500'];

app.use(cors({
  origin: (origin, callback) => {
    // Дозволяємо запити без origin (Postman, curl) та з дозволених доменів
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin не дозволено'));
    }
  },
  credentials: true,
}));

// ── Middleware ────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));   // 20MB — для base64 аудіо/зображень
app.use(express.urlencoded({ extended: true }));

// ── Статичні файли ────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  ok: true,
  time: new Date().toISOString(),
  env: process.env.NODE_ENV || 'development',
}));

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/lessons',       lessonRoutes);
app.use('/api/homework',      homeworkRoutes);
app.use('/api/materials',     materialRoutes);
app.use('/api/payments',      paymentRoutes);
app.use('/api/children',      childrenRoutes);
app.use('/api/trial-requests', trialRequestRoutes);
app.use('/api/payouts',       payoutRoutes);
app.use('/api/messages',      messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/games',         gameRoutes);

// ── 404 для API ───────────────────────────────────────────────
app.use('/api/*', (_req, res) => res.status(404).json({ error: 'API маршрут не знайдено' }));

// ── Frontend (SPA fallback) ───────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Внутрішня помилка сервера' });
});

// ── Start ─────────────────────────────────────────────────────
initDB();
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🚀 МатеМакс сервер запущено!       ║
  ╠══════════════════════════════════════╣
  ║  Порт:   ${PORT}                       ║
  ║  Режим:  ${(process.env.NODE_ENV || 'development').padEnd(15)}         ║
  ║  Email:  ${isEmailConfigured() ? '✅ налаштовано' : '⚠️  не налаштовано'}        ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;
