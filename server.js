/**
 * Систем Пласт — премиальный сайт + автоматизация заявок.
 * Чистый Node.js без зависимостей: статика + API (заявки, админка, экспорт).
 *
 * Запуск:  node server.js   (порт и пароль — в config.json; админка на /admin)
 * Настройки: config.json  (порт, пароль админки, Telegram-уведомления, webhook)
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');

// ---------------------------------------------------------------- config ----
let config = {
  port: 3100,
  adminPassword: '',
  telegram: { botToken: '', chatId: '' },
  webhookUrl: '',
};
try {
  config = { ...config, ...JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) };
} catch {
  console.warn('[config] config.json не найден — использую значения по умолчанию');
}
if (!config.adminPassword) {
  console.warn('[security] adminPassword не задан в config.json — вход в админку отключён');
}

// ------------------------------------------------------------------ data ----
await fs.mkdir(DATA_DIR, { recursive: true });

let leads = [];
try {
  const raw = JSON.parse(await fs.readFile(LEADS_FILE, 'utf8'));
  leads = Array.isArray(raw.leads) ? raw.leads : [];
} catch {
  leads = [];
}

let persistChain = Promise.resolve();
function persistLeads() {
  persistChain = persistChain.then(async () => {
    const tmp = LEADS_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), leads }, null, 2));
    await fs.rename(tmp, LEADS_FILE);
  }).catch((e) => console.error('[persist]', e.message));
  return persistChain;
}

// ---------------------------------------------------------------- tokens ----
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 часов
const tokens = new Map();
function issueToken() {
  const t = crypto.randomBytes(24).toString('hex');
  tokens.set(t, Date.now() + TOKEN_TTL);
  return t;
}
function validToken(t) {
  const exp = tokens.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { tokens.delete(t); return false; }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of tokens) if (exp < now) tokens.delete(t);
}, 60_000).unref();

// ----------------------------------------------------------- rate-limit -----
const buckets = new Map();
function rateLimit(ip, key, max, windowMs) {
  const k = key + ':' + ip;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(k, b); }
  b.count++;
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 120_000).unref();

// ------------------------------------------------------------- helpers ------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  res.end(body);
}

function readBody(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.removeAllListeners('data'); req.resume(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const s = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const digits = (v) => String(v ?? '').replace(/\D/g, '');

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function auth(req, url) {
  const t = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
  return validToken(t);
}

// ------------------------------------------------------- notifications ------
async function notifyNewLead(lead) {
  const lines = [
    '🪟 *Новая заявка — Систем Пласт*',
    `📌 Источник: ${lead.sourceLabel || lead.source}`,
    `👤 ${lead.name || '—'}`,
    `📞 ${lead.phone || '—'}`,
    lead.message ? `💬 ${lead.message}` : '',
    lead.price ? `💰 Ориентир: ${Number(lead.price).toLocaleString('ru-RU')} ₸` : '',
    lead.configSummary ? `⚙️ ${lead.configSummary}` : '',
    `🕒 ${new Date(lead.createdAt).toLocaleString('ru-RU')}`,
  ].filter(Boolean);

  const tasks = [];

  if (config.telegram?.botToken && config.telegram?.chatId) {
    tasks.push(
      fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: lines.join('\n'),
          parse_mode: 'Markdown',
        }),
        signal: AbortSignal.timeout(10_000),
      })
        .then((r) => r.ok ? console.log('[telegram] заявка отправлена') : r.text().then(t => console.warn('[telegram] ошибка:', t)))
        .catch((e) => console.warn('[telegram]', e.message))
    );
  }

  if (config.webhookUrl) {
    tasks.push(
      fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
        signal: AbortSignal.timeout(10_000),
      })
        .then(() => console.log('[webhook] отправлено'))
        .catch((e) => console.warn('[webhook]', e.message))
    );
  }

  await Promise.allSettled(tasks);
}

// -------------------------------------------------------------- static ------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json',
};

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' ) rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) { json(res, 403, { error: 'forbidden' }); return; }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) throw new Error('dir');
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': isHtml ? 'no-cache' : (ext === '.jpg' || ext === '.png' || ext === '.svg' || ext === '.webp' ? 'public, max-age=604800' : 'public, max-age=3600'),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const data = await fs.readFile(filePath);
    res.end(data);
  } catch {
    try {
      const page = await fs.readFile(path.join(PUBLIC_DIR, '404.html'));
      res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(page);
    } catch {
      json(res, 404, { error: 'not found' });
    }
  }
}

// ---------------------------------------------------------------- server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const ip = clientIp(req);

  try {
    // ---------------------------------------------------------- public API
    if (p === '/api/health') return json(res, 200, { ok: true, time: new Date().toISOString() });

    if (p === '/api/login' && req.method === 'POST') {
      if (!rateLimit(ip, 'login', 10, 15 * 60_000)) return json(res, 429, { error: 'Слишком много попыток. Попробуйте через 15 минут.' });
      if (!config.adminPassword) return json(res, 401, { error: 'Вход в админку не настроен' });
      const body = await readBody(req);
      const pass = s(body.password, 100);
      const a = Buffer.from(pass);
      const b = Buffer.from(config.adminPassword);
      const okPass = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!pass || !okPass) return json(res, 401, { error: 'Неверный пароль' });
      return json(res, 200, { token: issueToken() });
    }

    if (p === '/api/leads' && req.method === 'POST') {
      if (!rateLimit(ip, 'lead', 20, 10 * 60_000)) return json(res, 429, { error: 'Слишком много заявок. Позвоните нам: +7 700 727 27 37' });
      const body = await readBody(req);

      // honeypot — боты заполняют скрытое поле
      if (body.website) return json(res, 200, { ok: true });

      const name = s(body.name, 120);
      const phone = s(body.phone, 40);
      const phoneDigits = digits(phone);
      if (phoneDigits.length < 10) return json(res, 400, { error: 'Укажите корректный номер телефона' });

      const lead = {
        id: 'L' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
        createdAt: new Date().toISOString(),
        source: s(body.source, 40) || 'site',
        sourceLabel: s(body.sourceLabel, 80) || 'Сайт',
        name,
        phone: phoneDigits.startsWith('8') && phoneDigits.length === 11 ? '+7' + phoneDigits.slice(1) : (phone.startsWith('+') ? phone : '+7' + phoneDigits.slice(-10)),
        message: s(body.message, 2000),
        page: s(body.page, 200),
        utm: body.utm && typeof body.utm === 'object' ? Object.fromEntries(Object.entries(body.utm).slice(0, 10).map(([k, v]) => [s(k, 40), s(v, 120)])) : {},
        price: Number(body.price) > 0 ? Math.round(Number(body.price)) : 0,
        configSummary: s(body.configSummary, 400),
        config: body.config && typeof body.config === 'object' ? body.config : null,
        status: 'new',
        note: '',
        ip: ip.length > 45 ? ip.slice(0, 45) : ip,
      };

      leads.unshift(lead);
      await persistLeads();
      console.log(`[lead] ${lead.source} | ${lead.name || '—'} | ${lead.phone}${lead.price ? ' | ~' + lead.price + '₸' : ''}`);
      notifyNewLead(lead); // не блокируем ответ
      return json(res, 201, { ok: true, id: lead.id });
    }

    // ----------------------------------------------------------- admin API
    if (p === '/api/logout' && req.method === 'POST') {
      const t = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || '';
      tokens.delete(t);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/leads' && req.method === 'GET') {
      if (!auth(req, url)) return json(res, 401, { error: 'unauthorized' });
      const status = s(url.searchParams.get('status'), 20);
      const q = s(url.searchParams.get('q'), 100).toLowerCase();
      let list = leads;
      if (status && status !== 'all') list = list.filter(l => l.status === status);
      if (q) list = list.filter(l => [l.name, l.phone, l.message, l.configSummary, l.sourceLabel].some(v => String(v || '').toLowerCase().includes(q)));
      return json(res, 200, { leads: list.slice(0, 500), total: leads.length });
    }

    const leadMatch = p.match(/^\/api\/leads\/([A-Za-z0-9]+)$/);
    if (leadMatch) {
      if (!auth(req, url)) return json(res, 401, { error: 'unauthorized' });
      const lead = leads.find(l => l.id === leadMatch[1]);
      if (!lead) return json(res, 404, { error: 'not found' });
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        if (['new', 'progress', 'done', 'rejected'].includes(body.status)) lead.status = body.status;
        if (typeof body.note === 'string') lead.note = s(body.note, 1000);
        lead.updatedAt = new Date().toISOString();
        await persistLeads();
        return json(res, 200, { ok: true, lead });
      }
      if (req.method === 'DELETE') {
        leads = leads.filter(l => l.id !== leadMatch[1]);
        await persistLeads();
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'method not allowed' });
    }

    if (p === '/api/stats' && req.method === 'GET') {
      if (!auth(req, url)) return json(res, 401, { error: 'unauthorized' });
      const now = Date.now();
      const day = 86_400_000;
      const bySource = {};
      const byStatus = { new: 0, progress: 0, done: 0, rejected: 0 };
      let week = 0, today = 0, sumPrice = 0, priceCount = 0;
      for (const l of leads) {
        bySource[l.sourceLabel || l.source] = (bySource[l.sourceLabel || l.source] || 0) + 1;
        if (byStatus[l.status] !== undefined) byStatus[l.status]++;
        const age = now - Date.parse(l.createdAt);
        if (age < 7 * day) week++;
        if (age < day) today++;
        if (l.price > 0) { sumPrice += l.price; priceCount++; }
      }
      return json(res, 200, {
        total: leads.length, week, today,
        bySource, byStatus,
        avgPrice: priceCount ? Math.round(sumPrice / priceCount) : 0,
      });
    }

    if (p === '/api/export.csv' && req.method === 'GET') {
      if (!auth(req, url)) return json(res, 401, { error: 'unauthorized' });
      const esc = (v) => {
        let str = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(str)) str = "'" + str; // защита от CSV-инъекций в Excel
        return '"' + str.replace(/"/g, '""') + '"';
      };
      const rows = [
        ['ID', 'Дата', 'Источник', 'Имя', 'Телефон', 'Сообщение', 'Цена, ₸', 'Конфигурация', 'Статус', 'Заметка'],
        ...leads.map(l => [
          l.id, new Date(l.createdAt).toLocaleString('ru-RU'), l.sourceLabel || l.source,
          l.name, l.phone, l.message, l.price || '', l.configSummary, l.status, l.note,
        ]),
      ];
      const csv = '\uFEFF' + rows.map(r => r.map(esc).join(';')).join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      });
      return res.end(csv);
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    // -------------------------------------------------------------- static
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e.message === 'invalid json') return json(res, 400, { error: 'Некорректный JSON в запросе' });
    if (e.message === 'body too large') return json(res, 413, { error: 'Слишком большой запрос' });
    console.error('[server]', e);
    return json(res, 500, { error: 'internal error' });
  }
});

const PORT = Number(process.env.PORT) || config.port || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  🪟  Систем Пласт — сайт запущен');
  console.log(`  ➜  Сайт:      http://localhost:${PORT}`);
  console.log(`  ➜  Админка:   http://localhost:${PORT}/admin`);
  console.log(`  ➜  Telegram:  ${config.telegram?.botToken ? 'подключён' : 'не настроен (config.json)'}`);
  console.log('');
});
