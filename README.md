# 🎓 МатеМакс — Backend

Повноцінний сервер для платформи МатеМакс із базою даних SQLite, JWT-авторизацією та REST API.

---

## ⚡ Швидкий старт (локально)

### 1. Встановлення
```bash
# Клонуйте/розпакуйте папку matemax-backend
cd matemax-backend

# Встановіть залежності
npm install

# Скопіюйте конфіг
cp .env.example .env
# (за бажанням відредагуйте .env)
```

### 2. Запуск
```bash
npm start
# або для розробки (авто-перезапуск):
npm run dev
```

### 3. Відкрийте браузер
Перейдіть на **http://localhost:3001**

**Дані адміна за замовчуванням:**
- Email: `admin@matemax.com`
- Пароль: `admin123`

> ⚠️ Змініть пароль адміна після першого входу!

---

## 📁 Структура

```
matemax-backend/
├── server.js          # Головний файл (Express)
├── db.js              # База даних SQLite + схема
├── utils.js           # Email, сповіщення, форматери
├── middleware/
│   └── auth.js        # JWT middleware
├── routes/
│   ├── auth.js        # Реєстрація, вхід, верифікація email
│   ├── users.js       # Управління користувачами
│   ├── lessons.js     # Уроки
│   ├── homework.js    # Домашні завдання
│   ├── materials.js   # Навчальні матеріали
│   ├── payments.js    # Платежі
│   ├── payouts.js     # Виплати вчителям
│   ├── messages.js    # Чат
│   ├── notifications.js # Сповіщення
│   └── games.js       # Прогрес ігор
├── public/
│   └── index.html     # Фронтенд (МатеМакс)
├── uploads/           # Завантажені файли
├── matemax.db         # База даних (створюється автоматично)
├── .env               # Ваш конфіг (не комітити!)
├── .env.example       # Шаблон конфігу
└── package.json
```

---

## 📧 Налаштування Email

Без email-сервера реєстрація працює в dev-режимі (підтвердження автоматичне, посилання в консолі).

**Для Gmail:**
1. Увімкніть двофакторну автентифікацію в Google
2. Створіть "Пароль застосунку" (Google Account → Security → App passwords)
3. Заповніть `.env`:
```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your@gmail.com
EMAIL_PASS=xxxx-xxxx-xxxx-xxxx   # пароль застосунку
```

**Для інших провайдерів (Ukr.net, Meta.ua тощо) — аналогічно.**

---

## 🚀 Деплой на безкоштовний хостинг

### Варіант 1: Railway.app (найпростіший)
1. Зареєструйтесь на [railway.app](https://railway.app)
2. New Project → Deploy from GitHub Repo
   або: `npm install -g railway && railway login && railway up`
3. Додайте змінні середовища (Settings → Variables):
   ```
   JWT_SECRET=дуже-довгий-секретний-рядок
   NODE_ENV=production
   ADMIN_EMAIL=ваш@email.com
   ADMIN_PASSWORD=сильний-пароль
   FRONTEND_URL=https://ваш-домен.railway.app
   ```
4. Railway автоматично дасть вам URL типу `https://matemax-production.up.railway.app`

### Варіант 2: Render.com
1. [render.com](https://render.com) → New Web Service
2. Підключіть GitHub репозиторій
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Додайте Environment Variables

### Варіант 3: VPS (Ubuntu)
```bash
# Встановіть Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Клонуйте проект
git clone <ваш-репо> /var/www/matemax
cd /var/www/matemax
npm install --production

# Налаштуйте .env
cp .env.example .env
nano .env  # відредагуйте

# Запустіть через PM2
npm install -g pm2
pm2 start server.js --name matemax
pm2 startup
pm2 save
```

---

## 🔑 API Endpoints

| Метод | URL | Опис |
|-------|-----|------|
| POST | /api/auth/register | Реєстрація |
| POST | /api/auth/login | Вхід |
| GET | /api/auth/verify/:token | Підтвердження email |
| GET | /api/auth/me | Поточний користувач |
| POST | /api/auth/forgot-password | Запит скидання пароля |
| POST | /api/auth/reset-password | Встановити новий пароль |
| GET | /api/users | Список користувачів |
| POST | /api/users/admin-create | Створити користувача (адмін) |
| GET | /api/lessons | Уроки |
| POST | /api/lessons | Створити урок |
| GET | /api/homework | Домашні завдання |
| GET | /api/messages/conversations | Розмови |
| GET | /api/messages/:userId | Повідомлення з користувачем |
| GET | /api/notifications | Сповіщення |
| GET | /api/games/progress | Прогрес ігор |
| GET | /health | Статус сервера |

---

## 🔒 Безпека (важливо для продакшену!)

- Змініть `JWT_SECRET` на довгий випадковий рядок
- Змініть дані адміна (`ADMIN_EMAIL`, `ADMIN_PASSWORD`)
- Встановіть `NODE_ENV=production`
- Використовуйте HTTPS (Railway/Render дають автоматично)
- Регулярно робіть бекап `matemax.db`

---

## 💾 Бекап бази даних

```bash
# Зробити бекап
cp matemax.db matemax-backup-$(date +%Y%m%d).db

# Або через cron (щодня о 3:00)
0 3 * * * cp /var/www/matemax/matemax.db /backups/matemax-$(date +\%Y\%m\%d).db
```
