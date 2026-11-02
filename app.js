(function () {
  'use strict';

  var POEMS = window.POEMS || [];
  var SITE = window.SITE || {};
  var app = document.getElementById('app');
  // шумақ санын шектеу
  (function () {
    var mx = SITE.maxStanzas;
    if (!mx) return;
    POEMS.forEach(function (p) {
      if (!p.stanzas || p.stanzas.length <= mx) return;
      p.stanzas = p.stanzas.slice(0, mx);
      var txt = p.stanzas.map(function (s) { return s.lines.map(function (l) { return l.text + ' ' + l.kw; }).join(' '); }).join(' ').toLowerCase();
      p.vocab = (p.vocab || []).filter(function (v) { return txt.indexOf(v.w.toLowerCase().slice(0, 4)) >= 0; });
      p.note = 'Өлеңнің алғашқы ' + mx + ' шумағы. Мәтінді оқулықпен салыстырыңыз.';
    });
  })();
  var TABS = [
    { id: 'listen', ic: '🎧', t: 'Тыңда' },
    { id: 'understand', ic: '📖', t: 'Түсін' },
    { id: 'draw', ic: '🎨', t: 'Сал' },
    { id: 'speak', ic: '🎭', t: 'Айт' },
    { id: 'voice', ic: '🎤', t: 'Дауыс' },
    { id: 'check', ic: '✅', t: 'Тексер' }
  ];

  /* ---------- сақтау ---------- */
  var KEY = 'ak_sozbensezim_v2';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ештеңе */ } }
  var store = load();
  store.visited = store.visited || {};
  store.attempts = store.attempts || {};
  store.started = store.started || {};
  store.repeats = store.repeats || {};

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function poemById(id) { for (var i = 0; i < POEMS.length; i++) if (POEMS[i].id === id) return POEMS[i]; return null; }
  function allLines(p) {
    var out = [];
    p.stanzas.forEach(function (s, si) { s.lines.forEach(function (l) { out.push({ l: l, si: si }); }); });
    return out;
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function markVisited(pid, tab) {
    store.visited[pid] = store.visited[pid] || {};
    if (!store.visited[pid][tab]) { store.visited[pid][tab] = true; save(); }
  }

  /* ---------- күй ---------- */
  var localRef = {};     // мұғалім таңдаған үлгі файл: { pid: {url, buffer} }
  var refCache = {};     // жүктелген үлгі аудио буфері
  var onLira = false;
  var V = null;          // жазу күйі
  var quiz = null;       // ойын күйі
  var drawState = { color: '#2f4a35', size: 4 };
  var actx = null;
  function getCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended' && actx.resume) actx.resume();
    return actx;
  }

  /* ---------- бағыттау ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-lirasay]');
    if (t && window.Lira) window.Lira.say(t.getAttribute('data-lirasay'));
  });

  function route() {
    stopRecordingSilently();
    if (window.Lira) window.Lira.stop();
    document.body.classList.remove('menu');
    var h = (location.hash || '#/').replace(/^#\/?/, '').split('/');
    if (h[0] === 'lira' && window.Lira) { onLira = true; app.innerHTML = shell(window.Lira.pageHtml(), null); window.Lira.init(); onLira = false; }
    else if (h[0] === 'p' && poemById(h[1]) && !poemById(h[1]).pending) renderPoem(poemById(h[1]));
    else renderHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ---------- иллюстрациялар (SVG пейзаж) ---------- */
  var THEMES = {
    steppe:  { sky: ['#f6d58e', '#f1b56a'], sun: 1, hills: ['#a9b36a', '#7f9140', '#4f6b34'], label: 'Дала' },
    night:   { sky: ['#1d2d4a', '#3b4f6e'], moon: 1, stars: 1, hills: ['#30493f', '#243a31', '#1a2c25'], label: 'Түн' },
    winter:  { sky: ['#dfe8ee', '#f3f1ea'], snow: 1, hills: ['#ffffff', '#e4ebef', '#cfd9df'], label: 'Қыс' },
    spring:  { sky: ['#cfe6d6', '#f2efc9'], sun: 1, hills: ['#a9c56a', '#85aa4a', '#5e8a3a'], label: 'Көктем' },
    summer:  { sky: ['#9fd0e6', '#f6e7b4'], sun: 1, hills: ['#8fbf5c', '#5f9a3e', '#3f7a33'], label: 'Жаз' },
    autumn:  { sky: ['#f3cf9a', '#e49c62'], sun: 1, hills: ['#d3a04a', '#b9722f', '#8a4e26'], label: 'Күз' },
    mountain:{ sky: ['#bcd3e2', '#efe9d6'], sun: 1, peaks: 1, hills: ['#8a9a6a', '#5f7552', '#3f5a43'], label: 'Тау' },
    craft:   { sky: ['#f4dfb6', '#e9b98a'], sun: 1, bricks: 1, hills: ['#b9824a', '#9b5f35', '#70432a'], label: 'Өнер' }
  };
  var uid = 0;
  function scene(theme, seed) {
    var T = THEMES[theme] || THEMES.steppe, id = 'g' + (uid++);
    var o = (seed || 0) % 5;
    var s = '<svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + T.sky[0] + '"/><stop offset="1" stop-color="' + T.sky[1] + '"/></linearGradient></defs>' +
      '<rect width="400" height="220" fill="url(#' + id + ')"/>';
    if (T.stars) for (var i = 0; i < 18; i++) s += '<circle cx="' + ((i * 53 + o * 17) % 400) + '" cy="' + ((i * 29) % 110 + 8) + '" r="' + (i % 3 ? 1 : 1.6) + '" fill="#fff" opacity=".8"/>';
    if (T.moon) s += '<circle cx="' + (290 + o * 10) + '" cy="52" r="26" fill="#f6efd0"/><circle cx="' + (302 + o * 10) + '" cy="46" r="22" fill="' + T.sky[0] + '"/>';
    if (T.sun) s += '<circle cx="' + (300 + o * 12) + '" cy="' + (70 - o * 3) + '" r="30" fill="#fff6d6" opacity=".95"/><circle cx="' + (300 + o * 12) + '" cy="' + (70 - o * 3) + '" r="46" fill="#fff6d6" opacity=".25"/>';
    if (T.peaks) s += '<path d="M0 150 L70 70 L120 125 L190 45 L260 130 L320 85 L400 150 V220 H0Z" fill="#dfe6ec"/><path d="M190 45 L168 78 L182 72 L192 84 L204 70 L214 78Z" fill="#fff"/>';
    s += '<path d="M0 ' + (150 + o * 3) + ' C80 ' + (120 - o * 4) + ' 160 ' + (165 + o * 2) + ' 250 ' + (135 + o * 3) + ' S360 ' + (125 - o * 2) + ' 400 ' + (140 + o) + ' V220 H0Z" fill="' + T.hills[0] + '"/>';
    s += '<path d="M0 ' + (178 - o * 2) + ' C90 ' + (150 + o * 3) + ' 170 ' + (190 - o * 3) + ' 260 ' + (165 + o * 2) + ' S350 ' + (160 - o * 3) + ' 400 ' + (172 + o) + ' V220 H0Z" fill="' + T.hills[1] + '"/>';
    s += '<path d="M0 205 C100 185 200 215 300 195 S380 190 400 198 V220 H0Z" fill="' + T.hills[2] + '"/>';
    if (T.bricks) {
      s += '<g fill="#c86a45" stroke="#f4dfb6" stroke-width="2">';
      for (var r = 0; r < 3; r++) for (var c = 0; c < 4; c++) s += '<rect x="' + (60 + c * 40 + (r % 2) * 20) + '" y="' + (112 + r * 18) + '" width="38" height="16" rx="2"/>';
      s += '</g>';
    }
    if (T.snow) for (var k = 0; k < 26; k++) s += '<circle cx="' + ((k * 61 + o * 23) % 400) + '" cy="' + ((k * 37) % 150) + '" r="' + (k % 3 ? 1.8 : 2.8) + '" fill="#fff" stroke="#c9d6de" stroke-width=".5"/>';
    if (theme === 'steppe' || theme === 'summer' || theme === 'spring') {
      var tx = 60 + o * 14;
      s += '<g transform="translate(' + tx + ',150)"><path d="M0 0 L16 -26 L32 0Z" fill="#fffaf0" stroke="#7a5230" stroke-width="2"/><rect x="12" y="-10" width="8" height="10" fill="#7a5230"/></g>';
    }
    return s + '</svg>';
  }

  /* ---------- пайдаланушы деректері ---------- */
  function poemProgress(p) {
    var v = store.visited[p.id] || {}, n = 0;
    TABS.forEach(function (t) { if (v[t.id]) n++; });
    return n;
  }
  function stats() {
    var steps = 0, best = 0, learned = 0;
    POEMS.forEach(function (p) {
      if (p.pending) return;
      steps += poemProgress(p);
      (store.attempts[p.id] || []).forEach(function (x) { if (x > best) best = x; });
      if (store.started[p.id]) learned++;
    });
    return { poems: POEMS.filter(function (p) { return !p.pending; }).length, steps: steps, total: POEMS.filter(function (p) { return !p.pending; }).length * TABS.length, best: best, learned: learned };
  }

  /* ---------- қабық: сол жақ мәзір ---------- */
  function sidebar(p) {
    var st = stats(), pct = st.total ? Math.round(100 * st.steps / st.total) : 0;
    var h = '<a class="brand" href="#/"><span class="logo">А</span><b>' + esc(SITE.title || '') + '<small>' + esc(SITE.subtitle || '') + '</small></b></a>';
    h += '<div class="lbl">Мәзір</div><a class="nv' + (p ? '' : ' on') + '" href="#/"><span class="ic">🏠</span>Басты бет</a>';
    h += '<a class="nv" href="#/#poems" data-act="toPoems"><span class="ic">📚</span>Өлеңдер</a>';
    h += '<a class="nv' + (onLira ? ' on' : '') + '" href="#/lira"><span class="ic">🎙</span>Лира: сөйлеу көмекшісі</a>';
    if (p) {
      var v = store.visited[p.id] || {};
      h += '<div class="lbl">Осы өлең</div>';
      TABS.forEach(function (t) {
        h += '<button class="nv" data-nav="' + t.id + '" data-act="goto" data-id="sec-' + t.id + '"><span class="ic">' + t.ic + '</span>' + t.t + '<span class="tick' + (v[t.id] ? ' on' : '') + '" data-tick="' + t.id + '"></span></button>';
      });
    }
    h += '<div class="sidefoot">Жалпы үлгерім: <b>' + pct + '%</b><div class="pb"><i style="width:' + pct + '%"></i></div></div>';
    return h;
  }
  function shell(inner, p) {
    return '<aside class="side" id="side">' + sidebar(p) + '</aside><div class="scrim" data-act="menu"></div>' +
      '<div class="main"><div class="mbar"><button data-act="menu" aria-label="Мәзір">☰</button><b>' + esc(SITE.title || '') + '</b></div>' + inner + '</div>';
  }

  /* ---------- басты бет ---------- */
  function renderHome() {
    var st = stats();
    var h = '<div class="wrap"><section class="hero">' + '<img class="scene brand" src="img/brand.jpg" alt="">' + '<div class="in"><div class="eyebrow">' + esc(SITE.subtitle || '') + '</div>' +
      '<h1>Өлеңді <em>сезін.</em> Бейнеле. Есте сақта.</h1>' +
      '<p>Жаттамай-ақ, көріп, тыңдап, сезініп меңгер: әр өлеңде алты қадам бар.</p>' +
      '<a class="btn gold" href="#/" data-act="toPoems">Бастау →</a></div></section>';
    h += '<div class="stats">' +
      '<div class="stat"><span class="ico">📚</span><div class="n">' + st.poems + '</div><div class="t">өлең</div></div>' +
      '<div class="stat"><span class="ico">👣</span><div class="n">' + st.steps + '<small style="font-size:18px;color:#6a6958"> / ' + st.total + '</small></div><div class="t">өтілген қадам</div></div>' +
      '<div class="stat"><span class="ico">🎤</span><div class="n">' + (st.best || '–') + '</div><div class="t">дауыстың үздік балы</div></div>' +
      '<div class="stat"><span class="ico">🌱</span><div class="n">' + st.learned + '</div><div class="t">жатталған өлең</div></div></div>';
    h += '<a class="lirahome" href="#/lira"><span class="orb">🎙</span><div><b>Лира: сөйлеу көмекшісі</b><span>Тақырып таңда, сөйле. Лира қарқыныңды, паразит сөздеріңді, интонацияңды талдап, қазақша кеңес береді.</span></div></a>';
    h += '<div class="how">';
    TABS.forEach(function (t) { h += '<span>' + t.ic + ' ' + t.t + '</span>'; });
    h += '</div><div id="poems" class="sh"><h2>Өлеңдер</h2><span>' + POEMS.length + ' өлең (оның ' + stats().poems + ' дайын)</span></div><div class="grid">';
    POEMS.forEach(function (p, i) {
      if (p.pending) return;
      var n = poemProgress(p), pct = Math.round(100 * n / TABS.length);
      h += '<a class="pc" href="#/p/' + p.id + '"><div class="img' + (p.portrait ? ' port' : '') + '">' + (p.cover ? '<img src="' + p.cover + '" alt="" loading="lazy">' : scene(p.theme, i)) + (p.cover ? '' : '<span class="tag">' + esc(p.tag || (THEMES[p.theme] || {}).label || '') + '</span>') + '</div>' +
        '<div class="bd"><h3 class="t">' + esc(p.title) + '</h3><div class="a">' + (p.cover && p.tag ? '<b class="gr">' + esc(p.tag) + '</b> · ' : '') + esc(p.author) + '</div><div class="pb"><i style="width:' + pct + '%"></i></div><div class="pt">' + n + ' / ' + TABS.length + ' қадам</div></div></a>';
    });
    h += '</div>';
    var soon = POEMS.filter(function (p) { return p.pending; });
    if (soon.length) {
      h += '<div class="sh soonh"><h2>🔔 Жақында шығады</h2><span>8-сынып · М. Мақатаев</span></div><div class="grid">';
      soon.forEach(function (p) {
        h += '<div class="pc soon"><div class="img">' + (p.cover ? '<img src="' + p.cover + '" alt="" loading="lazy">' : scene(p.theme, POEMS.indexOf(p))) + '<span class="tag">Жақында</span></div>' +
          '<div class="bd"><h3 class="t">' + esc(p.title) + '</h3><div class="a">' + esc(p.author) + '</div><div class="pt">Мәтін мен кодтар жақында қосылады</div></div></div>';
      });
      h += '</div>';
    }
    h += '<div class="foot">Дауыс тексергіш ырғақ пен интонацияны салыстырады.</div></div>';
    app.innerHTML = shell(h, null);
  }

  /* ---------- өлең беті: алты бөлім асты-астына ---------- */
  var SUB = {
    listen: 'Алдымен жетекші мұғалімнің оқуын тыңда',
    understand: 'Сөздердің мағынасын және әр шумақтың ойын түсін',
    draw: 'Әр жолға бейне көр, өз картаңды сал',
    speak: 'Екпін, пауза, интонация: партитурамен оқы',
    voice: 'Өз дауысыңды жазып, үлгімен салыстыр',
    check: 'Бейнеден өлеңді тап, қайталау күнтізбесін қой'
  };
  function renderPoem(p) {
    var n = poemProgress(p);
    var h = '<div class="wrap"><a class="back" href="#/">← Барлық өлеңдер</a>';
    var chips = '<div class="chips' + (p.cover ? ' dark' : '') + '">';
    TABS.forEach(function (t) { chips += '<a href="#" data-act="goto" data-id="sec-' + t.id + '">' + t.ic + ' ' + t.t + '</a>'; });
    chips += '</div>';
    if (p.cover) {
      h += '<section class="coverhero' + (p.portrait ? ' port' : '') + '"><img src="' + p.cover + '" alt="' + esc(p.title) + '"></section>' + chips;
    } else {
      h += '<section class="hero poem">' + scene(p.theme, Math.max(0, POEMS.indexOf(p))).replace('<svg ', '<svg class="scene" ') + '<div class="in"><div class="eyebrow">' + esc(p.tag || (THEMES[p.theme] || {}).label || 'Өлең') + '</div>' +
        '<h1>' + esc(p.title) + '</h1><p>' + esc(p.author) + '</p>' + chips + '</div></section>';
    }
    var fns = { listen: tabListen, understand: tabUnderstand, draw: tabDraw, speak: tabSpeak, voice: tabVoice, check: tabCheck };
    TABS.forEach(function (t, i) {
      h += '<section class="sec" id="sec-' + t.id + '" data-sec="' + t.id + '"><div class="sec-h"><span class="num">' + (i + 1) + '</span><div><h2>' + t.ic + ' ' + t.t + '</h2><p>' + SUB[t.id] + '</p></div></div>' + fns[t.id](p) +
        '<div class="nextrow">' + (i > 0 ? '<button class="btn alt" data-act="goto" data-id="sec-' + TABS[i - 1].id + '">← Артқа</button>' : '<span></span>') +
        (i < TABS.length - 1
          ? '<button class="btn" data-act="goto" data-id="sec-' + TABS[i + 1].id + '">Келесі: ' + TABS[i + 1].ic + ' ' + TABS[i + 1].t + ' →</button>'
          : '<a class="btn" href="#/">Өлеңдер тізіміне →</a>') + '</div>' + '</section>';
    });
    h += '<div class="foot">' + esc(SITE.title || '') + '</div></div>';
    app.innerHTML = shell(h, p);
    V = V && V.pid === p.id ? V : { pid: p.id };
    renderVoiceState(p);
    quiz = null; renderRepeat(p);
    canvasReady = false;
    showSection('listen', true);
  }

  var canvasReady = false;
  function showSection(id, first) {
    id = id.replace(/^sec-/, '');
    var hash = (location.hash || '').split('/'), p = hash[1] === 'p' ? poemById(hash[2]) : null;
    [].forEach.call(document.querySelectorAll('.sec'), function (el) { el.classList.toggle('active', el.getAttribute('data-sec') === id); });
    [].forEach.call(document.querySelectorAll('.side [data-nav]'), function (el) { el.classList.toggle('on', el.getAttribute('data-nav') === id); });
    if (p) {
      markVisited(p.id, id);
      var tk = document.querySelector('[data-tick="' + id + '"]'); if (tk) tk.classList.add('on');
    }
    if (id === 'draw' && !canvasReady) { setupCanvas(); canvasReady = true; }
    if (id === 'voice' && V && V.vis) { var c = document.getElementById('chartcv'); if (c) drawChart(c, V.vis); }
    if (!first) window.scrollTo({ top: 0 });
  }

  function audioSrc(p) { return localRef[p.id] ? localRef[p.id].url : p.audio; }

  function audioBlock(p, teacher) {
    var h = '<audio class="refAudio" controls preload="metadata" src="' + esc(audioSrc(p)) + '"></audio>' +
      '<div class="note warn audioErr" style="display:none">Үлгі аудио әлі қосылмаған. Мұғалім «audio» қалтасына <b>' + esc(p.audio) + '</b> файлын салуы керек.</div>';
    if (teacher) h += '<details><summary>Мұғалім үшін: аудионы тексеру</summary><p class="muted">Файл сайтқа жүктелмей тұрып, аудионы сынау үшін осында таңдаңыз (тек осы телефонда/компьютерде жұмыс істейді).</p>' +
      '<input type="file" id="localAudio" accept="audio/*"></details>';
    return h;
  }

  function tabListen(p) {
    var h = '<div class="card"><h2>' + esc(SITE.readerLabel || 'Үлгі оқу') + '</h2>' +
      '<p class="muted">Дауыстың қай жерде көтеріліп, қай жерде төмендейтініне, қай жерде тоқтайтынына назар аудар.</p>' + audioBlock(p, true) + '</div>';
    h += '<div class="card"><h2>Өлең мәтіні</h2>';
    if (p.note) h += '<p class="muted">' + esc(p.note) + '</p>';
    p.stanzas.forEach(function (s) {
      h += '<div class="stz">' + esc(s.title) + '</div><ul class="poem-lines">';
      s.lines.forEach(function (l) { h += '<li>' + esc(l.text) + '</li>'; });
      h += '</ul>';
    });
    return h + '</div>';
  }

  function tabUnderstand(p) {
    var h = '<div class="card"><h2>Түсінбеген сөздер</h2><p class="muted">Мағынасын білмеген сөзге сурет салу мүмкін емес. Алдымен сөздерді түсініп ал.</p><div class="vocab">';
    p.vocab.forEach(function (v) { h += '<div><b>' + esc(v.w) + '</b><br>' + esc(v.m) + '</div>'; });
    h += '</div></div><div class="card"><h2>Мағыналық әңгіме</h2><p class="muted">Әр шумақтың мағынасын өз сөзіңмен айтып көр.</p>';
    p.stanzas.forEach(function (s) { h += '<div class="stz">' + esc(s.title) + '</div><div class="story">' + esc(s.story) + '</div>'; });
    return h + '</div>';
  }

  function tabDraw(p) {
    var h = '<div class="card"><h2>Бейне картасы</h2><p class="muted">Әр жолдың өз бейнесі бар. Картаны басып, жолдың мәтінін көр. Алдымен бейнеге қарап өлеңді айтуға тырыс.</p>';
    p.stanzas.forEach(function (s) {
      h += '<div class="stz">' + esc(s.title) + '</div><div class="codes">';
      s.lines.forEach(function (l) {
        h += '<button class="code" data-act="flip"><span class="e">' + l.emoji + '</span><span class="k">' + esc(l.kw) + '</span><span class="d">' + esc(l.code) + '</span><span class="l">' + esc(l.text) + '</span></button>';
      });
      h += '</div>';
    });
    h += '<div class="row" style="margin-top:12px"><button class="btn small alt" data-act="openall">Барлығын ашу</button><button class="btn small alt" data-act="closeall">Барлығын жабу</button></div></div>';

    h += '<div class="card"><h2>Ассоциативті карта</h2><div class="mapbox"><div class="center">' + esc(p.title) + '</div>';
    p.stanzas.forEach(function (s) {
      h += '<div class="stz">' + esc(s.title) + '</div><div class="flow">';
      s.lines.forEach(function (l, i) { h += (i ? '<i>→</i>' : '') + '<span>' + l.emoji + '</span>'; });
      h += '</div>';
    });
    h += '</div><div class="row" style="margin-top:12px"><button class="btn small" data-act="printmap">🖨️ Картаны басып шығару</button></div></div>';

    h += '<div class="card"><h2>Өз картаңды сал</h2><p class="muted">Ортаға өлеңнің атын жаз. Шумақтардың бейнелерін оның айналасына салып, көрсеткімен жалғастыр. Сурет әдемі болмаса да, өзіңе түсінікті болсын.</p><div class="colors">';
    ['#2f4a35', '#b65a36', '#6b7b3a', '#c9a24a', '#6b3fa0', '#2b2a22'].forEach(function (c) {
      h += '<button data-act="color" data-c="' + c + '" class="' + (c === drawState.color ? 'on' : '') + '" style="background:' + c + '" aria-label="түс"></button>';
    });
    return h + '</div><canvas class="draw" id="cv"></canvas><div class="row" style="margin-top:10px"><button class="btn small alt" data-act="clear">Тазалау</button><button class="btn small" data-act="savepng">Суретті сақтау</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn small alt" data-act="printblank">🖨️ Бос карта үлгісі</button><button class="btn small alt" data-act="printmine">🖨️ Менің суретім</button></div>' +
      '<p class="muted" style="margin:10px 0 0">Басып шығару терезесінде принтерді таңдаңыз. Принтер жоқ болса, «PDF ретінде сақтау» деңіз.</p></div>';
  }

  function partHtml(s) {
    var parts = s.split('**'), out = '';
    parts.forEach(function (t, i) {
      t = esc(t).replace(/ \/\/ ?/g, ' <span class="p2">‖</span> ').replace(/\/\/$/, '<span class="p2">‖</span>')
        .replace(/ \/ /g, ' <span class="p1">|</span> ').replace(/↗/g, '<span class="ar">↗</span>').replace(/↘/g, '<span class="ar">↘</span>');
      out += i % 2 ? '<span class="acc">' + t + '</span>' : t;
    });
    return out;
  }

  function tabSpeak(p) {
    var h = '<div class="card"><h2>Белгілер</h2><p class="muted">Партитура: қай сөзге екпін түседі, қай жерде тыныс аласың, дауыс қалай өзгереді.</p>' +
      '<div class="legend"><b class="acc">Қалың сөз</b><span>Логикалық екпін: дауысты осы жерде күшейт</span><b>|</b><span>Қысқа үзіліс, жеңіл тыныс ал</span><b>‖</b><span>Ұзақ үзіліс: ойланып, тыныс ал</span><b>↗</b><span>Дауыс көтеріледі</span><b>↘</b><span>Дауыс төмендейді</span></div></div>';
    p.stanzas.forEach(function (s) {
      h += '<div class="card"><h2>' + esc(s.title) + '<span class="mood">' + esc(s.mood) + '</span></h2>';
      s.lines.forEach(function (l) { h += '<div class="pline">' + partHtml(l.part) + '</div>'; });
      h += '</div>';
    });
    return h + '<div class="card"><h2>Үш рет орында</h2>' +
      '<label class="check"><input type="checkbox"> Сыбырлап (барлық белгілермен)</label>' +
      '<label class="check"><input type="checkbox"> Қалыпты дауыспен (тек екпіндерге қарап)</label>' +
      '<label class="check"><input type="checkbox"> Сахналық дауыспен, қимылмен (белгісіз)</label></div>';
  }

  /* ---------- дауыс тексергіш ---------- */
  function tabVoice(p) {
    return '<div class="card"><h2>1. ' + esc(SITE.readerLabel || 'Үлгі') + '</h2>' +
      '<p class="muted">Алдымен үлгіні тыңда, сосын өз дауысыңмен оқып жаз. Платформа ырғақ, интонация, қарқын және паузаны үлгімен салыстырады.</p>' + audioBlock(p, false) + '</div>' +
      '<div class="card"><h2>2. Өз дауысыңды жаз</h2><div id="recUI"></div></div>' +
      '<div id="resultUI"></div>' +
      '<div class="note">Платформа дауыстың <b>ырғағын, интонациясын, қарқынын және паузаларын</b> салыстырады. Сөздердің дұрыс айтылғанын немесе мәтіннің дәл жатталғанын тексермейді, ол үшін мұғалімге оқып беріңіз.</div>';
  }

  function fmtT(s) { var m = Math.floor(s / 60), x = Math.floor(s % 60); return m + ':' + (x < 10 ? '0' : '') + x; }

  function renderVoiceState(p) {
    var ui = document.getElementById('recUI');
    if (!ui) return;
    var h = '';
    if (!V.recording) {
      h += '<p class="muted">Тыныш жерде, микрофонға жақын отырып оқыңыз. Ең ұзағы 90 секунд.</p>' +
        '<div class="row"><button class="btn rec" data-act="rec">🎤 Жазуды бастау</button></div>';
      if (V.url) h += '<h3>Сенің жазбаң</h3><audio controls src="' + V.url + '"></audio>';
    } else {
      h += '<div class="timer" id="timer">0:00</div><div class="meter"><div id="meterbar"></div></div>' +
        '<div class="row"><button class="btn" data-act="stop">⏹ Тоқтату және салыстыру</button></div>';
    }
    if (V.msg) h += '<div class="note ' + (V.msgBad ? 'warn' : '') + '">' + V.msg + '</div>';
    ui.innerHTML = h;
    var res = document.getElementById('resultUI');
    if (res) res.innerHTML = V.resultHtml || '';
    if (V.vis && document.getElementById('chartcv')) drawChart(document.getElementById('chartcv'), V.vis);
  }

  function stopRecordingSilently() {
    if (V && V.recording) {
      V.discard = true;
      try { V.rec.stop(); } catch (e) { /* ештеңе */ }
      V.recording = false;
      cleanupStream();
    }
  }
  function cleanupStream() {
    if (V && V.stream) { V.stream.getTracks().forEach(function (t) { t.stop(); }); V.stream = null; }
    if (V && V.timerId) { clearInterval(V.timerId); V.timerId = null; }
    if (V && V.raf) { cancelAnimationFrame(V.raf); V.raf = null; }
    if (V && V.src) { try { V.src.disconnect(); } catch (e) { /* ештеңе */ } V.src = null; }
  }

  function startRec(p) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      V.msg = 'Жазу үшін сайт интернет-мекенжайы (https://) арқылы ашылуы керек. Файлды телефоннан тікелей ашсаңыз, микрофон жұмыс істемейді. Сайтты интернетке шығарыңыз (README_ОҚЫҢЫЗ файлындағы нұсқау) немесе Chrome/Safari жаңа нұсқасын қолданыңыз.'; V.msgBad = true; renderVoiceState(p); return;
    }
    var ctx = getCtx();
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }).then(function (stream) {
      V.stream = stream; V.chunks = []; V.msg = ''; V.vis = null; V.resultHtml = ''; V.discard = false;
      var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'], mt = '';
      for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) { mt = types[i]; break; }
      var rec = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
      V.rec = rec; V.mime = rec.mimeType || mt;
      rec.ondataavailable = function (e) { if (e.data && e.data.size) V.chunks.push(e.data); };
      rec.onstop = function () { onRecStop(p); };
      rec.start();
      if (window.Lira) V.recog = window.Lira.startRecognizer();
      V.recording = true; V.t0 = Date.now();
      renderVoiceState(p);
      if (ctx) {
        try {
          var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
          an.fftSize = 1024; src.connect(an); V.src = src;
          var buf = new Uint8Array(an.fftSize);
          (function loop() {
            if (!V || !V.recording) return;
            an.getByteTimeDomainData(buf);
            var s = 0; for (var k = 0; k < buf.length; k++) { var v = (buf[k] - 128) / 128; s += v * v; }
            var lvl = Math.min(1, Math.sqrt(s / buf.length) * 4);
            var mb = document.getElementById('meterbar'); if (mb) mb.style.width = Math.round(lvl * 100) + '%';
            V.raf = requestAnimationFrame(loop);
          })();
        } catch (e) { /* деңгей көрсеткіші міндетті емес */ }
      }
      V.timerId = setInterval(function () {
        var sec = (Date.now() - V.t0) / 1000, t = document.getElementById('timer');
        if (t) t.textContent = fmtT(sec);
        if (sec >= 90) stopRec();
      }, 250);
    }).catch(function () {
      V.msg = 'Микрофонға рұқсат берілмеді. Браузердің сұрауында «Рұқсат ету» батырмасын басыңыз да, қайтадан көріңіз.'; V.msgBad = true; renderVoiceState(p);
    });
  }

  function stopRec() { if (V && V.recording && V.rec && V.rec.state !== 'inactive') V.rec.stop(); }

  function onRecStop(p) {
    var discard = V.discard;
    V.recording = false;
    cleanupStream();
    if (discard) return;
    V.heard = window.Lira ? window.Lira.stopRecognizer(V.recog) : ''; V.recog = null;
    var blob = new Blob(V.chunks, { type: V.mime || 'audio/webm' });
    if (V.url) URL.revokeObjectURL(V.url);
    V.url = URL.createObjectURL(blob);
    V.msg = 'Салыстырып жатырмын…'; V.msgBad = false;
    renderVoiceState(p);
    analyse(p, blob);
  }

  function decode(ab) {
    var ctx = getCtx();
    return new Promise(function (res, rej) {
      try { var pr = ctx.decodeAudioData(ab, res, rej); if (pr && pr.then) pr.then(res, rej); } catch (e) { rej(e); }
    });
  }
  function mono(buf) {
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    var a = buf.getChannelData(0), b = buf.getChannelData(1), out = new Float32Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
    return out;
  }

  function loadRef(p) {
    if (localRef[p.id] && localRef[p.id].buffer) return Promise.resolve(localRef[p.id].buffer);
    if (refCache[p.id]) return Promise.resolve(refCache[p.id]);
    return fetch(p.audio).then(function (r) { if (!r.ok) throw new Error('404'); return r.arrayBuffer(); })
      .then(decode).then(function (b) { refCache[p.id] = b; return b; });
  }

  function poemInfo(p) {
    var syl = 0, n = 0;
    allLines(p).forEach(function (x) { n++; var m = String(x.l.text).toLowerCase().match(/[аәеёиіоөұүуыэюя]/g); syl += m ? m.length : 0; });
    return { syllables: syl, lines: n };
  }

  function analyse(p, blob) {
    Promise.all([loadRef(p).catch(function () { return null; }), blob.arrayBuffer().then(decode).catch(function () { return null; })]).then(function (r) {
      var ref = r[0], stu = r[1];
      if (!stu) { V.msg = 'Жазбаны өңдей алмадым. Қайтадан жазып көріңіз.'; V.msgBad = true; return renderVoiceState(p); }
      setTimeout(function () {
        var res = ref ? window.VoiceAnalysis.compare(mono(ref), ref.sampleRate, mono(stu), stu.sampleRate) : window.VoiceAnalysis.solo(mono(stu), stu.sampleRate, poemInfo(p));
        if (res.error) {
          var m = { short: 'Жазба тым қысқа. Өлеңді толық оқып көріңіз.', quiet: 'Дауыс өте баяу жазылды. Микрофонға жақынырақ отырып, қатырақ оқыңыз.', nospeech: 'Дауыс анық естілмеді. Тыныш жерде қайталаңыз.', ref: 'Үлгі аудио тым қысқа немесе үнсіз. Мұғалімге хабарлаңыз.' }[res.error];
          V.msg = m; V.msgBad = true; return renderVoiceState(p);
        }
        store.attempts[p.id] = store.attempts[p.id] || [];
        store.attempts[p.id].push(res.total);
        if (store.attempts[p.id].length > 12) store.attempts[p.id].shift();
        save();
        V.msg = ''; V.vis = res.vis; V.resultHtml = resultHtml(p, res);
        renderVoiceState(p);
        if (window.Lira && V.lt) window.Lira.say(V.lt);
        var el = document.getElementById('resultUI'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth' });
      }, 30);
    });
  }

  function ringSvg(score) {
    var R = 46, C = 2 * Math.PI * R, off = C * (1 - score / 100);
    var col = score >= 80 ? '#5f7a3a' : score >= 55 ? '#c9a24a' : '#b65a36';
    return '<svg class="ring" viewBox="0 0 110 110"><circle cx="55" cy="55" r="' + R + '" fill="none" stroke="#ece2c8" stroke-width="10"/>' +
      '<circle cx="55" cy="55" r="' + R + '" fill="none" stroke="' + col + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 55 55)"/>' +
      '<text x="55" y="64" text-anchor="middle">' + score + '</text></svg>';
  }
  function barHtml(name, v) {
    if (v === null) return '<div class="bar">' + name + ': анықталмады</div>';
    return '<div class="bar">' + name + ' <b>' + v + '</b><div class="bg"><div class="fg" style="width:' + v + '%"></div></div></div>';
  }
  function resultHtml(p, r) {
    var label = r.total >= 85 ? 'Тамаша!' : r.total >= 70 ? 'Жақсы, дерлік дайын!' : r.total >= 50 ? 'Жаман емес, қайталап көр' : 'Үлгіні тағы тыңдап, қайталап көр';
    var h = '<div class="card"><h2>📊 Нәтиже: ' + label + '</h2><div class="score">' + ringSvg(r.total) + '<div class="bars">' +
      barHtml('Ырғақ', r.rhythm) + barHtml('Интонация', r.intonation) + barHtml('Қарқын', r.tempo) + barHtml('Паузалар', r.pauses) + '</div></div>';
    h += '<h3>Кеңестер</h3><ul class="tips">';
    r.tips.forEach(function (t) { h += '<li>' + esc(t) + '</li>'; });
    h += '</ul><h3>Дауыс сызықтары</h3><div class="lg' + (r.solo ? '' : '') + '">' + (r.solo ? '' : '<span><i style="background:#2f4a35"></i>Үлгі</span>') + '<span><i style="background:#b65a36"></i>Сенің дауысың</span></div><canvas class="chart" id="chartcv"></canvas>';
    var a = store.attempts[p.id] || [];
    if (a.length > 1) {
      h += '<h3>Әрекеттерің</h3><div class="hist">';
      a.forEach(function (x, i) { h += '<span>' + x + (i < a.length - 1 ? '' : ' ✓') + '</span>'; });
      h += '</div>';
    }
    h += '<div class="row" style="margin-top:12px"><button class="btn rec" data-act="rec">🎤 Қайта жазу</button></div></div>';
    if (window.Lira) {
      var lt = 'Сенің бағаң жүзден ' + r.total + '. ' + (r.tips[0] || '');
      h += '<div class="card lira-card"><div class="lbubble"><span class="lorb">🎙</span><div><b>Лира:</b> ' + esc(lt) + '</div></div>' + window.Lira.voiceHelp +
        '<div class="row" style="margin-top:10px"><button class="btn alt" data-lirasay="' + esc(lt) + '">🔊 Лира айтады</button></div></div>';
      V.lt = lt;
    }
    if (window.Lira && V && V.heard) h += window.Lira.poemMatchHtml(allLines(p).map(function (x) { return x.l.text; }).join(' '), V.heard);
    return h;
  }

  function drawChart(cv, vis) {
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var pad = 10, gap = 24, h1 = (H - 2 * pad - gap) * 0.55, h2 = (H - 2 * pad - gap) * 0.45;
    function series(arr, y0, h, min, max, color) {
      if (!arr) return;
      g.beginPath(); g.lineWidth = 2.5; g.strokeStyle = color; g.lineJoin = 'round';
      for (var i = 0; i < arr.length; i++) {
        var x = pad + (W - 2 * pad) * i / (arr.length - 1), y = y0 + h - (arr[i] - min) / (max - min) * h;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    function rangeOf(a, b) {
      var mn = 1e9, mx = -1e9;
      [a, b].forEach(function (s) { if (s) s.forEach(function (v) { if (v < mn) mn = v; if (v > mx) mx = v; }); });
      if (mx - mn < 1) { mx += 0.5; mn -= 0.5; }
      var m = (mx - mn) * 0.08; return [mn - m, mx + m];
    }
    g.fillStyle = '#6a6958'; g.font = '12px system-ui,sans-serif';
    g.fillText('Интонация (дауыс биіктігі)', pad, pad + 10);
    var r1 = rangeOf(vis.refContour, vis.stuContour);
    series(vis.refContour, pad + 14, h1 - 14, r1[0], r1[1], '#2f4a35');
    series(vis.stuContour, pad + 14, h1 - 14, r1[0], r1[1], '#b65a36');
    var y2 = pad + h1 + gap;
    g.fillStyle = '#6a6958'; g.fillText('Ырғақ (дыбыс күші) және паузалар', pad, y2 - 6);
    var r2 = rangeOf(vis.refEnv, vis.stuEnv);
    series(vis.refEnv, y2, h2 - 10, r2[0], r2[1], '#2f4a35');
    series(vis.stuEnv, y2, h2 - 10, r2[0], r2[1], '#b65a36');
    function ticks(arr, color, off) {
      g.fillStyle = color;
      arr.forEach(function (f) { var x = pad + (W - 2 * pad) * f; g.fillRect(x - 3, y2 + h2 - 8 + off, 6, 4); });
    }
    ticks(vis.refPauses || [], '#2f4a35', -2); ticks(vis.stuPauses || [], '#b65a36', 3);
  }

  /* ---------- сурет салу ---------- */
  function setupCanvas() {
    var cv = document.getElementById('cv');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
    var drawing = false, lx = 0, ly = 0;
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    cv.addEventListener('pointerdown', function (e) { drawing = true; var p = pos(e); lx = p[0]; ly = p[1]; cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pos(e); g.strokeStyle = drawState.color; g.lineWidth = drawState.size; g.lineCap = 'round';
      g.beginPath(); g.moveTo(lx, ly); g.lineTo(p[0], p[1]); g.stroke(); lx = p[0]; ly = p[1]; e.preventDefault();
    });
    function end() { drawing = false; }
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }

  /* ---------- тексеру: ойын және қайталау ---------- */
  function buildQuiz(p) {
    var seen = {}, lines = allLines(p).map(function (x) { return x.l; }).filter(function (l) { if (seen[l.text]) return false; seen[l.text] = 1; return true; });
    var qs = [];
    lines.forEach(function (l) {
      var others = shuffle(lines.filter(function (o) { return o !== l; })).slice(0, 3);
      qs.push({ type: 'img', emoji: l.emoji, ask: l.kw, correct: l.text, opts: shuffle([l.text].concat(others.map(function (o) { return o.text; }))) });
      var kws = shuffle(lines.filter(function (o) { return o !== l; }).map(function (o) { return o.kw; })).slice(0, 3);
      var blank = l.text.replace(l.kw, '____');
      if (blank !== l.text) qs.push({ type: 'fill', ask: blank, correct: l.kw, opts: shuffle([l.kw].concat(kws)) });
    });
    return { qs: shuffle(qs).slice(0, 10), i: 0, score: 0, answered: false };
  }

  function tabCheck(p) {
    return '<div class="card"><h2>Бейнеден өлеңге</h2><div id="quizUI"></div></div><div class="card"><h2>📅 Қайталау күнтізбесі</h2><div id="repUI"></div></div>';
  }

  function renderQuiz(p) {
    var ui = document.getElementById('quizUI');
    if (!ui) return;
    if (!quiz) {
      ui.innerHTML = '<p class="muted">10 сұрақ: бейнеге қарап дұрыс жолды тап немесе жолдағы жетіспейтін сөзді толтыр.</p><button class="btn" data-act="quizstart">Ойынды бастау</button>';
      return;
    }
    if (quiz.i >= quiz.qs.length) {
      var pct = Math.round(100 * quiz.score / quiz.qs.length);
      ui.innerHTML = '<div class="q">Нәтиже: ' + quiz.score + ' / ' + quiz.qs.length + ' ' + (pct >= 80 ? '🎉' : pct >= 50 ? '👍' : '💪') + '</div><p class="muted">' +
        (pct >= 80 ? 'Керемет! Енді картасыз толық өлеңді айтып көр.' : 'Бейне картасына қайта қарап, тағы бір рет ойнап көр.') + '</p><div class="row"><button class="btn" data-act="quizstart">Қайта ойнау</button><a class="btn alt" style="text-decoration:none" href="#/p/' + p.id + '/draw">Картаны ашу</a></div>';
      return;
    }
    var q = quiz.qs[quiz.i];
    var h = '<div class="prog"><div style="width:' + Math.round(100 * quiz.i / quiz.qs.length) + '%"></div></div>';
    if (q.type === 'img') h += '<div class="q">Қай жол бейнеге сай келеді?<span class="big">' + q.emoji + '</span></div>';
    else h += '<div class="q">Жетіспейтін сөзді тап:<br><span style="font-weight:500">' + esc(q.ask) + '</span></div>';
    h += '<div class="opts">';
    q.opts.forEach(function (o, k) { h += '<button class="opt" data-act="answer" data-k="' + k + '">' + esc(o) + '</button>'; });
    h += '</div><div id="qfb"></div>';
    ui.innerHTML = h;
  }

  function renderRepeat(p) {
    renderQuiz(p);
    var ui = document.getElementById('repUI');
    if (!ui) return;
    var st = store.started[p.id];
    if (!st) {
      ui.innerHTML = '<p class="muted">Өлеңді жаттап болғанда, төмендегі батырманы бас. Платформа 1-, 3- және 7-күні қайталауды еске салады.</p><button class="btn gold" data-act="learned">Жаттадым! Бүгінгі күнді белгіле</button>';
      return;
    }
    var start = new Date(st + 'T00:00:00'), today = new Date(); today.setHours(0, 0, 0, 0);
    var rp = store.repeats[p.id] = store.repeats[p.id] || {};
    var h = '<p class="muted">Жаттаған күн: ' + st + '</p>';
    [1, 3, 7].forEach(function (d) {
      var due = new Date(start.getTime() + d * 86400000), ds = due.toISOString().slice(0, 10), done = rp[d];
      var cls = done ? 'done' : (due <= today ? 'due' : 'wait'), txt = done ? 'Орындалды ✓' : (due <= today ? 'Бүгін қайталау керек!' : 'Күтілуде');
      var dl = (due.getDate() < 10 ? '0' : '') + due.getDate() + '.' + (due.getMonth() < 9 ? '0' : '') + (due.getMonth() + 1);
      h += '<div class="rep"><div><b>' + d + '-күн</b> · ' + dl + '<br><span class="badge ' + cls + '">' + txt + '</span></div>' +
        (done ? '' : '<button class="btn small" data-act="repdone" data-d="' + d + '">Қайталадым</button>') + '</div>';
    });
    h += '<div class="row" style="margin-top:12px"><button class="btn small alt" data-act="resetrep">Қайтадан бастау</button></div>';
    ui.innerHTML = h;
  }

  /* ---------- басып шығару ---------- */
  function printHtml(html, title) {
    var el = document.getElementById('printArea');
    if (!el) { el = document.createElement('div'); el.id = 'printArea'; document.body.appendChild(el); }
    el.innerHTML = html;
    var old = document.title; document.title = title || old;
    document.body.classList.add('printing');
    function done() { document.body.classList.remove('printing'); document.title = old; window.removeEventListener('afterprint', done); }
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); setTimeout(done, 1500); }, 150);
  }
  function printHead(p, sub) {
    return '<div class="pr-head"><div class="pr-t">' + esc(p.title) + '</div><div class="pr-a">' + esc(p.author) + ' · ' + sub + '</div></div>';
  }
  function printMap(p) {
    var h = printHead(p, 'Ассоциативті карта');
    p.stanzas.forEach(function (s) {
      h += '<div class="pr-st">' + esc(s.title) + '</div><div class="pr-grid">';
      s.lines.forEach(function (l) {
        h += '<div class="pr-cell"><div class="pr-e">' + l.emoji + '</div><div class="pr-k">' + esc(l.kw) + '</div><div class="pr-l">' + esc(l.text) + '</div><div class="pr-d">' + esc(l.code) + '</div></div>';
      });
      h += '</div>';
    });
    h += '<div class="pr-foot">' + esc(SITE.title || '') + '</div>';
    printHtml(h, p.title + ' – ассоциативті карта');
  }
  function printBlank(p) {
    var h = printHead(p, 'Өз картаңды сал') + '<div class="pr-center">' + esc(p.title) + '</div>' +
      '<p class="pr-hint">Әр шумақтың бейнелерін өз қолыңмен сал. Көрсеткімен жалғастыр.</p>';
    p.stanzas.forEach(function (s) {
      h += '<div class="pr-box"><div class="pr-st">' + esc(s.title) + '</div><div class="pr-lines">';
      s.lines.forEach(function (l) { h += '<div>' + esc(l.text) + '</div>'; });
      h += '</div><div class="pr-draw"></div></div>';
    });
    h += '<div class="pr-foot">' + esc(SITE.title || '') + '</div>';
    printHtml(h, p.title + ' – бос карта');
  }
  function printMine(p) {
    var cv = document.getElementById('cv');
    if (!cv) return;
    var h = printHead(p, 'Менің картам') + '<img class="pr-img" src="' + cv.toDataURL('image/png') + '" alt=""><div class="pr-foot">' + esc(SITE.title || '') + '</div>';
    printHtml(h, p.title + ' – менің картам');
  }

  /* ---------- оқиғалар ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var hash = (location.hash || '').split('/'), p = hash[1] === 'p' ? poemById(hash[2]) : null;
    if (act === 'printmap' && p) printMap(p);
    else if (act === 'printblank' && p) printBlank(p);
    else if (act === 'printmine' && p) printMine(p);
    else if (act === 'menu') document.body.classList.toggle('menu');
    else if (act === 'toPoems') {
      e.preventDefault(); document.body.classList.remove('menu');
      if ((location.hash || '#/').indexOf('#/p/') === 0) location.hash = '#/';
      setTimeout(function () { var x = document.getElementById('poems'); if (x) x.scrollIntoView({ behavior: 'smooth' }); }, 60);
    } else if (act === 'goto') {
      e.preventDefault(); document.body.classList.remove('menu');
      showSection(el.getAttribute('data-id'));
    } else if (act === 'flip') el.classList.toggle('open');
    else if (act === 'openall') [].forEach.call(document.querySelectorAll('.code'), function (c) { c.classList.add('open'); });
    else if (act === 'closeall') [].forEach.call(document.querySelectorAll('.code'), function (c) { c.classList.remove('open'); });
    else if (act === 'color') {
      drawState.color = el.getAttribute('data-c');
      [].forEach.call(document.querySelectorAll('.colors button'), function (b) { b.classList.toggle('on', b === el); });
    } else if (act === 'clear') setupCanvas();
    else if (act === 'savepng') {
      var cv = document.getElementById('cv');
      cv.toBlob(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ozim-kartam.png'; document.body.appendChild(a); a.click(); a.remove(); });
    } else if (act === 'rec' && p) startRec(p);
    else if (act === 'stop' && p) stopRec();
    else if (act === 'quizstart' && p) { quiz = buildQuiz(p); renderQuiz(p); }
    else if (act === 'answer' && quiz && !quiz.answered) {
      var q = quiz.qs[quiz.i], k = +el.getAttribute('data-k'), ok = q.opts[k] === q.correct;
      quiz.answered = true; if (ok) quiz.score++;
      [].forEach.call(document.querySelectorAll('.opt'), function (b, i) {
        if (q.opts[i] === q.correct) b.classList.add('good'); else if (i === k) b.classList.add('bad');
      });
      document.getElementById('qfb').innerHTML = '<p>' + (ok ? '✅ Дұрыс!' : '❌ Дұрыс жауап: <b>' + esc(q.correct) + '</b>') + '</p><button class="btn" data-act="qnext">Келесі</button>';
    } else if (act === 'qnext' && quiz && p) { quiz.i++; quiz.answered = false; renderQuiz(p); }
    else if (act === 'learned' && p) { var d = new Date(); store.started[p.id] = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); save(); renderRepeat(p); }
    else if (act === 'repdone' && p) { store.repeats[p.id][el.getAttribute('data-d')] = true; save(); renderRepeat(p); }
    else if (act === 'resetrep' && p) { delete store.started[p.id]; delete store.repeats[p.id]; save(); renderRepeat(p); }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'localAudio' && e.target.files[0]) {
      var hash = (location.hash || '').split('/'), p = poemById(hash[2]);
      if (!p) return;
      var f = e.target.files[0], url = URL.createObjectURL(f);
      localRef[p.id] = { url: url, buffer: null };
      f.arrayBuffer().then(decode).then(function (b) { localRef[p.id].buffer = b; }).catch(function () { /* аудио ойнатылады, талдау үшін басқа формат қажет болуы мүмкін */ });
      [].forEach.call(document.querySelectorAll('.refAudio'), function (a) { a.src = url; });
      [].forEach.call(document.querySelectorAll('.audioErr'), function (x) { x.style.display = 'none'; });
    }
  });

  // аудио файлы жоқ болса ескерту көрсету
  document.addEventListener('error', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('refAudio')) {
      [].forEach.call(document.querySelectorAll('.audioErr'), function (x) { x.style.display = 'block'; });
    }
  }, true);

  route();
})();
