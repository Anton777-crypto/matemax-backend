const jwt = require('jsonwebtoken');

// КРИТИЧНО: жодного запасного значення "за замовчуванням" тут бути не повинно —
// якщо хтось дізнається таку заглушку (наприклад, побачивши код на GitHub),
// він зможе підробити токен адміністратора. Тому сервер просто відмовляється
// запускатись, якщо змінна не задана явно в Railway → Variables.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ КРИТИЧНА ПОМИЛКА: змінна оточення JWT_SECRET не задана. Сервер не може запуститись небезпечно.');
  console.error('   Задайте JWT_SECRET у Railway → Variables (довгий випадковий рядок) і передеплойте.');
  process.exit(1);
}

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
