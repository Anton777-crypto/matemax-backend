const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./db');

// ── Email: чи налаштовано хоч якийсь спосіб відправки ──────────
// Пріоритет: Resend API (RESEND_API_KEY) → SMTP (EMAIL_HOST) → dev-режим (лог у консоль)
function isEmailConfigured() {
  return !!(process.env.RESEND_API_KEY || process.env.EMAIL_HOST);
}

// ── Відправка через Resend HTTP API (без SMTP) ─────────────────
async function sendViaResend({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'МатеМакс <onboarding@resend.dev>',
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Resend API помилка (${res.status}): ${errText}`);
  }
  return res.json();
}

// ── Відправка через звичайний SMTP (nodemailer) ────────────────
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
  // 1) Пріоритет — Resend API, якщо є ключ (найпростіше, без SMTP)
  if (process.env.RESEND_API_KEY) {
    try {
      await sendViaResend({ to, subject, html });
      return;
    } catch (e) {
      console.error('Resend email error:', e.message);
      return;
    }
  }

  // 2) Якщо Resend не налаштовано — пробуємо звичайний SMTP
  const t = getTransporter();
  if (!t) {
    // Жодного способу відправки не налаштовано: просто логуємо (dev-режим)
    console.log(`\n📧 [EMAIL] До: ${to}\n   Тема: ${subject}\n   (RESEND_API_KEY / EMAIL_HOST не налаштовано — лист не надіслано)\n`);
    return;
  }
  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || `"МатеМакс" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
  } catch (e) {
    console.error('SMTP email error:', e.message);
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
    parentId: u.parent_id || null,
    managedByParent: !!u.managed_by_parent,
    activationStatus: u.activation_status || 'active',
    createdAt: u.created_at,
  };
}

// ── Батько → діти ────────────────────────────────────────────
// Повертає масив ID дітей (users.role='student'), прив'язаних до цього батька
function getChildIds(db, parentId) {
  return db.prepare("SELECT id FROM users WHERE parent_id = ? AND role = 'student'").all(parentId).map(r => r.id);
}

module.exports = { sendEmail, addNotification, formatUser, getChildIds, isEmailConfigured };
