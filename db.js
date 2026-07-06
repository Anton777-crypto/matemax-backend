const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'matemax.db');
let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDB() {
  const db = getDB();

  db.exec(`
    -- ── Користувачі ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id                   TEXT PRIMARY KEY,
      email                TEXT UNIQUE NOT NULL,
      password_hash        TEXT NOT NULL,
      name                 TEXT NOT NULL,
      role                 TEXT NOT NULL DEFAULT 'student',
      phone                TEXT,
      email_verified       INTEGER DEFAULT 0,
      verify_token         TEXT,
      reset_token          TEXT,
      reset_token_expires  INTEGER,
      balance              REAL DEFAULT 0,
      trial_used           INTEGER DEFAULT 0,
      teacher_id           TEXT,
      bio                  TEXT,
      subjects             TEXT,
      created_at           TEXT DEFAULT (datetime('now'))
    );

    -- ── Уроки ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS lessons (
      id          TEXT PRIMARY KEY,
      student_id  TEXT NOT NULL,
      teacher_id  TEXT NOT NULL,
      subject     TEXT,
      date        TEXT NOT NULL,
      time        TEXT NOT NULL,
      meet_url    TEXT,
      trial       INTEGER DEFAULT 0,
      status      TEXT DEFAULT 'planned',
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Домашні завдання ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS homework (
      id            TEXT PRIMARY KEY,
      student_id    TEXT NOT NULL,
      teacher_id    TEXT NOT NULL,
      title         TEXT NOT NULL,
      desc          TEXT,
      due           TEXT,
      done          INTEGER DEFAULT 0,
      done_at       TEXT,
      grade         TEXT,
      file_url      TEXT,
      file_name     TEXT,
      audio_base64  TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Навчальні матеріали ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS materials (
      id           TEXT PRIMARY KEY,
      teacher_id   TEXT NOT NULL,
      title        TEXT NOT NULL,
      desc         TEXT,
      type         TEXT,
      url          TEXT,
      file_name    TEXT,
      grades       TEXT DEFAULT '[]',
      subject      TEXT,
      uploaded_at  TEXT DEFAULT (date('now')),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Заявки на пробний урок ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS trial_requests (
      id              TEXT PRIMARY KEY,
      student_id      TEXT NOT NULL,
      parent_id       TEXT,
      parent_name     TEXT,
      student_name    TEXT,
      contact         TEXT,
      preferred_time  TEXT,
      status          TEXT DEFAULT 'pending',
      scheduled_date  TEXT,
      scheduled_time  TEXT,
      admin_comment   TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Платежі ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS payments (
      id                TEXT PRIMARY KEY,
      student_id        TEXT NOT NULL,
      teacher_id        TEXT NOT NULL,
      amount            REAL NOT NULL,
      currency          TEXT DEFAULT 'UAH',
      lessons           INTEGER DEFAULT 1,
      desc              TEXT,
      status            TEXT DEFAULT 'pending',
      receipt_url       TEXT,
      receipt_filename  TEXT,
      admin_comment     TEXT,
      reviewed_at       TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Виплати вчителям ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS payouts (
      id            TEXT PRIMARY KEY,
      teacher_id    TEXT NOT NULL,
      amount        REAL NOT NULL,
      method        TEXT,
      details       TEXT,
      note          TEXT,
      receipt_url   TEXT,
      status        TEXT DEFAULT 'paid',
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Повідомлення ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS messages (
      id       TEXT PRIMARY KEY,
      from_id  TEXT NOT NULL,
      to_id    TEXT NOT NULL,
      text     TEXT NOT NULL,
      date     TEXT DEFAULT (datetime('now')),
      read     INTEGER DEFAULT 0,
      FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_id)   REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Сповіщення ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id       TEXT PRIMARY KEY,
      user_id  TEXT NOT NULL,
      type     TEXT DEFAULT 'info',
      text     TEXT NOT NULL,
      date     TEXT DEFAULT (datetime('now')),
      read     INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Прогрес ігор ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS game_progress (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      game_id     TEXT NOT NULL,
      score       INTEGER DEFAULT 0,
      updated_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, game_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ── Міграція: додаємо нові колонки payments, якщо їх ще немає ──
  // (для баз, створених до появи валюти/квитанцій/коментарів адміна)
  const paymentCols = db.prepare('PRAGMA table_info(payments)').all().map(c => c.name);
  const ensurePaymentColumn = (name, definition) => {
    if (!paymentCols.includes(name)) {
      db.exec(`ALTER TABLE payments ADD COLUMN ${name} ${definition}`);
    }
  };
  ensurePaymentColumn('currency', "TEXT DEFAULT 'UAH'");
  ensurePaymentColumn('desc', 'TEXT');
  ensurePaymentColumn('receipt_url', 'TEXT');
  ensurePaymentColumn('receipt_filename', 'TEXT');
  ensurePaymentColumn('admin_comment', 'TEXT');
  ensurePaymentColumn('reviewed_at', 'TEXT');

  // ── Міграція: зв'язок батько → дитина в users ──────────────────
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  const ensureUserColumn = (name, definition) => {
    if (!userCols.includes(name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
  };
  ensureUserColumn('parent_id', 'TEXT');
  ensureUserColumn('managed_by_parent', 'INTEGER DEFAULT 0');
  ensureUserColumn('activation_status', "TEXT DEFAULT 'active'");
  ensureUserColumn('grade', 'TEXT');
  ensureUserColumn('rate_per_lesson', 'REAL DEFAULT 175');
  ensureUserColumn('consent_given_at', 'TEXT');

  // ── Міграція: чек/примітка для payouts, якщо їх ще немає ──────
  const payoutCols = db.prepare('PRAGMA table_info(payouts)').all().map(c => c.name);
  const ensurePayoutColumn = (name, definition) => {
    if (!payoutCols.includes(name)) {
      db.exec(`ALTER TABLE payouts ADD COLUMN ${name} ${definition}`);
    }
  };
  ensurePayoutColumn('note', 'TEXT');
  ensurePayoutColumn('receipt_url', 'TEXT');

  // ── Міграція: desc/file_name для materials, якщо їх ще немає ──
  const materialCols = db.prepare('PRAGMA table_info(materials)').all().map(c => c.name);
  const ensureMaterialColumn = (name, definition) => {
    if (!materialCols.includes(name)) {
      db.exec(`ALTER TABLE materials ADD COLUMN ${name} ${definition}`);
    }
  };
  ensureMaterialColumn('desc', 'TEXT');
  ensureMaterialColumn('file_name', 'TEXT');

  // Перевіряємо чи є адмін — якщо ні, створюємо дефолтного
  const adminExists = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@matemax.com';
    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, role, email_verified)
      VALUES (?, ?, ?, 'Адміністратор', 'admin', 1)
    `).run(uuidv4(), adminEmail, hash);
    console.log(`👑 Адмін створений: ${adminEmail} / ${process.env.ADMIN_PASSWORD || 'admin123'}`);
  }

  console.log('✅ База даних готова:', DB_PATH);
}

module.exports = { getDB, initDB };
