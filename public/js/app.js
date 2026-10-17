/* ============================================================================
   Систем Пласт — основной скрипт сайта
   Общая логика: анимации, слайдер отзывов, портфолио, модалка заявок,
   отправка лидов на сервер (с UTM-метками).
   ============================================================================ */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ------------------------------------------------------------------ UTM --
  const UTM = (() => {
    const params = new URLSearchParams(location.search);
    const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem('sp_utm') || '{}') || {}; } catch { stored = {}; }
    keys.forEach(k => { if (params.get(k)) stored[k] = params.get(k); });
    try { sessionStorage.setItem('sp_utm', JSON.stringify(stored)); } catch { /* приватный режим */ }
    return stored;
  })();

  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₸';

  // ---------------------------------------------------------------- toast --
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  // --------------------------------------------------------------- loader --
  const preloader = $('#preloader');
  function hideLoader() { if (preloader) preloader.classList.add('done'); }
  window.addEventListener('load', () => setTimeout(hideLoader, 350));
  setTimeout(hideLoader, 2600); // страховка

  // ------------------------------------------------------- scroll progress --
  const progress = $('#scrollProgress');
  const header = $('#header');

  function onScroll() {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    const p = max > 0 ? (h.scrollTop / max) * 100 : 0;
    if (progress) progress.style.width = p + '%';
    if (header) header.classList.toggle('scrolled', h.scrollTop > 40);
  }
  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ------------------------------------------------------------ mobile nav --
  const burger = $('#burger');
  const nav = $('#nav');
  function closeNav() {
    if (!nav?.classList.contains('open')) return;
    nav.classList.remove('open');
    burger?.setAttribute('aria-expanded', 'false');
    if (!document.body.dataset.chatLock) document.body.classList.remove('no-scroll');
  }
  if (burger && nav) {
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('no-scroll', open);
    });
    $$('a', nav).forEach(a => a.addEventListener('click', closeNav));
    window.addEventListener('resize', () => { if (window.innerWidth > 1080) closeNav(); });
  }

  // --------------------------------------------------------------- reveal --
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const siblings = el.parentElement ? Array.from(el.parentElement.children).filter(c => c.classList.contains('reveal')) : [];
        const idx = siblings.indexOf(el);
        const delay = idx > 0 ? Math.min(idx * 90, 450) : 0;
        el.style.transitionDelay = delay + 'ms';
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach(el => io.observe(el));

    // ------------------------------------------------------------- counters --
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const target = Number(el.dataset.count || 0);
        const dur = 1500;
        const t0 = performance.now();
        function tick(t) {
          const p = Math.min(1, (t - t0) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * eased).toLocaleString('ru-RU');
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        cio.unobserve(el);
      });
    }, { threshold: 0.6 });
    $$('.count').forEach(el => cio.observe(el));
  } else {
    // старые браузеры без IntersectionObserver: показываем всё сразу, без анимаций
    $$('.reveal').forEach(el => el.classList.add('in'));
    $$('.count').forEach(el => { el.textContent = Number(el.dataset.count || 0).toLocaleString('ru-RU'); });
  }

  // ------------------------------------------------------- reviews slider --
  const track = $('#reviewsTrack');
  if (track) {
    const slides = $$('.review', track);
    const dotsWrap = $('#revDots');
    let index = 0;

    function visibleCount() {
      const first = slides[0];
      if (!first) return 1;
      const slideW = first.getBoundingClientRect().width + 20;
      return Math.max(1, Math.floor((track.parentElement.getBoundingClientRect().width + 20) / slideW));
    }
    function maxIndex() { return Math.max(0, slides.length - visibleCount()); }
    function render() {
      index = Math.max(0, Math.min(index, maxIndex()));
      const first = slides[0];
      const slideW = first.getBoundingClientRect().width + 20;
      track.style.transform = `translateX(${-index * slideW}px)`;
      if (dotsWrap) $$('button', dotsWrap).forEach((d, i) => d.classList.toggle('active', i === index));
    }
    function buildDots() {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = '';
      for (let i = 0; i <= maxIndex(); i++) {
        const b = document.createElement('button');
        b.setAttribute('aria-label', 'Отзыв ' + (i + 1));
        b.addEventListener('click', () => { index = i; render(); });
        dotsWrap.appendChild(b);
      }
      render();
    }
    $('#revPrev')?.addEventListener('click', () => { index = index <= 0 ? maxIndex() : index - 1; render(); });
    $('#revNext')?.addEventListener('click', () => { index = index >= maxIndex() ? 0 : index + 1; render(); });

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const advance = () => { index = index >= maxIndex() ? 0 : index + 1; render(); };
    let auto = reduceMotion ? null : setInterval(advance, 6500);
    const slider = $('#reviewsSlider');
    slider?.addEventListener('mouseenter', () => { clearInterval(auto); auto = null; });
    slider?.addEventListener('mouseleave', () => { if (!reduceMotion && !auto) auto = setInterval(advance, 6500); });

    // свайп
    let startX = null;
    track.addEventListener('pointerdown', (e) => { startX = e.clientX; });
    track.addEventListener('pointerup', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 45) { dx < 0 ? index++ : index--; render(); }
      startX = null;
    });

    window.addEventListener('resize', () => buildDots());
    buildDots();
  }

  // ----------------------------------------------------- works: фильтры ---
  const filters = $('#worksFilters');
  if (filters) {
    $$('.chip-btn', filters).forEach(btn => btn.addEventListener('click', () => {
      $$('.chip-btn', filters).forEach(b => b.classList.toggle('active', b === btn));
      const f = btn.dataset.filter;
      $$('#worksGrid .work').forEach(w => {
        const show = f === 'all' || w.dataset.cat === f;
        w.classList.toggle('hidden', !show);
      });
    }));
  }

  // ------------------------------------------------------------ lightbox --
  const lightbox = $('#lightbox');
  function openLightbox(w) {
    const img = $('img', w);
    if (!img) return;
    $('#lightboxImg').src = img.currentSrc || img.src;
    $('#lightboxImg').alt = img.alt;
    $('#lightboxTitle').textContent = w.dataset.title || '';
    lightbox._opener = w;
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    setTimeout(() => $('.lightbox__close', lightbox)?.focus(), 60);
  }
  $$('#worksGrid .work').forEach(w => {
    w.setAttribute('tabindex', '0');
    w.setAttribute('role', 'button');
    const img = $('img', w);
    const cap = $('figcaption', w);
    const capText = cap ? [...cap.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ') : '';
    const altText = img && img.alt ? img.alt.trim() : '';
    const nameText = [altText, capText].filter(Boolean).join('. ');
    w.setAttribute('aria-label', 'Открыть фото: ' + (nameText || w.dataset.title || 'наша работа'));
    w.addEventListener('click', () => openLightbox(w));
    w.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(w); }
    });
  });
  function closeLightbox() {
    if (!lightbox?.classList.contains('open')) return;
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    if (!document.body.dataset.chatLock) document.body.classList.remove('no-scroll');
    if (lightbox._opener && document.contains(lightbox._opener)) setTimeout(() => lightbox._opener.focus({ preventScroll: true }), 0);
  }
  lightbox?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); $('.lightbox__close', lightbox)?.focus(); }
  });

  // ---------------------------------------------------------- телефонная --
  function maskPhone(input) {
    input.addEventListener('input', () => {
      let d = input.value.replace(/\D/g, '');
      if (!d) { input.value = ''; return; }
      if (d[0] === '8') d = '7' + d.slice(1);
      if (d[0] !== '7') d = '7' + d;
      d = d.slice(0, 11);
      let out = '+7';
      if (d.length > 1) out += ' (' + d.slice(1, 4);
      if (d.length >= 5) out += ') ' + d.slice(4, 7);
      if (d.length >= 8) out += '-' + d.slice(7, 9);
      if (d.length >= 10) out += '-' + d.slice(9, 11);
      input.value = out;
    });
  }
  const phoneInputs = [$('#leadPhone')].filter(Boolean);
  phoneInputs.forEach(maskPhone);

  // ------------------------------------------------------------ lead modal --
  const modal = $('#leadModal');
  const form = $('#leadForm');
  const formState = $('#leadFormState');
  const doneState = $('#leadDoneState');
  let modalMeta = { source: 'site', sourceLabel: 'Сайт', title: 'Бесплатный замер', price: 0, configSummary: '', waText: '' };

  function openLeadModal(meta = {}) {
    modal._opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalMeta = { ...modalMeta, ...meta };
    $('#leadModalTitle').textContent = modalMeta.title || 'Бесплатный замер';
    $('#leadModalSub').textContent = meta.sub || 'Оставьте контакты — перезвоним в течение 15 минут, ответим на вопросы и запишем инженера на удобное время.';
    formState.hidden = false;
    doneState.hidden = true;
    $('#leadInlineNote').textContent = '';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    setTimeout(() => $('#leadName')?.focus(), 350);
  }
  function closeLeadModal() {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.body.dataset.chatLock) document.body.classList.remove('no-scroll');
    if (modal._opener && document.contains(modal._opener)) setTimeout(() => modal._opener.focus({ preventScroll: true }), 0);
  }

  $$('[data-open-lead]').forEach(btn => btn.addEventListener('click', () => openLeadModal({
    source: btn.dataset.source || 'site',
    sourceLabel: btn.dataset.sourceLabel || 'Сайт',
    title: btn.dataset.title || 'Бесплатный замер',
  })));
  $$('[data-close-modal]', modal).forEach(el => el.addEventListener('click', closeLeadModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeLeadModal(); closeLightbox(); closeNav(); }
  });

  // ловушка фокуса внутри модального окна заявки
  modal?.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !modal.classList.contains('open')) return;
    const focusables = $$('a[href], button:not([disabled]), input:not([type="hidden"]), textarea, [tabindex]:not([tabindex="-1"])', modal)
      .filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ----------------------------------------------------- отправка заявки ---
  async function submitLead(payload, { btn, noteEl } = {}) {
    const span = btn?.querySelector('span');
    const original = span ? span.textContent : null;
    if (btn) { btn.disabled = true; if (span) span.textContent = 'Отправляем…'; }
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, utm: UTM, page: location.pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось отправить. Попробуйте ещё раз.');
      return { ok: true, data };
    } catch (e) {
      const msg = (e instanceof TypeError)
        ? 'Нет соединения. Проверьте интернет или позвоните: +7 700 727 27 37'
        : (e.message || 'Не удалось отправить. Попробуйте ещё раз.');
      if (noteEl) noteEl.textContent = msg;
      toast('⚠️ ' + msg);
      return { ok: false, error: msg };
    } finally {
      if (btn) { btn.disabled = false; if (span) span.textContent = original; }
    }
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#leadSubmit').disabled) return; // защита от повторной отправки
    const name = $('#leadName').value.trim();
    const phone = $('#leadPhone').value.trim();
    const note = $('#leadInlineNote');
    const consent = $('#leadConsent').checked;

    $('#leadPhone').classList.remove('error');
    $('#leadName').classList.remove('error');
    if (name.length < 2) { note.textContent = 'Пожалуйста, укажите имя.'; $('#leadName').classList.add('error'); $('#leadName').focus(); return; }
    if (phone.replace(/\D/g, '').length < 11) { note.textContent = 'Проверьте номер телефона.'; $('#leadPhone').classList.add('error'); $('#leadPhone').focus(); return; }
    if (!consent) { note.textContent = 'Нужно согласие на обработку данных.'; return; }

    const { ok } = await submitLead({
      name,
      phone,
      message: $('#leadMessage').value.trim(),
      source: modalMeta.source,
      sourceLabel: modalMeta.sourceLabel,
      price: modalMeta.price || 0,
      configSummary: modalMeta.configSummary || '',
      config: modalMeta.config || null,
    }, { btn: $('#leadSubmit'), noteEl: note });

    if (ok) {
      formState.hidden = true;
      doneState.hidden = false;
      const waText = modalMeta.waText || `Здравствуйте! Оставлял(а) заявку на сайте (${modalMeta.sourceLabel}). Меня зовут ${name}.`;
      $('#leadDoneWa').href = 'https://wa.me/77007272737?text=' + encodeURIComponent(waText);
      form.reset();
      $('#leadConsent').checked = true;
    }
  });

  // публичный API для других скриптов
  window.SP = { submitLead, openLeadModal, closeLeadModal, toast, fmt, UTM, $, $$ };
})();
