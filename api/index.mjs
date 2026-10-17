/**
 * Систем Пласт — API для Vercel (serverless-функция).
 * Маршруты повторяют локальный server.js: заявки, вход в админку, статистика, PATCH/DELETE, CSV.
 * Хранилище — Upstash Redis через REST (без внешних зависимостей).
 * Переменные окружения: ADMIN_PASSWORD, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * (или KV_REST_API_URL / KV_REST_API_TOKEN), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_URL.
 */
import crypto from 'node:crypto';

const PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!PASSWORD) console.warn('[security] ADMIN_PASSWORD не задан — вход в админку отключён');
const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const LEADS_KEY = 'sistem-plast:leads';
const TOKEN_TTL = 12 * 60 * 60 * 1000;

const s = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const digits = (v) => String(v ?? '').replace(/\D/g, '');

// ---------------------------------------------------------------- storage ---
async function kv(cmd) {
  if (!KV_URL || !KV_TOKEN) throw new Error('storage disabled');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('kv http ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error('kv: ' + data.error);
  return data.result;
}

async function getLeads() {
  const raw = await kv(['GET', LEADS_KEY]);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveLeads(leads) {
  await kv(['SET', LEADS_KEY, JSON.stringify(leads.slice(0, 2000))]);
}

// ------------------------------------------------------------------ json ----
function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    // на Vercel чтение req.body может бросить исключение при сломанном JSON
    let body;
    try { body = req.body; } catch { return reject(new Error('invalid json')); }
    if (body !== undefined && body !== null) {
      try {
        if (typeof body === 'string') return resolve(body ? JSON.parse(body) : {});
        if (Buffer.isBuffer(body)) return resolve(body.length ? JSON.parse(body.toString('utf8')) : {});
        return resolve(body);
      } catch {
        return reject(new Error('invalid json'));
      }
    }
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

// ----------------------------------------------------------------- tokens ---
function sign(exp) {
  return crypto.createHmac('sha256', PASSWORD + '|sistem-plast').update(String(exp)).digest('hex');
}
function issueToken() {
  const exp = Date.now() + TOKEN_TTL;
  return exp + '.' + sign(exp);
}
function validToken(t) {
  if (!t || typeof t !== 'string' || !t.includes('.')) return false;
  const [exp, sig] = t.split('.');
  if (!/^\d{10,16}$/.test(exp) || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  try {
    return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
  } catch {
    return false;
  }
}
function auth(req, url) {
  const t = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
  return validToken(t);
}

// -------------------------------------------------------------- rate-limit --
const buckets = new Map();
function rateLimit(ip, key, max, windowMs) {
  const k = key + ':' + ip;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(k, b); }
  b.count++;
  if (buckets.size > 5000) {
    for (const [kk, bb] of buckets) if (now > bb.reset) buckets.delete(kk);
  }
  return b.count <= max;
}

// ------------------------------------------------------------ notifications --
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
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    tasks.push(
      fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text: lines.join('\n'), parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})
    );
  }
  if (process.env.WEBHOOK_URL) {
    tasks.push(
      fetch(process.env.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})
    );
  }
  await Promise.allSettled(tasks);
}

