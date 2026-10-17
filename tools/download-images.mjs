// Загрузчик изображений для сайта «Систем Пласт»
// Запуск: node tools/download-images.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('public/img');

const IMAGES = {
  // Hero
  'hero-day.jpg': 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1440&q=75&auto=format&fit=crop',
  'hero-night.jpg': 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1440&q=75&auto=format&fit=crop',
  // Портфолио
  'p1.jpg': 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1100&q=72&auto=format&fit=crop',
  'p2.jpg': 'https://images.unsplash.com/photo-1722649944570-ddf8a6ed8a03?w=900&h=1400&q=72&auto=format&fit=crop',
  'p3.jpg': 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1100&q=72&auto=format&fit=crop',
  'p4.jpg': 'https://images.unsplash.com/photo-1722349674134-9126e3801aea?w=1100&h=800&q=72&auto=format&fit=crop',
  'p5.jpg': 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1100&q=72&auto=format&fit=crop',
  'p6.jpg': 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1100&q=72&auto=format&fit=crop',
  'p7.jpg': 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1100&q=72&auto=format&fit=crop',
  'p8.jpg': 'https://images.unsplash.com/photo-1621831337128-35676ca30868?w=900&h=1400&q=72&auto=format&fit=crop',
  'p9.jpg': 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1100&q=72&auto=format&fit=crop',
  'p10.jpg': 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1100&q=72&auto=format&fit=crop',
  'p11.jpg': 'https://images.unsplash.com/photo-1777691906504-dd2cecbccd20?w=1400&h=560&q=72&auto=format&fit=crop',
  'p12.jpg': 'https://images.unsplash.com/photo-1717749874408-e2bba52259ff?w=900&h=1400&q=72&auto=format&fit=crop',
  'p13.jpg': 'https://images.unsplash.com/photo-1789552644263-f570a1d6004b?w=1100&h=800&q=72&auto=format&fit=crop',
  'p14.jpg': 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1100&q=72&auto=format&fit=crop',
};

await mkdir(OUT, { recursive: true });

const results = { ok: [], fail: [] };

async function grab(name, url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5000) throw new Error('too small: ' + buf.length);
    await writeFile(path.join(OUT, name), buf);
    results.ok.push(`${name} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    results.fail.push(`${name}: ${e.message}`);
  }
}

// по 4 параллельно
const entries = Object.entries(IMAGES);
for (let i = 0; i < entries.length; i += 4) {
  await Promise.all(entries.slice(i, i + 4).map(([n, u]) => grab(n, u)));
}

console.log('OK:', results.ok.length);
results.ok.forEach(r => console.log('  ✓', r));
console.log('FAIL:', results.fail.length);
results.fail.forEach(r => console.log('  ✗', r));
