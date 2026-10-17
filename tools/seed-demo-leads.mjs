// Демонстрационные заявки для админ-панели (npm run demo-leads)
// Не перезаписывает реальные данные без флага --force
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.resolve('data/leads.json');
const force = process.argv.includes('--force');

const now = Date.now();
const demo = [
  {
    source: 'configurator', sourceLabel: 'Конфигуратор окон', name: 'Асель',
    phone: '+77001234567', price: 312500,
    configSummary: 'Окно ПВХ REHAU, 1500×1400 мм, двухкамерный стеклопакет, поворотно-откидное, москитная сетка, подоконник — ориентир 312 500 ₸',
    message: '', status: 'new', hoursAgo: 2,
  },
  {
    source: 'hero', sourceLabel: 'Первый экран', name: 'Дмитрий',
    phone: '+77002345678', price: 0, configSummary: '',
    message: 'Нужно заменить 3 окна в квартире, 2-й этаж, панелька. Когда можете приехать на замер?',
    status: 'progress', hoursAgo: 26,
  },
  {
    source: 'chat', sourceLabel: 'Онлайн-чат на сайте', name: 'Клиент из чата',
    phone: '+77003456789', price: 189000, configSummary: 'Окно ПВХ KBE, 1300×1400 мм',
    message: 'Чат: клиент оставил номер. Интересовался рассрочкой.', status: 'done', hoursAgo: 50,
  },
  {
    source: 'process', sourceLabel: 'Блок «Как работаем»', name: 'Гульнара',
    phone: '+77004567890', price: 0, configSummary: '',
    message: 'Остекление балкона 6 метров, хотим тёплое. И подоконники поменять.', status: 'new', hoursAgo: 5,
  },
  {
    source: 'configurator', sourceLabel: 'Конфигуратор окон', name: 'Сергей',
    phone: '+77005678901', price: 845000,
    configSummary: 'Витрина / фасад (алюминий), 4000×2400 мм, глухое — ориентир 845 000 ₸',
    message: 'Кафе 120 м², нужно застеклить входную группу и витрину.', status: 'progress', hoursAgo: 74,
  },
  {
    source: 'contacts', sourceLabel: 'Блок контактов', name: 'Марина',
    phone: '+77006789012', price: 0, configSummary: '',
    message: 'Ремонт фурнитуры на 2 окнах, дует из-под створки.', status: 'rejected', hoursAgo: 120,
  },
];

let existing = { leads: [] };
try { existing = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { /* нет файла — ок */ }

if ((existing.leads || []).length > 0 && !force) {
  console.log('⚠️  data/leads.json уже содержит заявки:', existing.leads.length);
  console.log('   Чтобы добавить демо-заявки поверх, запустите с флагом:  node tools/seed-demo-leads.mjs --force');
  process.exit(0);
}

const leads = (existing.leads || []).concat(demo.map((d, i) => ({
  id: 'DEMO' + (i + 1) + '-' + crypto.randomBytes(2).toString('hex'),
  createdAt: new Date(now - d.hoursAgo * 3600_000).toISOString(),
  source: d.source, sourceLabel: d.sourceLabel, name: d.name, phone: d.phone,
  message: d.message, page: '/', utm: {}, price: d.price, configSummary: d.configSummary,
  config: null, status: d.status, note: '', ip: 'demo',
})));

await fs.mkdir(path.dirname(FILE), { recursive: true });
await fs.writeFile(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), leads }, null, 2));
console.log('✅ Добавлено демо-заявок:', demo.length, '| Всего в базе:', leads.length);
console.log('ℹ️  Если сервер уже запущен — перезапустите его (Ctrl+C → node server.js), чтобы панель увидела новые заявки.');
