const { Resend } = require("resend");
const { v4: uuidv4 } = require("uuid");
const { getDB } = require("./db");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n📧 [EMAIL] До: ${to}\n   Тема: ${subject}\n`);
    return;
  }
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "МатеМакс <onboarding@resend.dev>",
      to,
      subject,
      html,
    });
  } catch (e) {
    console.error("Email error:", e.message);
  }
}

function addNotification(userId, text, type = "info") {
  try {
    const db = getDB();
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, ?, ?)`,
    ).run(uuidv4(), userId, type, text);
  } catch (e) {
    console.error("Notification error:", e.message);
  }
}

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
