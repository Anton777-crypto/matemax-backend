const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./db');

// ── Email транспорт ──────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  return transporter;
}

async function sendEmail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) {
    // Без email-сервера: просто логуємо
    console.log(`\n📧 [EMAIL] До: ${to}\n   Тема: ${subject}\n   (EMAIL_HOST не налаштовано — лист не надіслано)\n`);
    return;
  }
  try {
    await t.sendMail({
      from: `"МатеМакс" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
  } catch (e) {
    console.error('Email error:', e.message);
  }
}

// ── Сповіщення ───────────────────────────────────────────────
function addNotification(userId, text, type = 'info') {
  try {
    const db = getDB();
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, text)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), userId, type, text);
  } catch (e) {
    console.error('Notification error:', e.message);
  }
}

// ── Форматування користувача ──────────────────────────────────
function formatUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    phone: u.phone || null,
    emailVerified: !!u.email_verified,
    balance: u.balance || 0,
    trialUsed: !!u.trial_used,
    teacherId: u.teacher_id || null,
    bio: u.bio || null,
    subjects: u.subjects || null,
    createdAt: u.created_at,
  };
}

module.exports = { sendEmail, addNotification, formatUser };
