const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { auth, JWT_SECRET } = require('../middleware/auth');
const { sendEmail, formatUser, addNotification, isEmailConfigured } = require('../utils');

const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:3001';

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role = 'student', phone, consent } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Заповніть усі обов\'язкові поля' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль — мінімум 6 символів' });
    }
    if (!consent) {
      return res.status(400).json({ error: 'Потрібна згода на обробку персональних даних' });
    }
    const allowedRoles = ['teacher', 'parent'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Реєстрація доступна лише для ролей "вчитель" та "батьки". Дітей додає батько зі свого кабінету після реєстрації.' });
    }

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return res.status(400).json({ error: 'Цей email вже зареєстрований' });

    const id = uuidv4();
    const password_hash = await bcrypt.hash(password, 10);
    const verify_token = uuidv4();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, role, phone, verify_token, email_verified, consent_given_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, email.toLowerCase().trim(), password_hash, name.trim(), role, phone || null, verify_token,
      // Якщо жодного email-сервісу не налаштовано — верифікуємо одразу (для розробки)
      isEmailConfigured() ? 0 : 1
    );

    const verifyUrl = `${FRONTEND_URL()}?verify=${verify_token}`;

    if (isEmailConfigured()) {
      await sendEmail({
        to: email,
        subject: 'МатеМакс — Підтвердіть ваш email',
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <div style="background:linear-gradient(135deg,#5B4FD9,#22C98E);padding:24px;border-radius:16px;text-align:center;margin-bottom:24px;">
              <h1 style="color:#fff;margin:0;font-size:28px;">М<span style="color:#22C98E">М</span></h1>
              <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;">МатеМакс — Онлайн школа математики</p>
            </div>
            <h2 style="color:#2B2A4C;">Привіт, ${name}! 👋</h2>
            <p style="color:#6E6E8F;">Дякуємо за реєстрацію! Натисніть кнопку нижче для підтвердження email.</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${verifyUrl}"
                 style="background:#5B4FD9;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">
                ✅ Підтвердити Email
              </a>
            </div>
            <p style="color:#999;font-size:13px;">Або перейдіть за посиланням:<br><a href="${verifyUrl}" style="color:#5B4FD9;">${verifyUrl}</a></p>
          </div>
        `,
      });
      res.json({ message: 'Реєстрацію успішно! Перевірте email для підтвердження акаунту.' });
    } else {
      // Dev-режим без email — акаунт активується одразу
      const token = jwt.sign({ id, role, email: email.toLowerCase().trim() }, JWT_SECRET, { expiresIn: '30d' });
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      console.log(`📧 [DEV] Верифікаційне посилання: ${verifyUrl}`);
      res.json({ message: 'Реєстрацію успішно! (Dev-режим: email підтверджено автоматично)', token, user: formatUser(user) });
    }
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Помилка сервера: ' + e.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Введіть email та пароль' });

    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Невірний email або пароль' });

    if (user.managed_by_parent) {
      return res.status(403).json({ error: 'У дитини немає власного акаунту. Увійдіть під акаунтом батьків і оберіть дитину.' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Невірний email або пароль' });

    if (!user.email_verified) {
      return res.status(403).json({ error: 'Підтвердіть email перед входом. Перевірте пошту.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, user: formatUser(user) });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ── GET /api/auth/verify/:token ───────────────────────────────
router.get('/verify/:token', (req, res) => {
  try {
    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(req.params.token);
    if (!user) return res.status(400).json({ error: 'Невірний або прострочений токен верифікації' });

    db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?').run(user.id);
    const updated = { ...user, email_verified: 1, verify_token: null };

    addNotification(user.id, 'Вітаємо в МатеМакс! Ваш акаунт підтверджено. 🎉', 'success');

    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: formatUser(updated) });
  } catch (e) {
    console.error('Verify error:', e);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', auth, (req, res) => {
  try {
    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Користувача не знайдено' });
    res.json({ user: formatUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email?.toLowerCase().trim());

    // Завжди повертаємо однакову відповідь (безпека)
    if (!user) return res.json({ message: 'Якщо такий email існує — лист з інструкціями надіслано.' });

    const resetToken = uuidv4();
    const expires = Date.now() + 3600000; // 1 година
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
      .run(resetToken, expires, user.id);

    const resetUrl = `${FRONTEND_URL()}?reset=${resetToken}`;
    console.log(`🔐 [RESET] ${email}: ${resetUrl}`);

    await sendEmail({
      to: email,
      subject: 'МатеМакс — Скидання пароля',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">
          <h2 style="color:#2B2A4C;">Скидання пароля 🔐</h2>
          <p style="color:#6E6E8F;">Ви запросили скидання пароля для акаунту <b>${email}</b>.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${resetUrl}"
               style="background:#5B4FD9;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">
              🔑 Скинути пароль
            </a>
          </div>
          <p style="color:#999;font-size:13px;">Посилання дійсне протягом 1 години.<br>Якщо ви не запитували скидання — проігноруйте цей лист.</p>
        </div>
      `,
    });

    res.json({ message: 'Якщо такий email існує — лист з інструкціями надіслано.' });
  } catch (e) {
    console.error('Forgot password error:', e);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Пароль — мінімум 6 символів' });
    }

    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
    if (!user) return res.status(400).json({ error: 'Невірний токен скидання пароля' });
    if (user.reset_token_expires < Date.now()) {
      return res.status(400).json({ error: 'Посилання для скидання прострочене. Запросіть нове.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
      .run(password_hash, user.id);

    res.json({ message: 'Пароль успішно змінено! Тепер увійдіть з новим паролем.' });
  } catch (e) {
    console.error('Reset password error:', e);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ── POST /api/auth/change-password ───────────────────────────
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Новий пароль — мінімум 6 символів' });
    }

    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Невірний поточний пароль' });

    const password_hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, user.id);

    res.json({ message: 'Пароль змінено успішно' });
  } catch (e) {
    console.error('Change password error:', e);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

module.exports = router;
