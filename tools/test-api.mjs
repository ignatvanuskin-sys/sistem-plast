// Быстрая проверка всех API-эндпоинтов и страниц сайта
const BASE = process.env.SP_BASE || 'http://localhost:3100';
const results = [];
function check(name, ok, extra = '') {
  results.push(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

// 1. health
let r = await fetch(BASE + '/api/health');
check('GET /api/health', r.ok, r.status);

// 2. главная страница
r = await fetch(BASE + '/');
const html = await r.text();
check('GET / (главная)', r.ok && html.includes('СИСТЕМ'), `${r.status}, ${(html.length / 1024).toFixed(0)} KB`);

// 3. админка по короткому адресу
r = await fetch(BASE + '/admin');
const admin = await r.text();
check('GET /admin', r.ok && admin.includes('Панель управления'), r.status);

// 4. CSS/JS
for (const f of ['/css/style.css', '/js/app.js', '/js/configurator.js', '/js/chat.js', '/img/favicon.svg', '/img/hero-day.jpg']) {
  r = await fetch(BASE + f);
  check('GET ' + f, r.ok, r.status + ' ' + (r.headers.get('content-type') || ''));
}

// 5. создание заявки
r = await fetch(BASE + '/api/leads', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Тест Тестов',
    phone: '8 700 123 45 67',
    message: 'Проверка API',
    source: 'test',
    sourceLabel: 'Автотест',
    price: 123000,
    configSummary: 'Тестовая конфигурация',
  }),
});
const lead = await r.json();
check('POST /api/leads', r.status === 201 && lead.ok, `status=${r.status} id=${lead.id} нормализация=${lead.ok ? 'ок' : ''}`);

// 6. невалидный телефон
r = await fetch(BASE + '/api/leads', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'X', phone: '123' }),
});
check('POST /api/leads (невалидный телефон → 400)', r.status === 400, r.status);

// 7. honeypot
r = await fetch(BASE + '/api/leads', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Bot', phone: '+77001112233', website: 'spam' }),
});
const hon = await r.json();
check('POST /api/leads (honeypot → тихий ok)', r.ok && hon.ok && !hon.id, 'бот отсечён');

// 8. вход без пароля / с паролем
r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"wrong"}' });
check('POST /api/login (неверный пароль → 401)', r.status === 401, r.status);
r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"sistem2026"}' });
const login = await r.json();
check('POST /api/login (верный пароль)', r.ok && !!login.token, 'токен получен');
const token = login.token;

// 9. список заявок без токена
r = await fetch(BASE + '/api/leads');
check('GET /api/leads без токена → 401', r.status === 401, r.status);

// 10. список заявок с токеном
r = await fetch(BASE + '/api/leads?status=all', { headers: { Authorization: 'Bearer ' + token } });
const list = await r.json();
check('GET /api/leads (с токеном)', r.ok && Array.isArray(list.leads), `заявок: ${list.leads.length}`);

// 11. смена статуса
const testLead = list.leads.find(l => l.sourceLabel === 'Автотест');
r = await fetch(BASE + '/api/leads/' + testLead.id, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ status: 'done', note: 'проверено' }),
});
const patch = await r.json();
check('PATCH /api/leads/:id (статус+заметка)', r.ok && patch.lead.status === 'done' && patch.lead.note === 'проверено', r.status);

// 12. статистика
r = await fetch(BASE + '/api/stats', { headers: { Authorization: 'Bearer ' + token } });
const stats = await r.json();
check('GET /api/stats', r.ok && typeof stats.total === 'number', `всего=${stats.total} за неделю=${stats.week}`);

// 13. CSV
r = await fetch(BASE + '/api/export.csv?token=' + token);
const csv = await r.text();
check('GET /api/export.csv', r.ok && csv.includes('Тест Тестов'), `${(csv.length / 1024).toFixed(1)} KB`);

// 14. удаление тестовой заявки
r = await fetch(BASE + '/api/leads/' + testLead.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
check('DELETE /api/leads/:id', r.ok, r.status);

// 15. 404 страница
r = await fetch(BASE + '/нет-такой-страницы');
const nf = await r.text();
check('GET несуществующей страницы → 404-страница', r.status === 404 && nf.includes('404'), r.status);

// 16. защита от обхода путей
r = await fetch(BASE + '/../config.json');
check('Path traversal защита', r.status !== 200 || !(await r.text()).includes('adminPassword'), r.status);

console.log('\n' + results.join('\n'));
const failed = results.filter(x => x.startsWith('❌')).length;
console.log(`\nИтого: ${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
