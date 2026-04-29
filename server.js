const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN        = process.env.TG_TOKEN        || '';
const ADMIN_SECRET    = process.env.ADMIN_SECRET    || 'admin123';
const YOOMONEY_SECRET = process.env.YOOMONEY_SECRET || '';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.set('query parser', 'simple');
app.use((req, res, next) => { express.json()(req, res, () => next()); });
app.use((req, res, next) => { express.urlencoded({ extended: true })(req, res, () => next()); });

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

async function tgSend(chatId, text) {
  try {
    const url = 'https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
    return await resp.json();
  } catch(e) {
    console.error('[TG error]', e.message);
    return null;
  }
}

app.post('/tg/webhook', async function(req, res) {
  res.sendStatus(200);
  var update = req.body;
  if (!update || !update.message) return;
  var msg = update.message;
  var chatId = msg.chat.id;
  var text = (msg.text || '').trim();
  var db = loadDB();

  console.log('[TG] from', chatId, text);

  if (text.indexOf('/start') === 0) {
    var parts = text.split(' ');
    var uid = parts[1] ? parts[1].trim() : null;
    db.tg_users[chatId] = {
      username: msg.from.username || '',
      first_name: msg.from.first_name || '',
      registered_at: new Date().toISOString(),
      uid: uid
    };
    if (uid) db.tg_users['uid_' + uid] = chatId;
    saveDB(db);
    console.log('[TG] /start chatId:', chatId, 'uid:', uid);
    await tgSend(chatId,
      '<b>Dobro pozhalovat v CurlPro!</b>\n\n' +
      'Ty zaregistrirovan! Posle oplaty 99 rub. kod pridet syuda avtomaticheski.\n\n' +
      'Nazhmi Perejti k oplate na sajte i oplati 99 rub.\n' +
      'Kod pridet syuda v techenie minuty'
    );
    return;
  }

  await tgSend(chatId,
    '<b>CurlPro</b>\n\nPosle oplaty 99 rub. kod pridet avtomaticheski.\n\nVash ID: <code>' + chatId + '</code>'
  );
});

app.post('/activate', function(req, res) {
  var code = (req.body || {}).code;
  if (!code) return res.json({ success: false, error: 'no_code' });
  var db = loadDB();
  var key = code.trim().toUpperCase();
  if (!db.codes[key]) return res.json({ success: false, error: 'invalid_code' });
  if (db.used[key]) return res.json({ success: false, error: 'already_used' });
  db.used[key] = { usedAt: new Date().toISOString() };
  saveDB(db);
  console.log('[ACTIVATE] Code used:', key);
  return res.json({ success: true, days: 30 });
});

app.post('/yoomoney/webhook', async function(req, res) {
  res.sendStatus(200);
  var body = req.body || {};
  console.log('[YOOMONEY] Webhook received');

  if (YOOMONEY_SECRET && body.sha1_hash) {
    var str = [
      body.notification_type, body.operation_id, body.amount,
      body.currency, body.datetime, body.sender,
      body.codepro, YOOMONEY_SECRET, body.label
    ].join('&');
    var hash = crypto.createHash('sha1').update(str).digest('hex');
    if (hash !== body.sha1_hash) {
      console.log('[YOOMONEY] Invalid signature');
      return;
    }
  }

  var amount = parseFloat(body.amount || '0');
  if (amount < 99) return;

  var db = loadDB();
  var code;
  do { code = generateCode(); } while (db.codes[code]);
  db.codes[code] = { createdAt: new Date().toISOString(), payer: body.sender, amount: body.amount };
  saveDB(db);
  console.log('[YOOMONEY] Payment', body.amount, '-> code:', code);

  var label = (body.label || '').toString().trim();
  var chatId = label ? db.tg_users['uid_' + label] : null;
  if (chatId) {
    await tgSend(chatId,
      'Oplata poluchena! Spasibo!\n\n' +
      'Vash kod aktivacii CurlPro na 30 dnej:\n\n' +
      '<code>' + code + '</code>\n\n' +
      'Kak aktivirovat:\n' +
      '1. Otkroj sajt CurlPro\n' +
      '2. Nazhmi - U menya est kod aktivacii\n' +
      '3. Vvedi kod vyshe\n' +
      '4. Gotovo - 30 dnej dostupa!'
    );
    console.log('[TG] Code sent to', chatId);
  } else {
    console.log('[TG] chatId not found for label:', label, 'code:', code);
  }
});

app.post('/admin/generate', function(req, res) {
  var body = req.body || {};
  if (body.secret !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });
  var count = Math.min(parseInt(body.count) || 1, 100);
  var db = loadDB();
  var newCodes = [];
  for (var i = 0; i < count; i++) {
    var code;
    do { code = generateCode(); } while (db.codes[code]);
    db.codes[code] = { createdAt: new Date().toISOString() };
    newCodes.push(code);
  }
  saveDB(db);
  console.log('[ADMIN] Created', newCodes.length, 'codes');
  return res.json({ success: true, codes: newCodes });
});

app.get('/admin/stats', function(req, res) {
  if (req.query.secret !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });
  var db = loadDB();
  return res.json({
    total: Object.keys(db.codes).length,
    used: Object.keys(db.used).length,
    unused: Object.keys(db.codes).filter(function(c) { return !db.used[c]; }).length,
    tg_users: Object.keys(db.tg_users).length,
    unusedCodes: Object.keys(db.codes).filter(function(c) { return !db.used[c]; })
  });
});

app.get('/', function(req, res) {
  res.json({ status: 'ok', service: 'CurlPro Server v2' });
});

app.listen(PORT, function() {
  console.log('CurlPro server v2 started on port', PORT);
});
