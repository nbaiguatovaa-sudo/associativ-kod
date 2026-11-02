/* Лира: қазақша сөйлеу көмекшісі.
   1) Еркін сөйлеу: тақырып таңдап сөйлейді, Лира қарқынды, паразит сөздерді,
      қайталауды, интонацияны, паузаны талдап, қазақша кеңес береді.
   2) Өлең оқығанда: танылған мәтінді өлең мәтінімен салыстырады.
   Сөзді тану Chrome-дың kk-KZ тілі арқылы жүреді (интернет керек). */
(function () {
  'use strict';
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var TOPICS = [
    'Менің сүйікті өлеңім және неге ұнайды',
    'Ана тілі: біздің байлығымыз',
    'Болашақ мамандығым',
    'Жасанды интеллект: көмекші ме, қауіп пе?',
    'Мені шабыттандырған адам',
    'Емтиханнан алдындағы толқуды қалай жеңемін',
    'Абай мен біздің заман',
    'Маған берілген ең жақсы кеңес'
  ];
  var FILL1 = ['э', 'эм', 'ээ', 'мм', 'ну', 'вот', 'типа', 'короче', 'значит', 'яғни', 'былай', 'міне', 'осы', 'мынау', 'анау', 'жалпы', 'әрине'];
  var FILL2 = ['былайша айтқанда', 'білесің бе', 'білесіз бе', 'түсінесің бе', 'түсінесіз бе', 'қысқасы айтқанда', 'айтайын дегенім', 'мәселен', 'не дейін', 'сол сияқты'];
  var STOP = ('және бірақ болып үшін сонда деген бұл осы ол мен сен біз сіз олар болады болды болған емес бар жоқ сонымен сосын содан кейін ' +
    'өте тағы да бірге барлық әрбір қандай қалай неге себебі өйткені немесе деп екен еді ғой шығар болса болмақ сондай мұндай').split(' ');
  var STOPSET = {}; STOP.forEach(function (w) { STOPSET[w] = 1; });
  var F1 = {}; FILL1.forEach(function (w) { F1[w] = 1; });
  var KEY = 'ak_lira_v2';

  var S = { topic: TOPICS[0], sel: 0, goal: 60, recording: false };

  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clamp(x, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 100 : b; return Math.max(a, Math.min(b, x)); }
  function pct(arr, p) { if (!arr.length) return 0; var s = arr.slice().sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
  function fmt(s) { s = Math.floor(s); return ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2); }
  function words(t) { return String(t).toLowerCase().replace(/ё/g, 'е').replace(/[^а-яәіңғүұқөһa-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean); }
  function loadH() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function saveH(a) { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-30))); } catch (e) { /* ештеңе */ } }

  /* ---------- қазақша дауыс (бар болса) ---------- */
  function kkVoice() {
    if (!window.speechSynthesis) return null;
    var vs = speechSynthesis.getVoices() || [];
    for (var i = 0; i < vs.length; i++) if (/^kk/i.test((vs[i].lang || '').replace('_', '-'))) return vs[i];
    for (i = 0; i < vs.length; i++) if (/kazakh|қазақ|aigul|daulet|айгүл|дәулет/i.test(vs[i].name || '')) return vs[i];
    return null;
  }
  function say(t) {
    var v = kkVoice(); if (!v) { noVoiceNote(); return false; }
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(t); u.lang = 'kk-KZ'; u.voice = v; u.rate = 1; speechSynthesis.speak(u); return true;
  }

  function noVoiceNote() {
    var el = document.getElementById('liraVoiceNote');
    if (el) el.style.display = 'block';
  }
  var VOICE_HELP = '<div class="note warn" id="liraVoiceNote" style="display:none">🔇 Бұл құрылғыда қазақша дыбыстау дауысы жоқ. Лираны дауыспен есту үшін сайтты <b>Microsoft Edge</b> браузерінде ашыңыз (компьютерде немесе телефонда): онда қазақша «Айгүл» және «Дәулет» дауыстары бар. Лираның жауабы төменде жазбаша да көрсетіледі.</div>';

  function summaryText(R) {
    var first = R.recs.filter(function (r) { return /🔇|🐢|🚀|🎵|🔁|📚|⏸/.test(r[0]); })[0] || R.recs[0];
    return 'Сенің бағаң жүзден ' + R.overall + '. ' + first[1] + ' Тағы бір рет жазып, нәтижені салыстырайық.';
  }

  /* ---------- сөзді тану (өлең оқуға да қолданылады) ---------- */
  function startRecognizer() {
    var o = { text: '', interim: '', on: true, r: null, onupdate: null, err: null };
    if (!SR) return o;
    try {
      var r = new SR(); r.lang = 'kk-KZ'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
      r.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var t = e.results[i][0].transcript;
          if (e.results[i].isFinal) o.text += t + ' '; else interim += t;
        }
        o.interim = interim; if (o.onupdate) o.onupdate(o.text + interim);
      };
      r.onerror = function (e) { o.err = e.error; };
      r.onend = function () { if (o.on) { try { r.start(); } catch (e) { /* ештеңе */ } } };
      r.start(); o.r = r;
    } catch (e) { o.err = 'fail'; }
    return o;
  }
  function stopRecognizer(o) {
    if (!o) return '';
    o.on = false;
    try { o.r && o.r.stop(); } catch (e) { /* ештеңе */ }
    return (o.text + ' ' + o.interim).trim();
  }

  /* ---------- өлең мәтінімен салыстыру ---------- */
  function poemMatch(poemWordsText, heard) {
    var a = words(poemWordsText), b = words(heard);
    if (a.length < 3 || b.length < 3) return null;
    var n = a.length, m = b.length, i, j, L = [];
    for (i = 0; i <= n; i++) { L.push(new Uint16Array(m + 1)); }
    for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) L[i][j] = a[i - 1] === b[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    var used = {}; i = n; j = m;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) { used[i - 1] = 1; i--; j--; }
      else if (L[i - 1][j] >= L[i][j - 1]) i--; else j--;
    }
    var missing = []; a.forEach(function (w, k) { if (!used[k] && missing.indexOf(w) < 0) missing.push(w); });
    return { score: Math.round(100 * L[n][m] / n), missing: missing.slice(0, 10), heard: m, total: n };
  }
  function poemMatchHtml(poemText, heard) {
    var r = poemMatch(poemText, heard);
    if (!r) return '';
    var c = r.score >= 85 ? 'Лира: сөздерді дерлік түгел айттың!' : r.score >= 60 ? 'Лира: көпшілігі дұрыс, кейбір жерін қайталап көр.' : 'Лира: мәтінді қайта оқып, жатталатындай ету керек.';
    var h = '<div class="card lira-card"><h2>🤖 Лира: мәтін сәйкестігі — ' + r.score + '%</h2><div class="lbubble"><span class="lorb">🎙</span><div>' + c.replace('Лира: ', '') + '</div></div>' + VOICE_HELP + '<div class="row" style="margin:8px 0"><button class="btn alt" data-lirasay="' + esc('Мәтін сәйкестігі жүзден ' + r.score + '. ' + c.replace('Лира: ', '')) + '">🔊 Лира айтады</button></div>';
    if (r.missing.length && r.score < 100) h += '<p class="muted">Естілмеген немесе басқаша айтылған сөздер: <b>' + r.missing.map(esc).join(', ') + '</b></p>';
    h += '<p class="muted">Ескерту: сөзді тану компьютерлік, кейде қателеседі. Нәтиже шамамен ғана.</p></div>';
    return h;
  }

  /* ---------- талдау ---------- */
  function analyze(text, dur, samples) {
    var w = words(text), n = w.length;
    var R = { text: text, dur: dur, n: n, topic: S.topic, ts: Date.now(), hasAudio: samples.length > 20 };
    var joined = ' ' + w.join(' ') + ' ', fl = {}, fc = 0;
    FILL2.forEach(function (p) {
      var k = 0, i = -1; while ((i = joined.indexOf(' ' + p + ' ', i + 1)) >= 0) { k++; i += p.length; }
      if (k) { fl[p] = k; fc += k; }
    });
    w.forEach(function (x) { if (F1[x]) { fl[x] = (fl[x] || 0) + 1; fc++; } });
    R.fillers = fl; R.fillerCount = fc; R.fillerPer100 = n ? fc / n * 100 : 0;
    var imm = []; for (var i = 1; i < n; i++) if (w[i] === w[i - 1] && w[i].length > 1) imm.push(w[i]);
    var stem = {};
    w.forEach(function (x) { if (x.length >= 5 && !STOPSET[x] && !F1[x]) { var k = x.slice(0, 5); (stem[k] = stem[k] || { c: 0, w: x }).c++; } });
    var over = Object.keys(stem).map(function (k) { return stem[k]; }).filter(function (o) { return o.c >= 4 && o.c / n > 0.03; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 6);
    var excess = over.reduce(function (s, o) { return s + (o.c - 3); }, 0);
    R.imm = imm; R.over = over; R.repPer100 = n ? (imm.length + excess) / n * 100 : 0;
    var st = 0, en = dur; R.pauses = 0; R.longPauses = 0; R.pitchStd = null; R.volCv = null;
    if (R.hasAudio) {
      var rm = samples.map(function (s) { return s.rms; }), thr = Math.max(0.012, pct(rm, 0.9) * 0.2);
      var voiced = samples.filter(function (s) { return s.rms > thr; });
      if (voiced.length > 10) {
        st = voiced[0].t; en = voiced[voiced.length - 1].t;
        var sil = 0, silStart = 0;
        samples.forEach(function (s) {
          if (s.t < st || s.t > en) return;
          if (s.rms <= thr) { if (!sil) silStart = s.t; sil++; }
          else { if (sil) { var len = s.t - silStart; if (len >= 0.6) R.pauses++; if (len >= 2.5) R.longPauses++; } sil = 0; }
        });
        var v = voiced.map(function (s) { return s.rms; }), mean = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
        var sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / v.length); R.volCv = mean ? sd / mean : 0;
        var p = voiced.map(function (s) { return s.pitch; }).filter(function (x) { return x > 0; });
        if (p.length > 15) {
          var med = pct(p, 0.5), sts = p.map(function (x) { return 12 * Math.log(x / med) / Math.LN2; }).filter(function (x) { return Math.abs(x) <= 10; });
          var m = sts.reduce(function (a, b) { return a + b; }, 0) / sts.length;
          R.pitchStd = Math.sqrt(sts.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / sts.length);
        }
      }
    }
    var speakSec = Math.max(5, en - st); R.speakSec = speakSec;
    R.wpm = dur > 0 && n > 0 ? n / (speakSec / 60) : null;
    var sc = {};
    // қазақ тілінде сөздер ұзын (жалғаулы), сондықтан норма төмендеу: 80–120 сөз/мин
    if (R.wpm !== null) { var x = R.wpm; sc.tempo = clamp(x < 80 ? 100 - (80 - x) * 1.5 : x > 120 ? 100 - (x - 120) * 1.5 : 100); }
    sc.filler = clamp(100 - R.fillerPer100 * 13);
    sc.repeat = clamp(100 - R.repPer100 * 14);
    if (R.hasAudio && (R.pitchStd !== null || R.volCv !== null)) {
      var pp = R.pitchStd !== null ? clamp(R.pitchStd / 3.2 * 100) : 60, vv = R.volCv !== null ? clamp(R.volCv / 0.5 * 100) : 60, ppm = R.pauses / (speakSec / 60);
      var pa = R.pauses === 0 && speakSec > 20 ? 35 : clamp(ppm < 3 ? 60 + ppm * 13 : ppm > 14 ? 100 - (ppm - 14) * 6 : 100) - (R.longPauses ? R.longPauses * 8 : 0);
      sc.expr = clamp(pp * 0.5 + vv * 0.3 + clamp(pa) * 0.2);
    }
    R.scores = sc;
    var wt = { tempo: 0.25, filler: 0.28, repeat: 0.2, expr: 0.27 }, tw = 0, ts = 0;
    Object.keys(sc).forEach(function (k) { tw += wt[k]; ts += sc[k] * wt[k]; });
    R.overall = Math.round(ts / tw);
    R.recs = recs(R);
    return R;
  }
  function recs(R) {
    var a = [], s = R.scores;
    if (R.n < 25) a.push(['⚠️', 'Мәтін аз танылды, сондықтан баға шамамен. Ұзағырақ сөйлеп көр немесе микрофонға жақынырақ отыр.']);
    if (R.wpm !== null) {
      var w = Math.round(R.wpm);
      if (R.wpm > 125) a.push(['🐢', 'Сен жылдам сөйледің (минутына ' + w + ' сөз). Әр ойдың соңында дем алып, үзіліс жаса. Мақсат: 85–115.']);
      else if (R.wpm < 75) a.push(['🚀', 'Қарқын баяу (минутына ' + w + ' сөз). Тыңдаушы жалығып кетуі мүмкін. Сәл жылдамырақ сөйле, ұзақ ойланудан аулақ бол.']);
      else a.push(['👍', 'Қарқын жақсы: минутына ' + w + ' сөз. Тыңдаушыға жайлы.']);
    }
    if (R.fillerPer100 >= 3) {
      var top = Object.keys(R.fillers).sort(function (x, y) { return R.fillers[y] - R.fillers[x]; }).slice(0, 3).map(function (x) { return '«' + x + '»'; }).join(', ');
      a.push(['🔇', 'Паразит сөз көп: ' + top + '. Оның орнына 1 секундтық үзіліс жаса. Келесі жолы осы сөзді алдын ала есіңде ұста.']);
    } else if (R.fillerCount > 0) a.push(['✅', 'Паразит сөз аз (' + R.fillerCount + '). Мына сөздерге мұқият бол: ' + Object.keys(R.fillers).slice(0, 2).map(function (x) { return '«' + x + '»'; }).join(', ') + '.']);
    else a.push(['🏆', 'Паразит сөз кездеспеді. Тамаша!']);
    if (R.imm.length) a.push(['🔁', 'Қатар қайталанған сөздер: ' + Array.from(new Set(R.imm)).slice(0, 4).map(function (x) { return '«' + x + ' ' + x + '»'; }).join(', ') + '. Бұл толқудың белгісі. Дем алып, жалғастыр.']);
    if (R.over.length) a.push(['📚', 'Жиі қайталанған сөздер: ' + R.over.slice(0, 4).map(function (o) { return '«' + o.w + '» ×' + o.c; }).join(', ') + '. Синоним тап немесе сөйлемді басқаша құр.']);
    if (R.hasAudio && s.expr !== undefined) {
      if (R.pitchStd !== null && R.pitchStd < 2) a.push(['🎵', 'Дауысың біркелкі (монотонды). Сөйлемдегі басты сөзді дауыспен көтеріп айт, сұрақта интонацияны жоғарылат.']);
      if (R.pauses === 0 && R.speakSec > 20) a.push(['⏸', 'Үзіліс жоқтың қасы. Басты ойдың алдында және одан кейін үзіліс жаса, бұл назар аударады.']);
      if (R.longPauses > 1) a.push(['⏳', 'Ұзақ үзіліс ' + R.longPauses + ' рет болды (2,5 секундтан артық). Әр бөлімге тірек сөздер дайында.']);
      if (R.volCv !== null && R.volCv < 0.3) a.push(['🔊', 'Дауыс күші өзгермейді. Негізгі сөздерді қаттырақ, қосымша сөздерді тыныштау айт.']);
      if (s.expr >= 75) a.push(['🌟', 'Сөйлеуің көркем: дауыс тірі, үзілістер орнымен қойылған.']);
    }
    if (!R.hasAudio) a.push(['🎙', 'Қарқын мен интонацияны бағалау үшін дауысты микрофонмен жаз.']);
    a.push(['🎯', 'Келесі қадам: осы тақырыпты тағы бір рет жазып, ең әлсіз көрсеткішті жақсартып көр. Лира айырмасын көрсетеді.']);
    return a;
  }

  /* ---------- көрініс ---------- */
  function cls(v) { return v >= 75 ? 'good' : v >= 50 ? 'mid' : 'bad'; }
  function ring(v) {
    var r = 44, c = 2 * Math.PI * r, col = v >= 75 ? '#5f7a3a' : v >= 50 ? '#c9a24a' : '#b65a36';
    return '<svg class="ring" viewBox="0 0 110 110"><circle cx="55" cy="55" r="' + r + '" fill="none" stroke="#ece2c8" stroke-width="10"/><circle cx="55" cy="55" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + (c * v / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 55 55)"/><text x="55" y="64" text-anchor="middle">' + v + '</text></svg>';
  }
  function metric(name, score, val, hint) {
    if (score === undefined) return '<div class="lm"><b>' + name + '</b> <span class="muted">деректер жоқ</span><div class="muted">' + hint + '</div></div>';
    return '<div class="lm ' + cls(score) + '"><div class="lmh"><b>' + name + '</b><span>' + val + '</span></div><div class="lbar"><i style="width:' + Math.max(4, score) + '%"></i></div><div class="muted">' + hint + '</div></div>';
  }
  function highlight(R) {
    var t = esc(R.text);
    var keys = FILL2.concat(FILL1).sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('(^|[^а-яәіңғүұқөһА-ЯӘІҢҒҮҰҚӨҺёЁa-z])(' + keys.join('|') + ')(?=[^а-яәіңғүұқөһА-ЯӘІҢҒҮҰҚӨҺёЁa-z]|$)', 'gi');
    return t.replace(re, function (m, a, b) { return a + '<mark class="lf">' + b + '</mark>'; });
  }
  function compare(R, prev) {
    if (!prev) return '';
    var rows = [['Жалпы баға', R.overall, prev.overall], ['Паразит сөз', R.scores.filler, prev.scores.filler], ['Қайталау', R.scores.repeat, prev.scores.repeat]];
    if (R.scores.tempo !== undefined && prev.scores.tempo !== undefined) rows.push(['Қарқын', R.scores.tempo, prev.scores.tempo]);
    if (R.scores.expr !== undefined && prev.scores.expr !== undefined) rows.push(['Көркемдік', R.scores.expr, prev.scores.expr]);
    var body = rows.map(function (r) { var d = Math.round(r[1] - r[2]); return '<span>' + r[0] + '</span><span>' + Math.round(r[2]) + ' → <b>' + Math.round(r[1]) + '</b></span><span class="' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + (d > 0 ? '▲ +' + d : d < 0 ? '▼ ' + d : '=') + '</span>'; }).join('');
    return '<div class="card"><h2>📊 Өткен әрекетпен салыстыру</h2><div class="muted" style="margin-bottom:8px">Тақырып: ' + esc(prev.topic) + '</div><div class="lcmp">' + body + '</div></div>';
  }

  function pageHtml() {
    var h = '<div class="wrap"><section class="hero lira-hero"><div class="in"><div class="eyebrow">Лира · сөйлеу көмекшісі</div><h1>Сенімді <em>сөйле.</em></h1><p>Тақырып таңда, микрофонды басып сөйле. Лира қарқыныңды, паразит сөздеріңді, қайталауларыңды, интонацияңды талдап, қазақша кеңес береді.</p></div></section>' +
      '<div id="liraBox"></div></div>';
    return h;
  }

  function homeView() {
    var h = '<div class="card"><h2>1. Тақырып таңда</h2><div class="ltopics">' +
      TOPICS.map(function (t, i) { return '<button class="ltopic' + (S.sel === i ? ' sel' : '') + '" data-i="' + i + '">' + esc(t) + '</button>'; }).join('') +
      '</div><input type="text" id="lCustom" class="linput" placeholder="Немесе өз тақырыбыңды жаз"></div>' +
      '<div class="card"><h2>2. Қанша сөйлейміз?</h2><div class="lchips">' +
      [[60, '1 минут'], [120, '2 минут'], [180, '3 минут']].map(function (g) { return '<button class="lchip' + (S.goal === g[0] ? ' sel' : '') + '" data-s="' + g[0] + '">' + g[1] + '</button>'; }).join('') +
      '</div>';
    if (kkVoice()) h += '<label class="lchk"><input type="checkbox" id="lVoice" checked> Лира қорытындыны дауыспен айтады</label>';
    h += '</div>';
    h += SR ? '<div class="note">✅ Дауыс сөзге айналып, браузерде талданады. Chrome сөзді тану үшін Google қызметін пайдаланады, сондықтан интернет керек. Браузер сұрағанда микрофонға рұқсат бер.</div>'
      : '<div class="note warn">⚠️ Бұл браузер сөзді танымайды. Google Chrome-да ашыңыз. Қазір мәтінді тексеруге болады.</div>';
    h += '<div class="row"><button class="btn rec" id="lStart">🎙 Жазуды бастау</button><button class="btn alt" id="lText">✍️ Микрофонсыз: мәтінді тексеру</button></div>';
    return h;
  }
  function textView() {
    return '<div class="card"><h2>Сөйлеу мәтінін тексеру</h2><p class="muted">Дауыстап айтатын мәтініңді қой. Лира паразит сөздер мен қайталауды табады. Қарқын мен интонация тек дауыс жазбасы арқылы бағаланады.</p><textarea id="lIn" class="linput" style="min-height:150px" placeholder="Мәтінді осында қой…"></textarea></div>' +
      '<div class="row"><button class="btn" id="lGo">Талдау</button><button class="btn alt" id="lBack">Артқа</button></div>';
  }
  function recView() {
    return '<div class="card"><div class="topicline"><b>Тақырып:</b> ' + esc(S.topic) + '</div><div class="ltimer" id="lTimer">00:00</div><div class="lgoal"><i id="lGoal"></i></div>' +
      '<div class="meter"><div id="lMeter"></div></div><div class="llive" id="lLive"><em>Сөйле, мен жазып жатырмын…</em></div></div>' +
      '<div class="row"><button class="btn rec" id="lStop">⏹ Аяқтау және талдау</button><button class="btn alt" id="lCancel">Бас тарту</button></div>';
  }

  function show(html) { var b = $('#liraBox'); if (b) { b.innerHTML = html; window.scrollTo(0, 0); } }
  function showHome() { show(homeView()); bindHome(); }

  function bindHome() {
    document.querySelectorAll('.ltopic').forEach(function (b) { b.onclick = function () { S.sel = +b.dataset.i; S.topic = TOPICS[S.sel]; showHome(); }; });
    document.querySelectorAll('.lchip').forEach(function (b) { b.onclick = function () { S.goal = +b.dataset.s; showHome(); }; });
    var c = $('#lCustom'); if (c) c.oninput = function () { var v = c.value.trim(); if (v) { S.topic = v; S.sel = -1; document.querySelectorAll('.ltopic').forEach(function (x) { x.classList.remove('sel'); }); } };
    $('#lStart').onclick = startRec;
    $('#lText').onclick = function () {
      show(textView());
      $('#lBack').onclick = showHome;
      $('#lGo').onclick = function () {
        var t = $('#lIn').value.trim();
        if (t.split(/\s+/).length < 15) { alert('Кемінде 15 сөз жаз немесе қой.'); return; }
        finish(analyze(t, 0, []));
      };
    };
  }

  /* ---------- жазу ---------- */
  function startRec() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert('Микрофон қолжетімсіз. Сайтты https:// арқылы Chrome-да ашыңыз.'); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var AC = window.AudioContext || window.webkitAudioContext, actx = new AC();
      var src = actx.createMediaStreamSource(stream), an = actx.createAnalyser(); an.fftSize = 2048; src.connect(an);
      S.stream = stream; S.actx = actx; S.an = an; S.samples = []; S.last = 0; S.recording = true; S.t0 = performance.now();
      show(recView());
      S.rec = startRecognizer();
      S.rec.onupdate = function (t) { var el = $('#lLive'); if (el) { el.textContent = t.trim() || '…'; el.scrollTop = el.scrollHeight; } };
      if (!SR) { var el0 = $('#lLive'); if (el0) el0.innerHTML = '<em>Мәтін танылмайды, бірақ дауыс талданады.</em>'; }
      S.timer = setInterval(function () {
        var t = (performance.now() - S.t0) / 1000, e = $('#lTimer'); if (e) e.textContent = fmt(t);
        var g = $('#lGoal'); if (g) g.style.width = Math.min(100, t / S.goal * 100) + '%';
      }, 250);
      $('#lStop').onclick = stopAndAnalyze;
      $('#lCancel').onclick = function () { stopMedia(); showHome(); };
      loop();
    }).catch(function () { alert('Микрофонға рұқсат берілмеді. Сайт параметрлерінде рұқсат беріп, қайта көр.'); });
  }
  function pitchOf(buf, sr) {
    var n = buf.length, e0 = 0, i, l;
    for (i = 0; i < n; i++) e0 += buf[i] * buf[i];
    if (Math.sqrt(e0 / n) < 0.012) return 0;
    var minL = Math.floor(sr / 400), maxL = Math.floor(sr / 70), best = 0, bl = 0;
    for (l = minL; l <= maxL; l++) { var s = 0; for (i = 0; i < n - l; i++) s += buf[i] * buf[i + l]; if (s > best) { best = s; bl = l; } }
    if (!bl || best / e0 < 0.35) return 0;
    return sr / bl;
  }
  function loop() {
    if (!S.recording) return;
    S.raf = requestAnimationFrame(loop);
    var buf = new Float32Array(S.an.fftSize); S.an.getFloatTimeDomainData(buf);
    var sum = 0; for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    var rms = Math.sqrt(sum / buf.length), now = performance.now();
    if (now - S.last >= 90) { S.last = now; S.samples.push({ t: (now - S.t0) / 1000, rms: rms, pitch: pitchOf(buf, S.actx.sampleRate) }); }
    var m = $('#lMeter'); if (m) m.style.width = Math.round(Math.min(1, rms * 4) * 100) + '%';
  }
  function stopMedia() {
    S.recording = false; cancelAnimationFrame(S.raf); clearInterval(S.timer);
    try { S.stream && S.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ештеңе */ }
    try { S.actx && S.actx.close(); } catch (e) { /* ештеңе */ }
    var t = stopRecognizer(S.rec); S.rec = null; return t;
  }
  function stopAndAnalyze() {
    var dur = (performance.now() - S.t0) / 1000, samples = S.samples;
    var lv = $('#lLive'); if (lv) lv.innerHTML = '<em>Лира жазбаңды тыңдап, санап жатыр…</em>';
    var text = stopMedia();
    setTimeout(function () {
      if (dur < 5) { alert('Жазба тым қысқа. Бірнеше сөйлем айт.'); showHome(); return; }
      finish(analyze(text, dur, samples));
    }, 900);
  }

  /* ---------- нәтиже ---------- */
  function finish(R) {
    var H = loadH(), prev = H.length ? H[H.length - 1] : null;
    H.push({ ts: R.ts, topic: R.topic, overall: R.overall, scores: R.scores, wpm: R.wpm }); saveH(H);
    var s = R.scores;
    var verdict = R.overall >= 80 ? 'Тамаша сөйлеу!' : R.overall >= 65 ? 'Жақсы нәтиже, жақсартуға болады' : R.overall >= 45 ? 'Жаман емес бастама, жаттығайық' : 'Жаттығу керек, сен істей аласың';
    var fillTags = Object.keys(R.fillers).sort(function (a, b) { return R.fillers[b] - R.fillers[a]; }).map(function (k) { return '<span class="ltag">' + esc(k) + ' ×' + R.fillers[k] + '</span>'; }).join('');
    var overTags = R.over.map(function (o) { return '<span class="ltag o">' + esc(o.w) + ' ×' + o.c + '</span>'; }).join('');
    var h = '<div class="card lira-card"><div class="lbubble"><span class="lorb">🎙</span><div><b>Лира:</b> ' + esc(summaryText(R)) + '</div></div>' + VOICE_HELP + '<div class="row" style="margin-top:10px"><button class="btn alt" id="lSpeak">🔊 Лира айтады</button></div></div>' +
      '<div class="card"><div class="score">' + ring(R.overall) + '<div class="bars"><h2 style="margin:0">' + verdict + '</h2><div class="muted">' + esc(R.topic) + '<br>' + (R.dur ? fmt(R.dur) + ' · ' : '') + R.n + ' сөз</div></div></div></div>' +
      '<div class="card"><h2>Сөйлеуіңнің талдауы</h2>' +
      metric('Сөйлеу қарқыны', s.tempo, R.wpm !== null ? Math.round(R.wpm) + ' сөз/мин' : '', 'Норма: 80–120 сөз минутына') +
      metric('Паразит сөздер', s.filler, R.fillerCount + ' дана (100 сөзге ' + R.fillerPer100.toFixed(1) + ')', 'Жақсы: 100 сөзге 2-ден аз') + (fillTags ? '<div class="ltags">' + fillTags + '</div>' : '') +
      metric('Қайталаулар', s.repeat, (R.imm.length + R.over.length) + ' табылды', 'Қатар қайталанған және жиі айтылған сөздер') + (overTags ? '<div class="ltags">' + overTags + '</div>' : '') +
      metric('Көркемдік (интонация, дауыс күші, үзіліс)', s.expr, s.expr !== undefined ? Math.round(s.expr) + '/100' : '', 'Интонация, дауыс күші және үзіліс' + (R.hasAudio ? ' · үзіліс: ' + R.pauses : '')) + '</div>' +
      '<div class="card lira-card"><h2>💡 Лираның кеңестері</h2>' + R.recs.map(function (r) { return '<div class="lrec"><span>' + r[0] + '</span><span>' + esc(r[1]) + '</span></div>'; }).join('') + '</div>' +
      compare(R, prev) +
      '<div class="card"><h2>Сөйлеу мәтіні</h2><div class="muted" style="margin-bottom:6px"><mark class="lf">паразит сөздер</mark></div><div class="ltr">' + (R.text ? highlight(R) : '<span class="muted">Мәтін танылмады. Chrome-да, микрофонға жақынырақ сөйлеп көр.</span>') + '</div></div>' +
      '<div class="row"><button class="btn rec" id="lAgain">🔁 Қайта жазып салыстыру</button>' + '<button class="btn alt" id="lHome">Басына оралу</button></div>';
    show(h);
    $('#lAgain').onclick = startRec; $('#lHome').onclick = showHome;
    var sp = $('#lSpeak'); if (sp) sp.onclick = function () { speakSummary(R); };
    var v = $('#lVoice'); // (басты экранда ғана болады)
    setTimeout(function () { speakSummary(R); }, 600);
  }
  function speakSummary(R) {
    say(summaryText(R));
  }

  function init() { S.recording = false; showHome(); if (window.speechSynthesis) speechSynthesis.getVoices(); }
  function stop() { if (S.recording) stopMedia(); }

  window.Lira = { say: say, voiceHelp: VOICE_HELP, pageHtml: pageHtml, init: init, stop: stop, startRecognizer: startRecognizer, stopRecognizer: stopRecognizer, poemMatchHtml: poemMatchHtml, poemMatch: poemMatch, supported: !!SR, analyze: analyze };
})();
