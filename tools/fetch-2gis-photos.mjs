// Пайплайн портфолио «Систем Пласт»: реальные фото работ с 2ГИС.
// Галерея объекта 70000001062342075 (Караганда, Систем Пласт) — 60 фото + видео.
// API: api.photo.2gis.com (публичный веб-ключ). CDN отдаёт любой размер-кроп:
//   https://iN.photo.2gis.com/photo-gallery/<uuid>_<W>x<H>.jpg
//
// Раскладка p1..p14 (public/img) — соответствие индексам галереи и кропам под ячейки сетки:
//   pN: [индексФото, кроп]  (tall 900x1400, normal 1100x800, wide 1400x560;
//                            для мелких исходников — кроп в нативных пикселях)
//
// Запуск:  node tools/fetch-2gis-photos.mjs
// (после скачивания файлы при желании пережимаются системным JPEG-энкодером q82)

import { mkdir, writeFile } from 'node:fs/promises';

const BRANCH = '70000001062342075';
const KEY = 'gYu1s9N1wP';
const API = `https://api.photo.2gis.com/3.0/objects/${BRANCH}/albums/all/media?key=${KEY}&page_size=100&locale=ru_KZ`;
const OUT = new URL('../public/img/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// pN -> [индекс в галерее (photo-элементы по порядку), размер кропа]
const MAP = {
  p1: [24, '864x628'],    // окно с видом на город
  p2: [11, '900x1400'],   // остеклённые балконы, кирпичный дом (tall)
  p3: [15, '1100x800'],   // современный частный дом
  p4: [8, '1100x800'],    // лоджии в новом доме
  p5: [10, '1400x560'],   // загородный дом (wide)
  p6: [26, '768x559'],    // окно с тёмной ламинацией
  p7: [47, '1100x800'],   // замена окон в панельном доме
  p8: [18, '900x1400'],   // фасадное остекление, вид изнутри (tall)
  p9: [43, '1100x800'],   // монтаж стеклянных перегородок
  p10: [4, '1100x800'],   // арочное окно
  p11: [7, '1400x560'],   // витрины магазина (wide)
  p12: [22, '900x1400'],  // установка стеклянной двери (tall)
  p13: [19, '1100x800'],  // балконы-эркеры в новом доме
  p14: [3, '886x644'],    // комплекс «Меридиан»
};

await mkdir(OUT, { recursive: true });

const res = await fetch(API, { signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error('2GIS API: HTTP ' + res.status);
const json = await res.json();
const photos = (json.items || []).filter((it) => it.media_type === 'photo' && it.photo && it.photo.url);
console.log('photos in gallery:', photos.length);

for (const [name, [idx, size]] of Object.entries(MAP)) {
  const it = photos[idx - 1];
  if (!it) { console.log('SKIP', name, '— фото #' + idx + ' нет'); continue; }
  const url = it.photo.url.replace(/\.jpg$/, `_${size}.jpg`);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(`${OUT}${name}.jpg`, buf);
    console.log('OK', `${name}.jpg`, Math.round(buf.length / 1024) + 'KB', '←', `#${idx}`, `(${it.photo.width}x${it.photo.height})`);
  } catch (e) {
    console.log('FAIL', name, e.message);
  }
}
