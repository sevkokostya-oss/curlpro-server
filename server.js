const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN        = process.env.TG_TOKEN        || '';
const ADMIN_SECRET    = process.env.ADMIN_SECRET    || 'admin123';
const YOOMONEY_SECRET = process.env.YOOMONEY_SECRET || '';
const SERVER_URL      = process.env.SERVER_URL      || '';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DB_PATH = path.join(__dirname, 'db.json');
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { codes: {}, used: {}, tg_users: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch(e) { return { codes: {}, used: {}, tg_users: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
function generateCode() { return crypto.randomBytes(4).toString('hex').toUpperCase(); }

function tgSend(chatId, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const buf  = Buffer.from(body, 'utf8');
    const req  = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TG_TOKEN + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    });
    req.on('error', e => { console.error('[TG error]', e.message); resolve(null); });
    req.write(buf);
    req.end();
  });
}

app.post('/tg/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update || !update.message) return;
  const msg    = update.message;
  const chatId = msg.chat.id;
  const text   = (msg.text || '').trim();
  const db     = loadDB();

  console.log('[TG] message from', chatId, ':', text);

  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const uid   = parts[1] ? parts[1].trim() : null;
    db.tg_users[chatId] = {
      username: msg.from.username || '',
      first_name: msg.from.first_name || '',
      registered_at: new Date().toISOString(),
      uid: uid
    };
    if (uid) db.tg_users['uid_' + uid] = chatId;
    saveDB(db);
    console.log('[TG] /start from chatId:', chatId, 'uid:', uid);
    await tgSend(chatId,
      '\u{1F3A3} <b>\u0414\u043e\u0431\u0440\u043e \u043f\u043e\u0436\u0430\u043b\u043e\u0432\u0430\u0442\u044c \u0432 CurlPro!</b>\n\n' +
      '\u0422\u044b \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d! \u041f\u043e\u0441\u043b\u0435 \u043e\u043f\u043b\u0430\u0442\u044b 99 \u20bd \u043a\u043e\u0434 \u043f\u0440\u0438\u0434\u0451\u0442 \u0441\u044e\u0434\u0430 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438.\n\n' +
      '\u0422\u0435\u043f\u0435\u0440\u044c \u043d\u0430\u0436\u043c\u0438 \u00ab\u041f\u0435\u0440\u0435\u0439\u0442\u0438 \u043a \u043e\u043f\u043b\u0430\u0442\u0435\u00bb \u043d\u0430 \u0441\u0430\u0439\u0442\u0435 \u0438 \u043e\u043f\u043b\u0430\u0442\u0438 99 \u20bd. \u041a\u043e\u0434 \u043f\u0440\u0438\u0434\u0451\u0442 \u0441\u044e\u0434\u0430 \u0432 \u0442\u0435\u0447\u0435\u043d\u0438\u0435 \u043c\u0438\u043d\u0443\u0442\u044b \u2705'
    );
    return;
  }

  await tgSend(chatId,
    '\u{1F3A3} <b>CurlPro</b>\n\n\u041f\u043e\u0441\u043b\u0435 \u043e\u043f\u043b\u0430\u0442\u044b 99 \u20bd \u043a\u043e\u0434 \u043f\u0440\u0438\u0434\u0451\u0442 \u0441\u044e\u0434\u0430 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438.\n\n\u0422\u0432\u043e\u0439 ID: <code>' + chatId + '</code>'
  );
});

app.post('/activate', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.json({ success: false, error: 'no_code' });
  const db  = loadDB();
  const key = code.trim().toUpperCase();
  if (!db.codes[key]) return res.json({ success: false, error: 'invalid_code' });
  if (db.used[key])   return res.json({ success: false, error: 'already_used' });
  db.used[key] = { usedAt: new Date().toISOString() };
  saveDB(db);
  console.log('[ACTIVATE] Code used:', key);
  return res.json({ success: true, days: 30 });
});