// ----------------------------------------------------------------- handler --
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers['host'] || 'localhost'));
  let p = url.pathname;
  // если rewrite переписал путь — восстановим оригинал
  if (p === '/api' || p === '/api/index') {
    const orig = req.headers['x-original-url'] || req.headers['x-rewrite-url'] || '';
    if (orig && orig.startsWith('/api')) p = orig.split('?')[0];
  }
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim().slice(0, 45);

  try {
    if (p === '/api/health') return json(res, 200, { ok: true, time: new Date().toISOString(), storage: Boolean(KV_URL && KV_TOKEN), route: p });

    if (p === '/api/login' && req.method === 'POST') {
      if (!rateLimit(ip, 'login', 10, 15 * 60_000)) return json(res, 429, { error: 'Слишком много попыток. Попробуйте через 15 минут.' });
      if (!PASSWORD) return json(res, 401, { error: 'Вход в админку не настроен' });
      const body = await readBody(req);
      const pass = s(body.password, 100);
      const a = Buffer.from(pass);
      const b = Buffer.from(PASSWORD);
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
        ip,
      };

      try {
        const leads = await getLeads();
        leads.unshift(lead);
        await saveLeads(leads);
      } catch (e) {
        console.error('[lead] storage:', e.message);
        await notifyNewLead(lead); // хотя бы уведомим, чтобы заявка не потерялась
        return json(res, 503, { error: 'Сервис заявок временно недоступен. Позвоните: +7 700 727 27 37' });
      }

      await notifyNewLead(lead);
      return json(res, 201, { ok: true, id: lead.id });
    }

    if (p === '/api/logout' && req.method === 'POST') return json(res, 200, { ok: true });

    // -------------------------------------------------------- admin API
    if (p === '/api/leads' && req.method === 'GET') {
      if (!auth(req, url)) return json(res, 401, { error: 'unauthorized' });
      let leads;
      try { leads = await getLeads(); } catch { return json(res, 503, { error: 'storage unavailable' }); }
      const status = s(url.searchParams.get('status'), 20);
      const q = s(url.searchParams.get('q'), 100).toLowerCase();
      let list = leads;
      if (status && status !== 'all') list = list.filter((l) => l && l.status === status);
      if (q) list = list.filter((l) => [l.name, l.phone, l.message, l.configSummary, l.sourceLabel].some((v) => String(v || '').toLowerCase().includes(q)));
      return json(res, 200, { leads: list.slice(0, 500), total: leads.length });
    }

    const leadMatch = p.match(/^\/api\/leads\/([A-Za-z0-9]+)$/);
    if (leadMatch) {
      if (!auth(req, url)) return json(res, 401, { error: 'unauthorized' });
      let leads;
      try { leads = await getLeads(); } catch { return json(res, 503, { error: 'storage unavailable' }); }
      const lead = leads.find((l) => l.id === leadMatch[1]);
      if (!lead) return json(res, 404, { error: 'not found' });
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        if (['new', 'progress', 'done', 'rejected'].includes(body.status)) lead.status = body.status;
        if (typeof body.note === 'string') lead.note = s(body.note, 1000);
        lead.updatedAt = new Date().toISOString();
        try { await saveLeads(leads); } catch { return json(res, 503, { error: 'storage unavailable' }); }
        return json(res, 200, { ok: true, lead });
      }
      if (req.method === 'DELETE') {
        try { await saveLeads(leads.filter((l) => l.id !== leadMatch[1])); } catch { return json(res, 503, { error: 'storage unavailable' }); }
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'method not allowed' });
    }

    if (p === '/api/stats' && req.method === 'GET') {
      if (!auth(req, url)) return json(res, 401, { error: 'unauthorized' });
      let leads;
      try { leads = await getLeads(); } catch { return json(res, 503, { error: 'storage unavailable' }); }
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
        total: leads.length, week, today, bySource, byStatus,
        avgPrice: priceCount ? Math.round(sumPrice / priceCount) : 0,
      });
    }

    if (p === '/api/export.csv' && req.method === 'GET') {
      if (!auth(req, url)) return json(res, 401, { error: 'unauthorized' });
      let leads;
      try { leads = await getLeads(); } catch { return json(res, 503, { error: 'storage unavailable' }); }
      const esc = (v) => {
        let str = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(str)) str = "'" + str; // защита от CSV-инъекций в Excel
        return '"' + str.replace(/"/g, '""') + '"';
      };
      const rows = [
        ['ID', 'Дата', 'Источник', 'Имя', 'Телефон', 'Сообщение', 'Цена, ₸', 'Конфигурация', 'Статус', 'Заметка'],
        ...leads.map((l) => [
          l.id, new Date(l.createdAt).toLocaleString('ru-RU'), l.sourceLabel || l.source,
          l.name, l.phone, l.message, l.price || '', l.configSummary, l.status, l.note,
        ]),
      ];
      const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.end(csv);
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (/invalid json/i.test(e.message || '')) return json(res, 400, { error: 'Некорректный JSON в запросе' });
    if (e.message === 'body too large' || e.statusCode === 413) return json(res, 413, { error: 'Слишком большой запрос' });
    console.error('[api]', e);
    return json(res, 500, { error: 'internal error' });
  }
}
