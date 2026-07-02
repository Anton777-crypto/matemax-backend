const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'matemax_secret_change_in_production_2024';

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Не авторизовано' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Сесія закінчилась, увійдіть знову' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ тільки для адміністратора' });
  }
  next();
}

function teacherOrAdmin(req, res, next) {
  if (!['teacher', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Доступ тільки для вчителя або адміністратора' });
  }
  next();
}

module.exports = { auth, adminOnly, teacherOrAdmin, JWT_SECRET };
