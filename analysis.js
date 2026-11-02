/* Дауыс талдауы: үлгі оқуды және оқушының дауысын салыстырады.
   Ырғақ (дыбыс күшінің өзгеруі), интонация (дауыс биіктігінің қисығы),
   қарқын (жалпы ұзақтық) және паузаларды өлшейді.
   Сөздерді тану жоқ: сөздің дұрыс айтылғанын тексермейді. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceAnalysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TARGET_SR = 8000;
  var HOP_SEC = 0.010;
  var FRAME_SEC = 0.040;
  var POINTS = 80;

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function percentile(arr, p) {
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var idx = Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))));
    return a[idx];
  }

  function median(arr) { return percentile(arr, 0.5); }

  function decimate(samples, sr) {
    var f = Math.max(1, Math.round(sr / TARGET_SR));
    var n = Math.floor(samples.length / f);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var k = 0; k < f; k++) s += samples[i * f + k];
      out[i] = s / f;
    }
    return { data: out, sr: sr / f };
  }

  function extractFeatures(samples, sr) {
    var d = decimate(samples, sr);
    var data = d.data, fs = d.sr;
    var frameLen = Math.round(fs * FRAME_SEC);
    var hop = Math.round(fs * HOP_SEC);
    var n = Math.max(0, Math.floor((data.length - frameLen) / hop) + 1);
    var energy = new Float32Array(n);
    var pitch = new Float32Array(n);
    var i, j;
    for (i = 0; i < n; i++) {
      var st = i * hop, e = 0;
      for (j = 0; j < frameLen; j++) { var v = data[st + j]; e += v * v; }
      energy[i] = Math.sqrt(e / frameLen);
    }
    var noise = percentile(energy, 0.1);
    var peak = percentile(energy, 0.95);
    var thr = Math.max(noise * 3, peak * 0.1);
    var minLag = Math.floor(fs / 400), maxLag = Math.ceil(fs / 70);
    var r = new Float32Array(maxLag + 2);
    var x = new Float32Array(frameLen);
    for (i = 0; i < n; i++) {
      if (energy[i] <= thr) continue;
      var start = i * hop, mean = 0;
      for (j = 0; j < frameLen; j++) mean += data[start + j];
      mean /= frameLen;
      for (j = 0; j < frameLen; j++) x[j] = data[start + j] - mean;
      var mx = -1;
      for (var lag = minLag - 1; lag <= maxLag + 1 && lag < frameLen - 8; lag++) {
        var num = 0, a2 = 0, b2 = 0;
        for (j = 0; j < frameLen - lag; j++) {
          num += x[j] * x[j + lag];
          a2 += x[j] * x[j];
          b2 += x[j + lag] * x[j + lag];
        }
        var den = Math.sqrt(a2 * b2) || 1e-9;
        r[lag] = num / den;
        if (lag >= minLag && lag <= maxLag && r[lag] > mx) mx = r[lag];
      }
      if (mx < 0.5) continue;
      var best = -1;
      for (lag = minLag; lag <= maxLag; lag++) {
        if (r[lag] >= 0.85 * mx && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { best = lag; break; }
      }
      if (best > 0) pitch[i] = fs / best;
    }
    return { hop: HOP_SEC, energy: energy, pitch: pitch, thr: thr, n: n, peak: peak };
  }

  function segments(feat) {
    var n = feat.n, act = new Uint8Array(n), i, j;
    for (i = 0; i < n; i++) act[i] = feat.energy[i] > feat.thr ? 1 : 0;
    // қысқа үзілістерді жабу (дауыссыз дыбыстар, тоқтау)
    i = 0;
    while (i < n) {
      if (!act[i]) {
        j = i;
        while (j < n && !act[j]) j++;
        if (i > 0 && j < n && (j - i) < 12) for (var k = i; k < j; k++) act[k] = 1;
        i = j;
      } else i++;
    }
    // өте қысқа дыбыс «шоқтарын» алып тастау
    i = 0;
    while (i < n) {
      if (act[i]) {
        j = i;
        while (j < n && act[j]) j++;
        if ((j - i) < 6) for (var k2 = i; k2 < j; k2++) act[k2] = 0;
        i = j;
      } else i++;
    }
    var first = -1, last = -1;
    for (i = 0; i < n; i++) if (act[i]) { if (first < 0) first = i; last = i; }
    if (first < 0) return { start: 0, end: -1, len: 0, durSec: 0, pauses: [], act: act };
    var pauses = [];
    i = first;
    while (i <= last) {
      if (!act[i]) {
        j = i;
        while (j <= last && !act[j]) j++;
        if ((j - i) >= 25) pauses.push({ startF: i, endF: j - 1, dur: (j - i) * HOP_SEC });
        i = j;
      } else i++;
    }
    var len = last - first + 1;
    pauses.forEach(function (p) {
      p.frac = ((p.startF + p.endF) / 2 - first) / len;
      p.t = (((p.startF + p.endF) / 2) - first) * HOP_SEC;
    });
    return { start: first, end: last, len: len, durSec: len * HOP_SEC, pauses: pauses, act: act };
  }

  function smoothArr(a, k) {
    var out = new Float32Array(a.length), h = Math.floor(k / 2);
    for (var i = 0; i < a.length; i++) {
      var s = 0, c = 0;
      for (var j = i - h; j <= i + h; j++) if (j >= 0 && j < a.length) { s += a[j]; c++; }
      out[i] = s / c;
    }
    return out;
  }

  function medianSmooth(a, k) {
    var out = new Float32Array(a.length), h = Math.floor(k / 2);
    for (var i = 0; i < a.length; i++) {
      var w = [];
      for (var j = i - h; j <= i + h; j++) if (j >= 0 && j < a.length) w.push(a[j]);
      out[i] = median(w);
    }
    return out;
  }

  function resample(a, N) {
    var out = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var s = Math.floor(i * a.length / N), e = Math.max(s + 1, Math.floor((i + 1) * a.length / N));
      var sum = 0, c = 0;
      for (var j = s; j < e && j < a.length; j++) { sum += a[j]; c++; }
      out[i] = c ? sum / c : 0;
    }
    return out;
  }

  function contourOf(feat, seg) {
    var len = seg.len;
    if (len < 30) return null;
    var voiced = [], i;
    for (i = seg.start; i <= seg.end; i++) if (feat.pitch[i] > 0) voiced.push(feat.pitch[i]);
    if (voiced.length < 15) return null;
    var med = median(voiced);
    var st = new Float32Array(len), known = new Uint8Array(len);
    for (i = 0; i < len; i++) {
      var f = feat.pitch[seg.start + i];
      if (f > 0) { st[i] = 12 * Math.log(f / med) / Math.LN2; known[i] = 1; }
    }
    // бос орындарды сызықтық толтыру
    var prev = -1;
    for (i = 0; i < len; i++) {
      if (known[i]) {
        if (prev < 0) for (var a = 0; a < i; a++) st[a] = st[i];
        else if (i - prev > 1) for (var b = prev + 1; b < i; b++) st[b] = st[prev] + (st[i] - st[prev]) * (b - prev) / (i - prev);
        prev = i;
      }
    }
    for (i = prev + 1; i < len; i++) st[i] = st[prev];
    var sm = smoothArr(medianSmooth(st, 7), 7);
    var vs = [];
    for (i = 0; i < len; i++) if (known[i]) vs.push(sm[i]);
    var range = percentile(vs, 0.9) - percentile(vs, 0.1);
    var res = resample(sm, POINTS);
    var mean = 0;
    for (i = 0; i < POINTS; i++) mean += res[i];
    mean /= POINTS;
    for (i = 0; i < POINTS; i++) res[i] -= mean;
    return { contour: res, range: range, voicedFrac: voiced.length / len };
  }

  function envelopeOf(feat, seg) {
    var len = seg.len, arr = new Float32Array(len), i;
    for (i = 0; i < len; i++) arr[i] = 20 * Math.log(Math.max(feat.energy[seg.start + i], 1e-5)) / Math.LN10;
    var res = resample(smoothArr(arr, 5), POINTS);
    var m = 0, s = 0;
    for (i = 0; i < POINTS; i++) m += res[i];
    m /= POINTS;
    for (i = 0; i < POINTS; i++) s += (res[i] - m) * (res[i] - m);
    s = Math.sqrt(s / POINTS) || 1;
    for (i = 0; i < POINTS; i++) res[i] = (res[i] - m) / s;
    return res;
  }

  function dtwMean(a, b, band) {
    var n = a.length, m = b.length, INF = 1e9, i, j;
    var D = [], L = [];
    for (i = 0; i < n; i++) { D.push(new Float32Array(m).fill(INF)); L.push(new Float32Array(m)); }
    for (i = 0; i < n; i++) {
      var j0 = Math.max(0, i - band), j1 = Math.min(m - 1, i + band);
      for (j = j0; j <= j1; j++) {
        var c = Math.abs(a[i] - b[j]);
        if (i === 0 && j === 0) { D[i][j] = c; L[i][j] = 1; continue; }
        var best = INF, bl = 1;
        if (i > 0 && D[i - 1][j] < best) { best = D[i - 1][j]; bl = L[i - 1][j]; }
        if (j > 0 && D[i][j - 1] < best) { best = D[i][j - 1]; bl = L[i][j - 1]; }
        if (i > 0 && j > 0 && D[i - 1][j - 1] <= best) { best = D[i - 1][j - 1]; bl = L[i - 1][j - 1]; }
        if (best >= INF) continue;
        D[i][j] = best + c;
        L[i][j] = bl + 1;
      }
    }
    return D[n - 1][m - 1] / (L[n - 1][m - 1] || 1);
  }

  function matchPauses(refP, stuP) {
    var used = new Array(stuP.length).fill(false), matched = 0, missing = [];
    refP.forEach(function (rp) {
      var bi = -1, bd = 0.08;
      stuP.forEach(function (sp, k) {
        var d = Math.abs(sp.frac - rp.frac);
        if (!used[k] && d <= bd) { bd = d; bi = k; }
      });
      if (bi >= 0) { used[bi] = true; matched++; } else missing.push(rp);
    });
    var extra = stuP.filter(function (_, k) { return !used[k]; });
    return { matched: matched, missing: missing, extra: extra };
  }

  function fmtSec(t) { return Math.round(t * 10) / 10; }

  function compare(refSamples, refSr, stuSamples, stuSr) {
    var rf = extractFeatures(refSamples, refSr);
    var sf = extractFeatures(stuSamples, stuSr);
    var rs = segments(rf), ss = segments(sf);
    if (stuSamples.length / stuSr < 1.0) return { error: 'short' };
    if (sf.peak < 0.004) return { error: 'quiet' };
    if (ss.len < 60) return { error: 'nospeech' };
    if (rs.len < 60) return { error: 'ref' };

    var ratio = ss.durSec / rs.durSec;
    var tempo = Math.round(100 * clamp01(1 - Math.abs(Math.log(ratio)) / Math.log(1.6)));

    var pm = matchPauses(rs.pauses, ss.pauses);
    var pauseScore = (rs.pauses.length === 0 && ss.pauses.length === 0) ? 100
      : Math.round(100 * pm.matched / Math.max(rs.pauses.length, ss.pauses.length, 1));

    var renv = envelopeOf(rf, rs), senv = envelopeOf(sf, ss);
    var rd = dtwMean(renv, senv, 12);
    var rhythm = Math.round(100 * clamp01(1 - rd / 0.95));

    var rc = contourOf(rf, rs), sc = contourOf(sf, ss);
    var intonation = null, rangeRatio = null, cd = null;
    if (rc && sc) {
      cd = dtwMean(rc.contour, sc.contour, 12);
      intonation = Math.round(100 * clamp01(1 - cd / 2.5));
      rangeRatio = sc.range / Math.max(rc.range, 0.5);
    }

    var total = intonation === null
      ? Math.round(0.45 * rhythm + 0.25 * tempo + 0.30 * pauseScore)
      : Math.round(0.30 * rhythm + 0.30 * intonation + 0.20 * tempo + 0.20 * pauseScore);

    var tips = [];
    if (ratio > 1.25) tips.push('Сіз үлгіден баяулау оқыдыңыз (шамамен ' + Math.round((ratio - 1) * 100) + '% ұзағырақ). Сөздерді байланыстырып, сәл жылдамдау оқып көріңіз.');
    else if (ratio < 0.8) tips.push('Сіз үлгіден жылдамырақ оқыдыңыз (шамамен ' + Math.round((1 - ratio) * 100) + '% қысқа). Асықпай, мағынасын ойлап оқыңыз.');
    else tips.push('Оқу қарқыныңыз үлгіге жақын, жарайсыз!');

    pm.missing.slice(0, 2).forEach(function (p) {
      tips.push('Үлгіде шамамен ' + fmtSec(p.t) + '-секундта үзіліс бар, сізде жоқ. Ойды аяқтап, тыныс алыңыз.');
    });
    pm.extra.slice(0, 2).forEach(function (p) {
      tips.push('Сізде шамамен ' + fmtSec(p.t) + '-секундта артық үзіліс бар. Ойды бөліп тастамай, байланыстырып оқыңыз.');
    });
    if (rangeRatio !== null) {
      if (rangeRatio < 0.5) tips.push('Дауысыңыз біркелкі (монотонды) шықты. Логикалық екпін түскен сөздерде дауысты көтеріп көріңіз.');
      else if (rangeRatio > 1.9) tips.push('Дауыс ырғағыңыз үлгіден асыра көтерілді. Сабырлырақ айтып көріңіз.');
    }
    if (rhythm < 50) tips.push('Ырғақ үлгіден өзгеше: екпін түсетін сөздерді күштірек айтып, қалғандарын жеңіл айтыңыз.');
    if (intonation === null) tips.push('Дауыс биіктігін анық ажырата алмадым. Тыныш жерде, микрофонға жақынырақ оқып қайталаңыз.');
    else if (intonation < 50) tips.push('Интонация үлгіден өзгеше: өлеңнің қай жерінде дауыс көтеріліп, қай жерінде төмендейтінін үлгіні тыңдап байқаңыз.');
    if (tips.length === 1 && total >= 80) tips.push('Тамаша! Енді картасыз және партитурасыз оқып көріңіз.');

    return {
      total: total, rhythm: rhythm, intonation: intonation, tempo: tempo, pauses: pauseScore,
      ratio: ratio, tips: tips.slice(0, 5),
      vis: {
        refContour: rc ? Array.prototype.slice.call(rc.contour) : null,
        stuContour: sc ? Array.prototype.slice.call(sc.contour) : null,
        refEnv: Array.prototype.slice.call(renv),
        stuEnv: Array.prototype.slice.call(senv),
        refPauses: rs.pauses.map(function (p) { return p.frac; }),
        stuPauses: ss.pauses.map(function (p) { return p.frac; })
      }
    };
  }

  /* Үлгі аудио жоқ кезде: оқушының жазбасын өлең мәтініне қарай талдау.
     info = { syllables: буын саны, lines: жол саны } */
  function solo(stuSamples, stuSr, info) {
    var sf = extractFeatures(stuSamples, stuSr);
    var ss = segments(sf);
    if (stuSamples.length / stuSr < 1.0) return { error: 'short' };
    if (sf.peak < 0.004) return { error: 'quiet' };
    if (ss.len < 60) return { error: 'nospeech' };
    var total = ss.durSec + 0; // дауыс бар аралық
    var syl = Math.max(info && info.syllables || 0, 1), lines = Math.max(info && info.lines || 1, 1);
    var rate = syl / total;
    var tempo = Math.round(100 * (rate >= 3 && rate <= 5.2 ? 1 : rate < 3 ? clamp01((rate - 1.5) / 1.5) : clamp01((8 - rate) / 2.8)));
    // паузалар
    var cnt = ss.pauses.length, exp = Math.max(lines - 1, 1);
    var dev = Math.abs(cnt - exp) / exp;
    var pauseScore = Math.round(100 * clamp01(1 - Math.max(0, dev - 0.25) / 0.75));
    // ырғақ: жолдар (үзілістер арасындағы бөліктер) ұзақтығының тұрақтылығы
    var chunks = [], prev = ss.start;
    ss.pauses.forEach(function (p) { chunks.push((p.startF - prev) * HOP_SEC); prev = p.endF + 1; });
    chunks.push((ss.end - prev + 1) * HOP_SEC);
    chunks = chunks.filter(function (c) { return c > 0.3; });
    var cv = null, rhythm;
    if (chunks.length >= 3) {
      var m = 0, s = 0; chunks.forEach(function (c) { m += c; }); m /= chunks.length;
      chunks.forEach(function (c) { s += (c - m) * (c - m); }); cv = Math.sqrt(s / chunks.length) / m;
      rhythm = Math.round(100 * clamp01(1 - Math.max(0, cv - 0.2) / 0.6));
    } else rhythm = Math.round(40 + 20 * clamp01(chunks.length / 2));
    // интонация
    var sc = contourOf(sf, ss), intonation = null, range = null;
    if (sc) {
      range = sc.range;
      intonation = Math.round(100 * (range < 4 ? clamp01(range / 4) : range <= 11 ? 1 : clamp01(1 - (range - 11) / 8)));
    }
    var totalScore = intonation === null
      ? Math.round(0.4 * rhythm + 0.3 * tempo + 0.3 * pauseScore)
      : Math.round(0.25 * rhythm + 0.3 * intonation + 0.25 * tempo + 0.2 * pauseScore);
    var tips = [];
    if (rate < 3) tips.push('Қарқын баяу: шамамен ' + (Math.round(rate * 10) / 10) + ' буын/сек. Сөздерді байланыстырып, сәл жылдамдау оқыңыз.');
    else if (rate > 5.2) tips.push('Қарқын тым жылдам: шамамен ' + (Math.round(rate * 10) / 10) + ' буын/сек. Асықпай, мағынасын ойлап оқыңыз.');
    else tips.push('Оқу қарқыныңыз өлеңге лайық, жарайсыз!');
    if (cnt < exp * 0.75) tips.push('Үзіліс аз болды (' + cnt + '). Әр жолдың соңында қысқа тыныс алып, ойды бөліп оқыңыз.');
    else if (cnt > exp * 1.25) tips.push('Үзіліс көп болды (' + cnt + '). Жолдарды ойға қарай байланыстырып оқыңыз.');
    else tips.push('Паузаларыңыз жолдарға сай орналасты.');
    if (range !== null) {
      if (range < 3) tips.push('Дауысыңыз біркелкі (монотонды) шықты. Негізгі сөздерде дауысты көтеріп, жол соңында түсіріп көріңіз.');
      else if (range > 13) tips.push('Дауыс өте көп секірді. Сабырлырақ, жұмсағырақ айтып көріңіз.');
      else tips.push('Интонацияңыз жандуы: дауыс биіктігі жақсы өзгерді.');
    } else tips.push('Дауыс биіктігін анық ажырата алмадым. Тыныш жерде, микрофонға жақынырақ қайталаңыз.');
    if (cv !== null && cv > 0.5) tips.push('Жолдардың ұзақтығы бірдей емес: ырғақ тұрақсыз. Әр жолды бірдей қарқынмен оқып көріңіз.');
    if (totalScore >= 80) tips.push('Тамаша! Енді картасыз және партитурасыз оқып көріңіз.');
    return {
      solo: true, total: totalScore, rhythm: rhythm, intonation: intonation, tempo: tempo, pauses: pauseScore,
      rate: rate, tips: tips.slice(0, 5),
      vis: {
        refContour: null, refEnv: null,
        stuContour: sc ? Array.prototype.slice.call(sc.contour) : null,
        stuEnv: Array.prototype.slice.call(envelopeOf(sf, ss)),
        refPauses: [], stuPauses: ss.pauses.map(function (p) { return p.frac; })
      }
    };
  }

  return { compare: compare, solo: solo, extractFeatures: extractFeatures, segments: segments };
});
