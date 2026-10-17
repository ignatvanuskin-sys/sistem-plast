/* ============================================================================
   Систем Пласт — онлайн-консультант «Айя»
   Правиловый бот: цены, сроки, гарантия, рассрочка, замер + захват лидов.
   ============================================================================ */
(function () {
  'use strict';
  const { $, $$, submitLead, toast } = window.SP;

  const chat = $('#chat');
  const body = $('#chatBody');
  const quick = $('#chatQuick');
  const form = $('#chatForm');
  const input = $('#chatInput');
  if (!chat) return;

  const transcript = [];
  let mode = 'idle';           // idle | await_phone
  let greeted = false;
  let leadSaved = false;

  // ------------------------------------------------------------- утилиты ---
  function scrollDown() { body.scrollTop = body.scrollHeight + 120; }

  function botSay(html, { delay = 500, quickReplies = null } = {}) {
    const typing = document.createElement('div');
    typing.className = 'msg msg--bot msg--typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(typing);
    scrollDown();
    setTimeout(() => {
      typing.remove();
      const msg = document.createElement('div');
      msg.className = 'msg msg--bot';
      msg.innerHTML = html;
      body.appendChild(msg);
      transcript.push('Бот: ' + msg.textContent);
      if (quickReplies) renderQuick(quickReplies);
      scrollDown();
    }, delay + Math.min(900, html.length * 4));
  }

  function userSay(text) {
    const msg = document.createElement('div');
    msg.className = 'msg msg--user';
    msg.textContent = text;
    body.appendChild(msg);
    transcript.push('Клиент: ' + text);
    scrollDown();
  }

  function renderQuick(items) {
    quick.innerHTML = '';
    items.forEach((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label || item;
      b.addEventListener('click', () => {
        quick.innerHTML = '';
        if (item.action === 'scroll') {
          document.getElementById(item.target)?.scrollIntoView({ behavior: 'smooth' });
          closeChat();
          return;
        }
        if (item.action === 'link') {
          window.open(item.href, '_blank', 'noopener');
          return;
        }
        if (item.action === 'lead') {
          userSay(item.label || 'Хочу записаться на замер');
          mode = 'await_phone';
          botSay(`Отлично! 📏 Оставьте ваш номер телефона прямо здесь — перезвоним в течение 15 минут (Пн–Сб, 9:00–18:00) и согласуем удобное время.<br><br>Или позвоните сами: <a href="tel:+77007272737">+7 700 727 27 37</a>`);
          return;
        }
        handle(item.label || item);
      });
      quick.appendChild(b);
    });
  }

  const DEFAULT_QUICK = [
    { label: '💰 Рассчитать окно' },
    { label: '⏱ Сроки изготовления' },
    { label: '🛡 Гарантия' },
    { label: '💳 Рассрочка' },
    { label: '📏 Бесплатный замер', action: 'lead' },
    { label: '👋 Позвать менеджера', action: 'lead' },
  ];

  // ---------------------------------------------------------------- интенты --
  const PRICES = { kbe: 24000, veka: 27000, rehau: 31000 };

  function estimateFromDims(w, h) {
    const area = Math.max(0.45, (w * h) / 1e6);
    const raw = area * (PRICES.kbe + 2800) + 9500; // KBE, 2 камеры, поворотно-откидное
    const total = Math.round(raw / 500) * 500;
    const lo = Math.round(total * 0.92 / 500) * 500;
    const hi = Math.round(total * 1.08 / 500) * 500;
    return { total, lo, hi };
  }

  // телефон ищем структурно: фрагмент из 10–11 цифр, а не «просто ≥10 цифр в тексте»,
  // чтобы суммы и размеры (например, «12500 тг за 1300x1400») не превращались в лид
  function extractPhone(text) {
    const candidates = String(text).match(/(?:\+?\d[\d\s\-()]{6,16}\d)/g) || [];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const d = candidates[i].replace(/\D/g, '');
      if (d.length < 10 || d.length > 11) continue;
      if (d.length === 11 && d[0] !== '7' && d[0] !== '8') continue;
      return '+7' + d.slice(-10);
    }
    return null;
  }

  const intents = [
    {
      re: /(цена|цену|стоимость|сколько\s+стоит|сколько\s+будет|посчитай|рассчит|смета|прайс)/i,
      reply: () => `С удовольствием посчитаю! 🧮<br><br>Напишите размер в формате <strong>ширина x высота</strong> в мм — например, <strong>1300x1400</strong> — и я назову цену с монтажом «под ключ».<br><br>Или соберите окно в <strong>конфигураторе</strong> — там живой предпросмотр и точный расчёт за 40 секунд.`,
      quick: [
        { label: '🧮 Открыть конфигуратор', action: 'scroll', target: 'configurator' },
        { label: '📏 Вызвать замерщика', action: 'lead' },
      ],
    },
    {
      re: /(срок|сколько\s+ждать|когда\s+будут|изготовлен|быстро)/i,
      reply: () => `<strong>Изготовление — 3–7 рабочих дней</strong> с момента замера и договора. ⏱<br><br>Монтаж занимает один день, и сразу после него окнами можно пользоваться. В сезон летних заказов срок может сдвигаться — но точную дату мы фиксируем в договоре, и привозим вовремя.`,
      quick: [{ label: '📏 Бесплатный замер', action: 'lead' }, { label: '💰 Рассчитать окно' }],
    },
    {
      re: /(гаранти|качеств|надёжн|надежн|сломал|брак)/i,
      reply: () => `Даём <strong>гарантию до 10 лет по договору</strong> 🛡 — на профиль, стеклопакет, фурнитуру и монтаж.<br><br>Если что-то перестанет работать правильно — позвоните, приедем и отрегулируем бесплатно. За 23 года мы дорожим репутацией: рейтинг <strong>5,0 на 2ГИС</strong> из 12 оценок — все настоящие.`,
      quick: [{ label: '⭐ Отзывы на 2ГИС', action: 'link', href: 'https://2gis.kz/karaganda/firm/70000001062342075/tab/reviews' }, { label: '📏 Бесплатный замер', action: 'lead' }],
    },
    {
      re: /(рассрочк|кредит|частями|оплат|оплата|kaspi|каспи)/i,
      reply: () => `Конечно! <strong>Рассрочка 0-0-24</strong>: без первого взноса и без переплаты. 💳<br><br>Оформляется за 15 минут прямо на замере — нужен только удостоверение личности. Итоговая сумма делится на 24 месяца, например 5 000 ₸/мес за простое окно.`,
      quick: [{ label: '💰 Рассчитать окно' }, { label: '📏 Бесплатный замер', action: 'lead' }],
    },
    {
      re: /(замер|приед|выезд|записаться|запись)/i,
      reply: () => `Замер <strong>бесплатный</strong> по Караганде и пригороду, без обязательств. 📏<br><br>Инженер приедет в удобное время, привезёт образцы профилей и назовёт точную смету на месте. Оставьте ваш номер телефона — и я передам его менеджеру!`,
      mode: 'await_phone',
      quick: [{ label: '📞 Перезвоните мне', action: 'lead' }],
    },
    {
      re: /(менеджер|позов|позвать|человек|специалист|соедин|позвон|звонок|telefon|телефон)/i,
      reply: () => `Конечно! Передам вашу заявку менеджеру — он перезвонит <strong>в течение 15 минут</strong> (в рабочее время Пн–Сб с 9:00 до 18:00). 📞<br><br>Напишите номер телефона прямо сюда — или позвоните сами: <a href="tel:+77007272737">+7 700 727 27 37</a>`,
      mode: 'await_phone',
      quick: [{ label: '📞 Перезвоните мне', action: 'lead' }],
    },
    {
      re: /(адрес|где\s+вы|где\s+находит|офис|салон|зал|как\s+добрат|маршрут)/i,
      reply: () => `Наш салон: <strong>Караганда, ул. Волгодонская 118/1</strong> (м-н «Новый город», 1 этаж). 📍<br><br>Работаем <strong>Пн–Сб с 9:00 до 18:00</strong>. Приезжайте — покажем профили в разрезе и посчитаем заказ на месте.<br><a href="https://2gis.kz/karaganda/directions/points/%7C73.10655%2C49.831818%3B70000001062342075" target="_blank" rel="noopener">Построить маршрут в 2ГИС →</a>`,
      quick: [{ label: '🗺 Маршрут в 2ГИС', action: 'link', href: 'https://2gis.kz/karaganda/directions/points/%7C73.10655%2C49.831818%3B70000001062342075' }, { label: '📏 Бесплатный замер', action: 'lead' }],
    },
    {
      re: /(график|часы|работаете|открыт|выходн|воскресен|режим)/i,
      reply: () => `Мы работаем <strong>Пн–Сб с 9:00 до 18:00</strong>. В воскресенье — по договорённости (например, монтаж или замер на объекте). 🕘<br><br>Сейчас за окном: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — самое время оставить заявку, перезвоним в рабочее время!`,
      quick: [{ label: '📏 Бесплатный замер', action: 'lead' }, { label: '💰 Рассчитать окно' }],
    },
    {
      re: /(профил|kbe|кбе|veka|века|rehau|рехау|salamander|саламандр)/i,
      reply: () => `Работаем с проверенными профилями: 🪟<br><br>• <strong>KBE</strong> — оптимум цены и качества, наш бестселлер<br>• <strong>VEKA</strong> — немецкая классика, отличная геометрия<br>• <strong>REHAU</strong> — максимум тепла для суровых зим<br>• <strong>Salamander</strong> — премиум, до 7 камер<br><br>Все — с несколькими контурами уплотнения и энергосберегающими стеклопакетами. Показать цены?`,
      quick: [{ label: '💰 Рассчитать окно' }, { label: '📏 Бесплатный замер', action: 'lead' }],
    },
    {
      re: /(сетк|москит|подоконник|отлив|откос|жалюзи|ролет|роллет|ремонт|регулиров)/i,
      reply: () => `Да, всё это делаем! 🛠<br><br>• Москитная сетка — от 8 500 ₸<br>• Подоконник ПВХ — от 7 000 ₸<br>• Отлив — от 4 500 ₸<br>• Детский замок — 5 500 ₸<br>• Ремонт и регулировка фурнитуры — от 5 000 ₸<br><br>Можем приехать и поставить аксессуары на уже установленные окна.`,
      quick: [{ label: '📏 Бесплатный замер', action: 'lead' }, { label: '💰 Рассчитать окно' }],
    },
    {
      re: /(юрлиц|организац|компани|тоо|безнал|счёт|счет|закупк|тендер|офис|школ|магазин)/i,
      reply: () => `С юрлицами работаем давно: безнал, счёт, акты и закрывающие документы, участвуем в госзакупках. 🏢<br><br>Остекляем офисы, магазины, школы и производственные помещения — замер и монтаж можем делать в выходные или в нерабочие смены.<br><br>Оставьте номер — коммерческий отдел свяжется и подготовит КП.`,
      mode: 'await_phone',
      quick: [{ label: '📞 Связаться со мной', action: 'lead' }],
    },
    {
      re: /(балкон|лоджи)/i,
      reply: () => `Остекление балконов — наша любовь! 🏙<br><br>Делаем тёплое остекление <strong>от 26 000 ₸/м²</strong> и холодное — от 21 000 ₸/м², с утеплением, отделкой и даже выносом — по нормам ЖКХ.<br><br>Стандартный балкон 3 м «под ключ» — примерно от 400 000 ₸. Напишите ваш размер (например, 3000x1500) — посчитаю точнее!`,
      quick: [{ label: '🧮 Открыть конфигуратор', action: 'scroll', target: 'configurator' }, { label: '📏 Бесплатный замер', action: 'lead' }],
    },
    {
      re: /(двер|входн)/i,
      reply: () => `Делаем двери ПВХ и алюминиевые: входные группы, балконные и межкомнатные. 🚪<br><br>Цена — <strong>от 38 000 ₸/м²</strong> с фурнитурой. Усиленные рамы, броненакладки, доводчики — всё под ключ с монтажом.`,
      quick: [{ label: '🧮 Посчитать дверь', action: 'scroll', target: 'configurator' }, { label: '📏 Бесплатный замер', action: 'lead' }],
    },
    {
      re: /(витраж|фасад|панорамн|остекление\s+дом|террас)/i,
      reply: () => `Витражи и фасадное остекление — <strong>от 36 000 ₸/м²</strong> с проектом и монтажом. 🏢<br><br>Работаем с частными домами, кафе, офисами и бизнес-центрами. Для проектов делаем выезд инженера с образцами.`,
      quick: [{ label: '🧮 Открыть конфигуратор', action: 'scroll', target: 'configurator' }, { label: '📞 Обсудить проект', action: 'lead' }],
    },
    {
      re: /(спасибо|спс|благодар|круто|супер|отлично)/i,
      reply: () => `Всегда рада помочь! 😊 Если появятся вопросы — я тут, пишите в любое время.<br><br>Хорошего дня! ☀️`,
      quick: DEFAULT_QUICK,
    },
    {
      re: /^(привет|здравствуй|добрый|салам|ассалам|hi|hello)/i,
      reply: () => `И вам здравствуйте! 👋 Чем могу помочь? Могу посчитать стоимость, рассказать про сроки и рассрочку — или записать вас на бесплатный замер.`,
      quick: DEFAULT_QUICK,
    },
  ];

  // ------------------------------------------------------------- обработка --
  function handle(text) {
    text = String(text || '').trim();
    if (!text) return;
    userSay(text);

    // Телефон в сообщении → лид
    const phone = extractPhone(text);
    if (phone) {
      saveChatLead(text, phone);
      return;
    }

    // Размеры: 1300x1400, 1.3x1.4, 3000 на 1500
    const m = text.match(/(\d{2,4}(?:[.,]\d)?)\s*(?:x|х|×|\*|на)\s*(\d{2,4}(?:[.,]\d)?)/i);
    if (m) {
      let w = Math.round(parseFloat(m[1].replace(',', '.')) || 0);
      let h = Math.round(parseFloat(m[2].replace(',', '.')) || 0);
      if (w < 10) w *= 1000;
      if (h < 10) h *= 1000;
      const sizes = [[w, h], [h, w]];
      const [W, H] = sizes.find(p => p[0] >= 400 && p[1] >= 400) || sizes[0];
      if (W >= 400 && H >= 400 && W <= 6500 && H <= 3500) {
        const { lo, hi, total } = estimateFromDims(W, H);
        const monthly = Math.round(total / 24);
        botSay(`Ориентир для окна <strong>${W}×${H} мм</strong> (KBE, двухкамерный стеклопакет, поворотно-откидное открывание):<br><br>💰 <strong>от ${lo.toLocaleString('ru-RU')} до ${hi.toLocaleString('ru-RU')} ₸</strong> «под ключ» с монтажом и доставкой.<br>💳 В рассрочку — около <strong>${monthly.toLocaleString('ru-RU')} ₸/мес</strong> × 24 месяца.<br><br>Точную цену зафиксирует замерщик — бесплатно. 😉`, {
          quickReplies: [
            { label: '🧮 Уточнить в конфигураторе', action: 'scroll', target: 'configurator' },
            { label: '📏 Записаться на замер', action: 'lead' },
          ],
        });
        return;
      }
    }

    for (const intent of intents) {
      if (intent.re.test(text)) {
        if (intent.mode) mode = intent.mode;
        const quickReplies = (intent.quick || DEFAULT_QUICK).map(q => {
          if (q.action === 'lead') return { ...q, action: 'lead' };
          return q;
        });
        botSay(intent.reply(), { quickReplies });
        return;
      }
    }

    // доп. сценарий: ждём телефон
    if (mode === 'await_phone') {
      botSay(`Похоже, в сообщении нет номера 🙂 Напишите телефон цифрами, например <strong>+7 700 727 27 37</strong> — перезвоним в течение 15 минут. Или позвоните сами: <a href="tel:+77007272737">+7 700 727 27 37</a>`);
      return;
    }

    botSay(`Хм, не уверена, что поняла 🤔 Я лучше всего разбираюсь в:<br>• расчёте стоимости окон и балконов<br>• сроках изготовления и монтажа<br>• гарантии и рассрочке 0-0-24<br><br>Спросите про это — или выберите кнопку ниже 👇`, { quickReplies: DEFAULT_QUICK });
  }

  async function saveChatLead(phoneText, phone) {
    if (leadSaved) {
      botSay('Кажется, ваша заявка уже у меня — менеджер скоро перезвонит! 📞');
      return;
    }
    leadSaved = true;
    mode = 'idle';
    botSay('Приняла! ✅ Записываю вашу заявку менеджеру…', { delay: 300 });
    const res = await submitLead({
      name: 'Клиент из чата',
      phone,
      message: 'Чат: клиент оставил номер. Последние сообщения:\n' + transcript.slice(-6).join('\n'),
      source: 'chat',
      sourceLabel: 'Онлайн-чат на сайте',
    });
    if (res.ok) {
      botSay(`Готово! 🎉 Менеджер <strong>«Систем Пласт»</strong> перезвонит в течение 15 минут в рабочее время.<br><br>А пока можете посмотреть наши работы в <a href="https://www.instagram.com/sistem_plast/" target="_blank" rel="noopener">Instagram</a> — 63 фото на 2ГИС не врут 😊`, {
        quickReplies: [{ label: '🧮 Рассчитать окно', action: 'scroll', target: 'configurator' }],
      });
    } else {
      leadSaved = false;
      botSay('Ой, не получилось отправить заявку с сайта 😔 Позвоните, пожалуйста: <a href="tel:+77007272737">+7 700 727 27 37</a>');
    }
  }

  // --------------------------------------------------------- окно чата ------
  function openChat() {
    chat.classList.add('open');
    chat.setAttribute('aria-hidden', 'false');
    $('.chat-float__dot')?.remove();
    // блокируем прокрутку страницы только на мобильных, где чат развёрнут почти на весь экран
    if (window.matchMedia('(max-width: 720px)').matches) {
      document.body.classList.add('no-scroll');
      document.body.dataset.chatLock = '1';
    }
    setTimeout(() => input.focus(), 380);
    if (!greeted) {
      greeted = true;
      botSay('Здравствуйте! 👋 Меня зовут <strong>Айя</strong>, я консультант «Систем Пласт».', { delay: 400 });
      botSay('Могу рассчитать стоимость, рассказать про сроки, гарантию и рассрочку — или записать вас на <strong>бесплатный замер</strong>. Что вас интересует?', { delay: 1300, quickReplies: DEFAULT_QUICK });
    }
  }
  function closeChat() {
    if (!chat.classList.contains('open')) return;
    chat.classList.remove('open');
    chat.setAttribute('aria-hidden', 'true');
    if (document.body.dataset.chatLock) {
      document.body.classList.remove('no-scroll');
      delete document.body.dataset.chatLock;
    }
    $('#chatOpen')?.focus({ preventScroll: true });
  }

  $('#chatOpen')?.addEventListener('click', openChat);
  $('#chatClose')?.addEventListener('click', closeChat);
  $$('[data-open-chat]').forEach(btn => btn.addEventListener('click', openChat));

  // Esc: сначала закрывается модалка заявки (app.js), затем чат
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !chat.classList.contains('open')) return;
    if (document.querySelector('#leadModal.open')) return;
    closeChat();
  }, true);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    quick.innerHTML = '';
    handle(text);
  });
})();
