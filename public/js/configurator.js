/* ============================================================================
   Систем Пласт — онлайн-конфигуратор окон
   Живой SVG-предпросмотр + мгновенный расчёт стоимости + смета + WhatsApp.
   ============================================================================ */
(function () {
  'use strict';
  const { $, $$, fmt } = window.SP;

  // ---------------------------------------------------------------- данные --
  const BASE = {
    window:  { kbe: 24000, veka: 27000, rehau: 31000, salamander: 35000 },
    balcony: { kbe: 21000, veka: 23500, rehau: 26000, salamander: 29000 },
    door:    { kbe: 38000, veka: 42000, rehau: 46000, salamander: 52000 },
    vitrage: { alum: 36000 },
  };
  const GLASS = {
    g1: { add: 0,    label: 'Однокамерный стеклопакет' },
    g2: { add: 2800, label: 'Двухкамерный стеклопакет' },
    g3: { add: 5400, label: 'Трёхкамерный энергосберегающий стеклопакет' },
  };
  const OPEN = {
    fixed: { add: 0,    label: 'глухое' },
    turn:  { add: 6000, label: 'поворотное' },
    tilt:  { add: 9500, label: 'поворотно-откидное' },
  };
  const EXTRAS = {
    net:  { price: 8500, label: 'москитная сетка' },
    sill: { price: 7000, label: 'подоконник' },
    drip: { price: 4500, label: 'отлив' },
    lock: { price: 5500, label: 'детский замок' },
    tint: { percent: 12, label: 'тонировка' },
  };
  const COLORS = {
    white: { a: '#fbfcfe', b: '#dde4ee', stroke: '#a9b5c7', name: 'белый' },
    grey:  { a: '#5a6678', b: '#39434f', stroke: '#232b36', name: 'серый антрацит' },
    gold:  { a: '#d8ab6b', b: '#a97e3f', stroke: '#7c5a25', name: 'золотой дуб' },
    alum:  { a: '#9aa7b8', b: '#6d7a8c', stroke: '#4c586a', name: 'алюминий' },
  };
  const TYPES = {
    window:  { label: 'Окно ПВХ', w: 1300, h: 1400, minW: 400, maxW: 3200, minH: 400, maxH: 2200 },
    balcony: { label: 'Остекление балкона', w: 3000, h: 1500, minW: 800, maxW: 6500, minH: 600, maxH: 1800 },
    door:    { label: 'Дверь ПВХ', w: 900, h: 2100, minW: 600, maxW: 2000, minH: 1800, maxH: 2500 },
    vitrage: { label: 'Витрина / фасад (алюминий)', w: 2600, h: 2400, minW: 800, maxW: 6500, minH: 800, maxH: 3200 },
  };
  const COLORS_ADD = { white: 0, grey: 5, gold: 8 };
  const PROFILES = { kbe: 'KBE', veka: 'VEKA', rehau: 'REHAU', salamander: 'Salamander' };

  const state = {
    type: 'window',
    w: 1300,
    h: 1400,
    profile: 'kbe',
    glass: 'g2',
    open: 'tilt',
    color: 'white',
    extras: new Set(['sill']),
  };

  // ------------------------------------------------------------- элементы --
  const elW = $('#confW');
  const elH = $('#confH');
  const canvas = $('#confCanvas');
  const elPrice = $('#confPrice');
  const elMonthly = $('#confMonthly');
  const elBreakdown = $('#confBreakdown');
  const elHint = $('#confAreaHint');
  const elWa = $('#confWa');

  // ----------------------------------------------------------- вычисления --
  function sashCount() {
    if (state.type === 'door') return 1;
    if (state.type === 'window') return state.w >= 2100 ? 3 : state.w >= 950 ? 2 : 1;
    if (state.type === 'balcony') return Math.max(2, Math.min(5, Math.round(state.w / 1200)));
    return Math.max(2, Math.min(6, Math.round(state.w / 1400)));
  }

  function calc() {
    const area = Math.max(0.45, (state.w * state.h) / 1e6);
    const priceKey = state.type === 'vitrage' ? 'alum' : state.profile;
    const base = BASE[state.type][priceKey];
    const glassAdd = GLASS[state.glass].add;
    const frame = area * base;
    const glazing = area * glassAdd;
    const opening = OPEN[state.open].add;
    const colorPct = COLORS_ADD[state.color] || 0;
    const colorAdd = (frame + glazing) * colorPct / 100;

    let extrasSum = 0;
    for (const key of state.extras) {
      const ex = EXTRAS[key];
      if (ex && ex.price) extrasSum += ex.price;
    }
    let tintAdd = 0;
    if (state.extras.has('tint')) tintAdd = (frame + glazing) * EXTRAS.tint.percent / 100;

    const raw = frame + glazing + opening + colorAdd + extrasSum + tintAdd;
    const total = Math.round(raw / 500) * 500;
    const monthly = Math.round(total / 24);

    return { area, frame, glazing, opening, colorAdd, extrasSum, tintAdd, total, monthly, priceKey };
  }

  function summaryText() {
    const c = calc();
    const extras = [...state.extras].map(k => EXTRAS[k]?.label).filter(Boolean);
    const profile = state.type === 'vitrage' ? 'алюминий' : PROFILES[state.profile];
    return `${TYPES[state.type].label} ${profile}, ${state.w}×${state.h} мм, ${GLASS[state.glass].label.toLowerCase()}, ${OPEN[state.open].label}` +
      (extras.length ? `, ${extras.join(', ')}` : '') +
      ` — ориентир ${fmt(c.total)}`;
  }

  // ----------------------------------------------------------- SVG рендер --
  function buildSVG() {
    const c = calc();
    const VW = 430, VH = 560;
    const padX = 58, padTop = 34, padBottom = 78, padRight = 76;
    const maxW = VW - padX - padRight, maxH = VH - padTop - padBottom;
    const scale = Math.min(maxW / state.w, maxH / state.h);
    const fw = state.w * scale, fh = state.h * scale;
    const x0 = padX + (maxW - fw) / 2, y0 = padTop + (maxH - fh) / 2;
    const x1 = x0 + fw, y1 = y0 + fh;
    const t = Math.max(9, Math.min(24, 70 * scale));
    const t2 = Math.max(5, t * 0.5);
    const col = state.type === 'vitrage' ? COLORS.alum : COLORS[state.color];
    const n = sashCount();
    const isDoor = state.type === 'door';
    const tinted = state.extras.has('tint');

    const defs = `
      <linearGradient id="cfFrame" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${col.a}"/><stop offset="1" stop-color="${col.b}"/>
      </linearGradient>
      <linearGradient id="cfGlass" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#cfe6ff"/><stop offset="0.45" stop-color="#9cc3ee"/><stop offset="1" stop-color="#6fa1d8"/>
      </linearGradient>
      <linearGradient id="cfGlass2" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0" stop-color="#bcd9f8"/><stop offset="1" stop-color="#7fb0e2"/>
      </linearGradient>
      <linearGradient id="cfHandle" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#e8edf5"/><stop offset="0.5" stop-color="#b6c1d2"/><stop offset="1" stop-color="#7e8ba0"/>
      </linearGradient>
      <radialGradient id="cfGlow" cx="0.5" cy="0.42" r="0.62">
        <stop offset="0" stop-color="rgba(125,215,255,0.30)"/><stop offset="1" stop-color="rgba(125,215,255,0)"/>
      </radialGradient>
      <pattern id="cfNet" width="7" height="7" patternUnits="userSpaceOnUse">
        <path d="M0 0h7v7" fill="none" stroke="#274a86" stroke-width="0.7" opacity="0.6"/>
      </pattern>
    `;

    let s = `<svg viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg" role="img">`;
    s += `<defs>${defs}</defs>`;
    s += `<ellipse cx="${VW * 0.5}" cy="${(y0 + y1) / 2}" rx="${fw * 0.85}" ry="${fh * 0.72}" fill="url(#cfGlow)"/>`;

    // стена
    s += `<rect x="${x0 - 20}" y="${y0 - 20}" width="${fw + 40}" height="${fh + 40}" rx="10" fill="#0d1830" stroke="rgba(255,255,255,0.06)"/>`;

    // отлив (за рамой)
    if (state.extras.has('drip')) {
      s += `<rect x="${x0 - 26}" y="${y1 - 2}" width="${fw + 52}" height="7" rx="3" fill="#3b475e"/>`;
    }

    // внешняя рама
    s += `<rect x="${x0}" y="${y0}" width="${fw}" height="${fh}" rx="${Math.max(4, t * 0.35)}" fill="url(#cfFrame)" stroke="${col.stroke}" stroke-width="1.5"/>`;

    // стекло (общая подложка)
    const gx = x0 + t, gy = y0 + t, gw = fw - t * 2, gh = fh - t * 2;
    s += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" fill="url(#cfGlass2)"/>`;

    // створки
    const innerW = gw;
    const sashW = innerW / n;
    for (let i = 0; i < n; i++) {
      const sx = gx + i * sashW;
      const w = sashW;
      const operable = state.open !== 'fixed' && (n === 1 || i < n - 1);

      // рама створки
      s += `<rect x="${sx + t2 / 2}" y="${gy + t2 / 2}" width="${w - t2}" height="${gh - t2}" rx="${Math.max(2, t2 * 0.4)}" fill="none" stroke="url(#cfFrame)" stroke-width="${t2}" />`;
      s += `<rect x="${sx + t2 / 2}" y="${gy + t2 / 2}" width="${w - t2}" height="${gh - t2}" rx="${Math.max(2, t2 * 0.4)}" fill="none" stroke="${col.stroke}" stroke-width="0.8" opacity="0.6"/>`;

      // область стекла створки (абсолютные координаты)
      const glassBottom = isDoor ? gy + (gh - t2) * 0.62 : gy + gh - t2 * 0.5;
      s += `<rect x="${sx + t2 * 1.4}" y="${gy + t2 * 1.4}" width="${w - t2 * 2.8}" height="${glassBottom - gy - t2 * 1.4}" fill="url(#cfGlass)"/>`;

      // блик
      s += `<path d="M${sx + t2 * 1.6} ${gy + t2 * 5} L${sx + w * 0.55} ${gy + t2 * 1.6} L${sx + w * 0.38} ${glassBottom - t2 * 1.4} L${sx + t2 * 1.6} ${glassBottom - t2 * 3}" fill="rgba(255,255,255,0.16)"/>`;

      if (isDoor) {
        // нижняя панель двери
        const py = glassBottom + t2 * 0.4;
        s += `<rect x="${sx + t2 * 1.4}" y="${py}" width="${w - t2 * 2.8}" height="${gy + gh - t2 * 1.8 - py}" rx="4" fill="url(#cfFrame)" stroke="${col.stroke}" stroke-width="0.8"/>`;
        s += `<rect x="${sx + t2 * 3}" y="${py + t2 * 1.6}" width="${w - t2 * 6}" height="${gy + gh - t2 * 1.8 - py - t2 * 3.2}" rx="3" fill="none" stroke="${col.stroke}" stroke-width="1" opacity="0.45"/>`;
      }

      // открывание
      if (operable) {
        const ix = sx + t2 * 2.4, iy = gy + t2 * 2.4;
        const iw = w - t2 * 4.8, ih = glassBottom - gy - t2 * 3.6;
        s += `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="rgba(125,215,255,0.06)" stroke="rgba(125,215,255,0.75)" stroke-width="1.4" stroke-dasharray="6 5" rx="3"/>`;
        // стрелка поворота
        const ax = ix + iw / 2, ay = iy + ih / 2;
        s += `<g stroke="rgba(125,215,255,0.9)" stroke-width="1.8" fill="none" stroke-linecap="round">
                <path d="M${ax - 14} ${ay + 10} L${ax + 14} ${ay - 10}"/>
                <path d="M${ax + 14} ${ay - 10} l-9 1.5 M${ax + 14} ${ay - 10} l-1.5 9"/>
              </g>`;
        if (state.open === 'tilt' && !isDoor) {
          s += `<g stroke="rgba(125,215,255,0.9)" stroke-width="1.8" fill="none" stroke-linecap="round">
                  <path d="M${ax} ${ay - 26} L${ax} ${ay - 48}"/><path d="M${ax - 6} ${ay - 41} l6 -7 6 7"/>
                </g>`;
        }
        // ручка
        const hx = sx + w - t2 * 2.6;
        const hy = isDoor ? gy + gh * 0.58 : gy + gh * 0.48;
        s += `<rect x="${hx}" y="${hy - 26}" width="5.5" height="52" rx="2.75" fill="url(#cfHandle)" stroke="#5b6778" stroke-width="0.4" opacity="0.95"/>`;
      }

      // детский замок
      if (operable && state.extras.has('lock')) {
        const lx = sx + w / 2, ly = gy + t2 * 3;
        s += `<g transform="translate(${lx} ${ly})">
                <rect x="-6" y="-4" width="12" height="10" rx="2" fill="#f2b64c" stroke="#b07f22" stroke-width="0.7"/>
                <path d="M-3.5 -4 v-3.4 a3.5 3.5 0 0 1 7 0 V-4" fill="none" stroke="#b07f22" stroke-width="1.6"/>
              </g>`;
      }
    }

    // москитная сетка поверх стёкол
    if (state.extras.has('net')) {
      s += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" fill="url(#cfNet)" opacity="0.8"/>`;
    }
    // тонировка
    if (tinted) {
      s += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" fill="rgba(15,23,38,0.5)"/>`;
    }

    // подоконник
    if (state.extras.has('sill')) {
      const sy = y1 + 9;
      s += `<rect x="${x0 - 16}" y="${sy}" width="${fw + 32}" height="10" rx="4" fill="#dfe6f0" stroke="#aab6c8" stroke-width="0.8"/>`;
      s += `<rect x="${x0 - 16}" y="${sy + 10}" width="${fw + 32}" height="4" rx="2" fill="#b9c5d6"/>`;
    }

    // размеры
    const dim = '#8fa6cc';
    s += `<g font-family="Manrope, sans-serif" font-size="14.5" font-weight="700" fill="${dim}">
      <line x1="${x0}" y1="${y1 + 42}" x2="${x1}" y2="${y1 + 42}" stroke="${dim}" stroke-width="1.4" marker-start="url(#arrS)" marker-end="url(#arrE)"/>
      <line x1="${x0}" y1="${y1 + 36}" x2="${x0}" y2="${y1 + 48}" stroke="${dim}" stroke-width="1.4"/>
      <line x1="${x1}" y1="${y1 + 36}" x2="${x1}" y2="${y1 + 48}" stroke="${dim}" stroke-width="1.4"/>
      <text x="${(x0 + x1) / 2}" y="${y1 + 38}" text-anchor="middle">${state.w} мм</text>
      <line x1="${x1 + 40}" y1="${y0}" x2="${x1 + 40}" y2="${y1}" stroke="${dim}" stroke-width="1.4"/>
      <line x1="${x1 + 34}" y1="${y0}" x2="${x1 + 46}" y2="${y0}" stroke="${dim}" stroke-width="1.4"/>
      <line x1="${x1 + 34}" y1="${y1}" x2="${x1 + 46}" y2="${y1}" stroke="${dim}" stroke-width="1.4"/>
      <text x="${x1 + 55}" y="${(y0 + y1) / 2}" text-anchor="middle" transform="rotate(90 ${x1 + 55} ${(y0 + y1) / 2})" dy="5">${state.h} мм</text>
    </g>`;

    s += `<defs>
      <marker id="arrS" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M4 0 L4 8" stroke="${dim}" stroke-width="1.6"/>
      </marker>
      <marker id="arrE" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M4 0 L4 8" stroke="${dim}" stroke-width="1.6"/>
      </marker>
    </defs>`;

    s += `</svg>`;
    return s;
  }

  // ------------------------------------------------------------- подсказка --
  function hintText(area) {
    const a = area.toFixed(2).replace('.', ',');
    let desc = 'стандартное окно';
    if (state.type === 'window') {
      desc = area < 1 ? 'маленькое окно — санузел или кладовка'
        : area < 2 ? 'стандартное окно в спальню или кухню'
        : area < 3 ? 'широкое окно в гостиную' : 'панорамное окно';
    } else if (state.type === 'balcony') desc = 'остекление балкона или лоджии';
    else if (state.type === 'door') desc = 'дверной проём';
    else desc = 'витрина или фасадная конструкция';
    elHint.textContent = `Площадь: ${a} м² — ${desc}`;
  }

  // ---------------------------------------------------------------- update --
  function render() {
    const c = calc();
    canvas.innerHTML = buildSVG();
    elPrice.textContent = fmt(c.total);
    elMonthly.textContent = fmt(c.monthly);
    hintText(c.area);

    const rows = [];
    rows.push([`Конструкция ${c.area.toFixed(2).replace('.', ',')} м²`, Math.round(c.frame)]);
    if (c.glazing) rows.push([GLASS[state.glass].label, Math.round(c.glazing)]);
    if (c.opening) rows.push(`Фурнитура (${OPEN[state.open].label})`, c.opening);
    if (c.colorAdd) rows.push(`Ламинация «${COLORS[state.color].name}»`, Math.round(c.colorAdd));
    if (c.extrasSum) rows.push('Комплектация', c.extrasSum);
    if (c.tintAdd) rows.push('Тонировка стёкол', Math.round(c.tintAdd));
    rows.push(['Монтаж и доставка', 'Включено']);
    elBreakdown.innerHTML = rows.map(r => `<li><span>${r[0]}</span><b>${typeof r[1] === 'number' ? fmt(r[1]) : r[1]}</b></li>`).join('');

    elWa.href = 'https://wa.me/77007272737?text=' + encodeURIComponent(
      `Здравствуйте! Собрал(а) в конфигураторе: ${summaryText()}. Хочу уточнить детали и записаться на замер.`
    );
    return c;
  }

  // ------------------------------------------------------- обработчики UI --
  function bindChoices(id, key, onExtra) {
    const wrap = $(id);
    if (!wrap) return;
    $$('.choice', wrap).forEach(btn => btn.addEventListener('click', () => {
      $$('.choice', wrap).forEach(b => b.classList.toggle('active', b === btn));
      state[key] = btn.dataset.value;
      if (onExtra) onExtra(btn.dataset.value);
      render();
    }));
  }
  bindChoices('#confType', 'type', (type) => {
    const t = TYPES[type];
    state.w = t.w; state.h = t.h;
    elW.value = t.w; elH.value = t.h;
    elW.min = t.minW; elW.max = t.maxW; elH.min = t.minH; elH.max = t.maxH;
    // витрина — алюминий: блок профиля неактуален
    const profWrap = $('#confProfile');
    profWrap.style.opacity = type === 'vitrage' ? '.45' : '1';
    profWrap.style.pointerEvents = type === 'vitrage' ? 'none' : '';
    if (type === 'door') {
      state.open = 'turn';
      $$('#confOpen .choice').forEach(b => b.classList.toggle('active', b.dataset.value === 'turn'));
    }
  });
  bindChoices('#confProfile', 'profile');
  bindChoices('#confGlass', 'glass');
  bindChoices('#confOpen', 'open');

  $$('#confColor .swatch').forEach(btn => btn.addEventListener('click', () => {
    $$('#confColor .swatch').forEach(b => b.classList.toggle('active', b === btn));
    state.color = btn.dataset.value;
    render();
  }));

  $$('#confExtras .check input').forEach(inp => inp.addEventListener('change', () => {
    inp.checked ? state.extras.add(inp.value) : state.extras.delete(inp.value);
    render();
  }));

  function clampDims() {
    const t = TYPES[state.type];
    state.w = Math.max(t.minW, Math.min(t.maxW, Math.round(state.w / 50) * 50));
    state.h = Math.max(t.minH, Math.min(t.maxH, Math.round(state.h / 50) * 50));
    elW.value = state.w; elH.value = state.h;
  }
  elW?.addEventListener('change', () => { state.w = Number(elW.value) || state.w; clampDims(); render(); });
  elH?.addEventListener('change', () => { state.h = Number(elH.value) || state.h; clampDims(); render(); });
  elW?.addEventListener('input', () => { const v = Number(elW.value); if (v >= 200) { state.w = v; render(); } });
  elH?.addEventListener('input', () => { const v = Number(elH.value); if (v >= 200) { state.h = v; render(); } });

  $$('[data-step-target]').forEach(btn => btn.addEventListener('click', () => {
    const input = $('#' + btn.dataset.stepTarget);
    if (!input) return;
    const step = Number(btn.dataset.step) || 0;
    const key = btn.dataset.stepTarget === 'confW' ? 'w' : 'h';
    state[key] = (state[key] || 0) + step;
    clampDims();
    render();
  }));

  // пресеты из карточек услуг
  $$('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    const wrap = $('#confType');
    if (!wrap || !TYPES[preset]) return;
    $$('.choice', wrap).forEach(b => b.classList.toggle('active', b.dataset.value === preset));
    state.type = preset;
    const t = TYPES[preset];
    state.w = t.w; state.h = t.h;
    elW.value = t.w; elH.value = t.h;
    elW.min = t.minW; elW.max = t.maxW; elH.min = t.minH; elH.max = t.maxH;
    const profWrap = $('#confProfile');
    profWrap.style.opacity = preset === 'vitrage' ? '.45' : '1';
    profWrap.style.pointerEvents = preset === 'vitrage' ? 'none' : '';
    render();
    const target = btn.dataset.scroll;
    if (target) document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
  }));

  // -------------------------------------------------------------- смета ----
  function printQuote() {
    const c = calc();
    const profile = state.type === 'vitrage' ? 'алюминий' : PROFILES[state.profile];
    const extras = [...state.extras].map(k => EXTRAS[k]?.label).filter(Boolean);
    const rowsHtml = [...elBreakdown.querySelectorAll('li')].map(li =>
      `<tr><td>${li.querySelector('span')?.textContent || ''}</td><td>${li.querySelector('b')?.textContent || ''}</td></tr>`
    ).join('');
    const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const win = window.open('', '_blank', 'width=760,height=920');
    if (!win) { window.SP.toast('Разрешите всплывающие окна, чтобы скачать смету'); return; }
    win.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Смета — Систем Пласт</title>
    <style>
      *{box-sizing:border-box} body{font-family:'Segoe UI',Arial,sans-serif;color:#101826;margin:0;padding:44px;line-height:1.55}
      h1{font-size:22px;margin:0} .muted{color:#66738a;font-size:13px}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2f6bff;padding-bottom:18px;margin-bottom:24px}
      .logo{font-weight:800;font-size:15px;letter-spacing:.4px;color:#2f6bff}
      table{width:100%;border-collapse:collapse;margin:18px 0}
      td{padding:9px 6px;border-bottom:1px solid #e6eaf2;font-size:14px}
      td:last-child{text-align:right;font-weight:700}
      .total td{border-bottom:none;font-size:17px;padding-top:16px;font-weight:800}
      .total td:last-child{color:#2f6bff;font-size:20px}
      .badge{display:inline-block;background:#eef4ff;color:#2f6bff;border-radius:999px;padding:5px 14px;font-size:12.5px;font-weight:700;margin-top:4px}
      .note{font-size:12px;color:#66738a;margin-top:22px;border-top:1px dashed #c9d3e3;padding-top:14px}
      @media print{body{padding:20px}.noprint{display:none}}
    </style></head><body>
      <div class="head">
        <div><h1>Предварительная смета</h1><div class="muted">г. Караганда, ул. Волгодонская 118/1 · +7 700 727 27 37 · WhatsApp · @sistem_plast</div></div>
        <div style="text-align:right"><div class="logo">СИСТЕМ ПЛАСТ</div><div class="muted">${date}</div></div>
      </div>
      <p><strong>${TYPES[state.type].label}</strong>, профиль ${profile}, размер ${state.w}×${state.h} мм<br>
      <span class="muted">${GLASS[state.glass].label} · открывание: ${OPEN[state.open].label}${extras.length ? ' · ' + extras.join(', ') : ''}</span></p>
      <table>${rowsHtml}
        <tr class="total"><td>Итого «под ключ»</td><td>${fmt(c.total)}</td></tr>
      </table>
      <span class="badge">Рассрочка 0-0-24: ${fmt(c.monthly)} × 24 месяца без переплаты</span>
      <div class="note">В стоимость включены: бесплатный замер, доставка по Караганде, монтаж и уборка после работ.
      Смета предварительная и фиксируется после бесплатного замера инженером — итоговая цена не увеличивается.
      ТОО «Систем Пласт», БИН 030840011782. Работаем с 2003 года.</div>
      <p class="noprint" style="margin-top:26px"><button onclick="window.print()" style="padding:12px 26px;border-radius:999px;border:none;background:#2f6bff;color:#fff;font-weight:700;font-size:15px;cursor:pointer">Печать / сохранить в PDF</button></p>
      <script>setTimeout(()=>window.print(),400)<\/script>
    </body></html>`);
    win.document.close();
  }

  $('#confPrint')?.addEventListener('click', printQuote);

  $('#confSubmit')?.addEventListener('click', () => {
    const c = calc();
    const summary = summaryText();
    window.SP.openLeadModal({
      source: 'configurator',
      sourceLabel: 'Конфигуратор окон',
      title: 'Отправить смету и записаться на замер?',
      sub: `Ваша конфигурация: ${summary}. Оставьте контакты — проверим расчёт и согласуем удобное время замера.`,
      price: c.total,
      configSummary: summary,
      config: {
        type: state.type, w: state.w, h: state.h, profile: state.profile,
        glass: state.glass, open: state.open, color: state.color, extras: [...state.extras],
      },
      waText: `Здравствуйте! Конфигуратор: ${summary}. Хочу записаться на бесплатный замер.`,
    });
  });

  // первый рендер
  render();
})();