app.post('/yoomoney/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  console.log('[YOOMONEY] Webhook received:', JSON.stringify(body));

  if (YOOMONEY_SECRET) {
    const str = [
      body.notification_type, body.operation_id, body.amount,
      body.currency, body.datetime, body.sender,
      body.codepro, YOOMONEY_SECRET, body.label
    ].join('&');
    const hash = crypto.createHash('sha1').update(str).digest('hex');
    if (hash !== body.sha1_hash) {
      console.log('[YOOMONEY] Invalid signature!');
      return;
    }
  }

  const amount = parseFloat(body.amount || '0');
  if (amount < 99) return;

  const db = loadDB();
  let code;
  do { code = generateCode(); } while (db.codes[code]);
  db.codes[code] = { createdAt: new Date().toISOString(), payer: body.sender, amount: body.amount };
  saveDB(db);
  console.log('[YOOMONEY] Payment', body.amount, '-> code:', code);

  const label  = (body.label || '').toString().trim();
  const chatId = label ? db.tg_users['uid_' + label] : null;
  if (chatId) {
    await tgSend(chatId,
      '\u2705 <b>\u041e\u043f\u043b\u0430\u0442\u0430 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0430! \u0421\u043f\u0430\u0441\u0438\u0431\u043e!</b>\n\n' +
      '\u0422\u0432\u043e\u0439 \u043a\u043e\u0434 \u0430\u043a\u0442\u0438\u0432\u0430\u0446\u0438\u0438 CurlPro \u043d\u0430 30 \u0434\u043d\u0435\u0439:\n\n' +
      '<code>' + code + '</code>\n\n' +
      '<b>\u041a\u0430\u043a \u0430\u043a\u0442\u0438\u0432\u0438\u0440\u043e\u0432\u0430\u0442\u044c:</b>\n' +
      '1. \u041e\u0442\u043a\u0440\u043e\u0439 \u0441\u0430\u0439\u0442 CurlPro\n' +
      '2. \u041d\u0430\u0436\u043c\u0438 \u00ab\u0423 \u043c\u0435\u043d\u044f \u0435\u0441\u0442\u044c \u043a\u043e\u0434 \u0430\u043a\u0442\u0438\u0432\u0430\u0446\u0438\u0438\u00bb\n' +
      '3. \u0412\u0432\u0435\u0434\u0438 \u043a\u043e\u0434 \u0432\u044b\u0448\u0435\n' +
      '4. \u0413\u043e\u0442\u043e\u0432\u043e \u2014 30 \u0434\u043d\u0435\u0439 \u0434\u043e\u0441\u0442\u0443\u043f\u0430! \u{1F3A3}'
    );
    console.log('[TG] Code sent to chatId:', chatId);
  } else {
    console.log('[TG] chatId not found for label:', label, '| code saved:', code);
  }
});

app.post('/admin/generate', (req, res) => {
  const { secret, count = 1 } = req.body || {};
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });
  const db = loadDB();
  const newCodes = [];
  for (let i = 0; i < Math.min(count, 100); i++) {
    let code;
    do { code = generateCode(); } while (db.codes[code]);
    db.codes[code] = { createdAt: new Date().toISOString() };
    newCodes.push(code);
  }
  saveDB(db);
  console.log('[ADMIN] Created', newCodes.length, 'codes');
  return res.json({ success: true, codes: newCodes });
});

app.get('/admin/stats', (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });
  const db = loadDB();
  return res.json({
    total: Object.keys(db.codes).length,
    used: Object.keys(db.used).length,
    unused: Object.keys(db.codes).filter(c => !db.used[c]).length,
    tg_users: Object.keys(db.tg_users).length,
    unusedCodes: Object.keys(db.codes).filter(c => !db.used[c])
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'CurlPro Server v2' });
});

app.listen(PORT, () => {
  console.log('CurlPro server v2 started on port', PORT);
});
