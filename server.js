/**
 * CurlPro — Сервер активации кодов
 * Стек: Node.js + Express
 * Деплой: Railway.app (бесплатно)
 */

const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — разрешаем запросы с твоего сайта ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ── База данных (простой JSON-файл) ──
const DB_PATH = path.join(__dirname, 'db.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { codes: {}, used: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ── Генерация кода ──
function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // например: A3F9B12C
}

// ── СЕКРЕТНЫЙ КЛЮЧ АДМИНИСТРАТОРА ──
// Замени на свой случайный пароль!
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'curlpro_admin_2024_secret';

/* ════════════════════════════════════════
   POST /activate  — проверить и активировать код
   Body: { code: "XXXXXXXX" }
════════════════════════════════════════ */
app.post('/activate', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.json({ success: false, error: 'no_code' });

  const db  = loadDB();
  const key = code.trim().toUpperCase();

  // Код существует и не использован?
  if (!db.codes[key]) {
    return res.json({ success: false, error: 'invalid_code' });
  }
  if (db.used[key]) {
    return res.json({ success: false, error: 'already_used' });
  }

  // Активируем
  db.used[key] = { usedAt: new Date().toISOString() };
  saveDB(db);

  console.log(`[ACTIVATE] Код использован: ${key}`);
  return res.json({ success: true, days: 30 });
});

/* ════════════════════════════════════════
   POST /admin/generate  — сгенерировать коды
   Body: { secret: "...", count: 5 }
════════════════════════════════════════ */
app.post('/admin/generate', (req, res) => {
  const { secret, count = 1 } = req.body || {};
  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const db  = loadDB();
  const newCodes = [];

  for (let i = 0; i < Math.min(count, 100); i++) {
    let code;
    do { code = generateCode(); } while (db.codes[code]);
    db.codes[code] = { createdAt: new Date().toISOString() };
    newCodes.push(code);
  }

  saveDB(db);
  console.log(`[ADMIN] Сгенерировано ${newCodes.length} кодов`);
  return res.json({ success: true, codes: newCodes });
});

/* ════════════════════════════════════════
   GET /admin/stats  — статистика
   Query: ?secret=...
════════════════════════════════════════ */
app.get('/admin/stats', (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const db = loadDB();
  const total  = Object.keys(db.codes).length;
  const used   = Object.keys(db.used).length;
  const unused = total - used;
  return res.json({
    total, used, unused,
    unusedCodes: Object.keys(db.codes).filter(c => !db.used[c])
  });
});

/* ════════════════════════════════════════
   POST /yoomoney/webhook  — уведомление от ЮМани
   (Настраивается в личном кабинете ЮМани)
════════════════════════════════════════ */
const YOOMONEY_SECRET = process.env.YOOMONEY_SECRET || 'твой_секрет_от_юмани';

app.post('/yoomoney/webhook', (req, res) => {
  const body = req.body;

  // Проверка подписи ЮМани
  const str = [
    body.notification_type,
    body.operation_id,
    body.amount,
    body.currency,
    body.datetime,
    body.sender,
    body.codepro,
    YOOMONEY_SECRET,
    body.label
  ].join('&');

  const hash = crypto.createHash('sha1').update(str).digest('hex');

  if (hash !== body.sha1_hash) {
    console.log('[WEBHOOK] Неверная подпись!');
    return res.sendStatus(400);
  }

  // Платёж прошёл?
  if (body.unaccepted === 'false' || !body.unaccepted) {
    const amount = parseFloat(body.amount);
    if (amount >= 99) {
      // Генерируем код и выводим в лог (можно добавить email/tg уведомление)
      const db  = loadDB();
      let code;
      do { code = generateCode(); } while (db.codes[code]);
      db.codes[code] = {
        createdAt: new Date().toISOString(),
        payer: body.sender,
        amount: body.amount
      };
      saveDB(db);
      console.log(`[PAYMENT] Оплата ${body.amount}₽ от ${body.sender} → код: ${code}`);
    }
  }

  res.sendStatus(200);
});

/* ════════════════════════════════════════
   GET /  — проверка работоспособности
════════════════════════════════════════ */
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'CurlPro Activation Server' });
});

app.listen(PORT, () => {
  console.log(`✅ CurlPro сервер запущен на порту ${PORT}`);
});
