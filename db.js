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
      type         TEXT,
      url          TEXT,
      grades       TEXT DEFAULT '[]',
      subject      TEXT,
      uploaded_at  TEXT DEFAULT (date('now')),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Платежі ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS payments (
      id          TEXT PRIMARY KEY,
      student_id  TEXT NOT NULL,
      teacher_id  TEXT NOT NULL,
      amount      REAL NOT NULL,
      lessons     INTEGER DEFAULT 1,
      status      TEXT DEFAULT 'pending',
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── Виплати вчителям ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS payouts (
      id          TEXT PRIMARY KEY,
      teacher_id  TEXT NOT NULL,
      amount      REAL NOT NULL,
      method      TEXT,
      details     TEXT,
      status      TEXT DEFAULT 'pending',
      created_at  TEXT DEFAULT (datetime('now')),
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
