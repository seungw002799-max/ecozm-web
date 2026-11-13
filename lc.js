/* 토지피복지도: 환경공간정보서비스(기후에너지환경부) 토지피복지도 WFS(벡터)로 사업지구 안 분류별 면적을 계산하고,
 * 대·중·세분류 표준 색으로 지도와 도면에 표시. 발주처 면적으로 보정. target.js·meas.js 와 같은 방식(탭 안 출력). */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const PROXY = 'https://ecozm-proxy.seungw002799.workers.dev/?url=';
  const BASE = 'https://api.mcee.go.kr/geoserver/ows';
  // 환경공간정보서비스 기본 스타일(SLD)과 같은 색
  const L3 = { 111: ['단독주거시설', '#FEE6C2'], 112: ['공동주거시설', '#E9C16F'], 121: ['공업시설', '#C08484'], 131: ['상업·업무시설', '#ED83B8'], 132: ['혼합지역', '#DFB0A4'],
    141: ['문화·체육·휴양시설', '#F6718A'], 151: ['공항', '#E526FE'], 152: ['항만', '#C53251'], 153: ['철도', '#FC044E'], 154: ['도로', '#F7412A'], 155: ['기타 교통·통신시설', '#BE0000'],
    161: ['환경기초시설', '#F67512'], 162: ['교육·행정시설', '#FF7A00'], 163: ['기타 공공시설', '#C7581B'],
    211: ['경지정리가 된 논', '#FFFFBF'], 212: ['경지정리가 안 된 논', '#F4E6A8'], 221: ['경지정리가 된 밭', '#F7F966'], 222: ['경지정리가 안 된 밭', '#F5E40A'], 231: ['시설재배지', '#DFDC73'],
    241: ['과수원', '#B8B12C'], 251: ['목장·양식장', '#B89112'], 252: ['기타재배지', '#AA6400'],
    311: ['활엽수림', '#33A02C'], 321: ['침엽수림', '#0A4F40'], 331: ['혼효림', '#336633'],
    411: ['자연초지', '#A1D594'], 421: ['골프장', '#80E45A'], 422: ['묘지', '#71B05A'], 423: ['기타초지', '#607E33'],
    511: ['내륙습지', '#B4A7D0'], 521: ['갯벌', '#997499'], 522: ['염전', '#7C1EA2'],
    611: ['해변', '#C1DBEC'], 612: ['강기슭', '#ABC5CA'], 613: ['암벽·바위', '#ABB6A5'], 621: ['채광지역', '#585A8A'], 622: ['운동장', '#7BB5AC'], 623: ['기타나지', '#9FF2FF'],
    711: ['하천', '#3EA7FF'], 712: ['호소', '#5D6DFF'], 721: ['해양수', '#1739FF'] };
  const L2 = { 110: ['주거지역', '#FEE6C2'], 120: ['공업지역', '#C08484'], 130: ['상업지역', '#ED83B8'], 140: ['문화·체육·휴양지역', '#F6718A'], 150: ['교통지역', '#F7412A'], 160: ['공공시설지역', '#F6B112'],
    210: ['논', '#FFFFBF'], 220: ['밭', '#F7F966'], 230: ['시설재배지', '#DFDC73'], 240: ['과수원', '#B8B12C'], 250: ['기타재배지', '#B89112'],
    310: ['활엽수림', '#33A02C'], 320: ['침엽수림', '#0A4F40'], 330: ['혼효림', '#336633'], 410: ['자연초지', '#A1D594'], 420: ['인공초지', '#607E33'],
    510: ['내륙습지', '#B4A7D0'], 520: ['연안습지', '#997499'], 610: ['자연나지', '#C1DBEC'], 620: ['인공나지', '#9FF2FF'], 710: ['내륙수', '#3EA7FF'], 720: ['해양수', '#1739FF'] };
  const L1 = { 100: ['시가화·건조지역', '#FF0000'], 200: ['농업지역', '#EEE907'], 300: ['산림지역', '#2A4B2D'], 400: ['초지', '#399926'], 500: ['습지', '#7C227E'], 600: ['나지', '#59CECA'], 700: ['수역', '#0602FA'] };
  const LV = { 1: L1, 2: L2, 3: L3 };
  const LV_NAME = { 1: '대분류', 2: '중분류', 3: '세분류' };

  const O = () => { const o = App.opts.lc = App.opts.lc || {}; if (!o.level) o.level = 3; if (o.year == null) o.year = 'auto'; if (o.margin == null) o.margin = 300; if (!o.target) o.target = {}; return o; };
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const fmt = n => (Number(n) || 0).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const refreshMaps = () => App.liveSets.forEach(s => s.changed && s.changed());
  const codeAt = (f, lv) => { const c3 = f.get('c3'); return lv === 3 ? c3 : lv === 2 ? Math.floor(c3 / 10) * 10 : Math.floor(c3 / 100) * 100; };
  const info = (code, lv) => (LV[lv][code] || [String(code), '#BBBBBB']);
  let state = null;   // { year, feats: [{ g5(jsts), c3 }], areas: { 범주: { code3: ㎡ } }, totals, bbox }

  // ------------------------------------------------------------ 지도 그림
  const SC = new Map();
  App.lcStyle = function (f) {
    if (App.theme !== 'lc') return null;
    const lv = O().level, code = codeAt(f, lv), col = info(code, lv)[1];
    let st = SC.get(col);
    if (!st) { st = new ol.style.Style({ fill: new ol.style.Fill({ color: col }), stroke: new ol.style.Stroke({ color: col, width: 0.6 }) }); SC.set(col, st); }
    return st;
  };
  // 범례: 지금 그려진 항목 (분류 코드 순서)
  App.lcLegend = function () {
    const lv = O().level, have = new Set();
    App.src.lc.getFeatures().forEach(f => have.add(codeAt(f, lv)));
    return [...have].sort((a, b) => a - b).map(c => ({ t: info(c, lv)[0], ecolor: info(c, lv)[1] }));
  };

  // ------------------------------------------------------------ 자료 받기
  async function get(url, ms) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms || 60000);
    try {
      const r = await fetch(PROXY + encodeURIComponent(url), { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      try { return JSON.parse(t); } catch (e) { throw new Error('응답 형식 오류'); }
    } catch (e) { throw new Error(e.name === 'AbortError' ? '시간 초과' : e.message); }
    finally { clearTimeout(tm); }
  }
  // 최신 연도 찾기: 올해+1 부터 2022 까지 차례로 (해마다 전국 갱신)
  async function latestYear(b5) {
    const now = new Date().getFullYear(), c = [(b5[0] + b5[2]) / 2, (b5[1] + b5[3]) / 2];
    const small = [c[0] - 50, c[1] - 50, c[0] + 50, c[1] + 50];
    for (let y = now + 1; y >= 2022; y--) {
      try {
        const j = await get(`${BASE}?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&typeNames=EGIS:lv3_${y}y&srsName=EPSG:5186&bbox=${small.join(',')},EPSG:5186&count=1`, 20000);
        if ((j.features || []).length) return y;
      } catch (e) { /* 그 해 레이어 없음 */ }
    }
    return null;
  }
  async function fetchAll(year, b5, msg) {
    const url = (si, n) => `${BASE}?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&typeNames=EGIS:lv3_${year}y&srsName=EPSG:5186&bbox=${b5.map(v => v.toFixed(1)).join(',')},EPSG:5186&count=${n}&startIndex=${si}`;
    const N = 2000;
    const first = await get(url(0, N));
    const total = Math.min(first.numberMatched || first.totalFeatures || (first.features || []).length, 40000);
    const pages = [first];
    const starts = []; for (let s = N; s < total; s += N) starts.push(s);
    let done = 1; msg.textContent = `토지피복 받는 중... ${Math.min(N, total)} / ${total}`;
    for (let i = 0; i < starts.length; i += 5) {
      const got = await Promise.all(starts.slice(i, i + 5).map(s => get(url(s, N))));
      pages.push(...got); done += got.length;
      msg.textContent = `토지피복 받는 중... ${Math.min(done * N, total)} / ${total}`;
    }
    const seen = new Set(), out = [];
    pages.forEach(p => (p.features || []).forEach(f => { if (!f.geometry || seen.has(f.id)) return; seen.add(f.id); out.push(f); }));
    return { feats: out, total };
  }

  // ------------------------------------------------------------ 계산
  async function run() {
    const o = O(), btn = $('#btnLcRun'), msg = $('#lcMsg');
    const sites = App.sites.filter(s => s.geometry);
    if (!sites.length) { App.toast('먼저 도면 탭에서 도면을 올리세요.', 'warn'); return; }
    const rd = new jsts.io.GeoJSONReader();
    const byCat = {};
    sites.forEach(s => { const g = rd.read(s.geometry); byCat[s.category] = byCat[s.category] ? byCat[s.category].union(g) : g; });
    const all = Object.values(byCat).reduce((a, g) => (a ? a.union(g) : g), null);
    const env = all.getEnvelopeInternal(), m = Math.max(0, Number(o.margin) || 0);
    const b5 = [env.getMinX() - m, env.getMinY() - m, env.getMaxX() + m, env.getMaxY() + m];
    btn.disabled = true; msg.hidden = false;
    try {
      let year = o.year === 'auto' ? null : Number(o.year);
      if (!year) { msg.textContent = '가장 최근 토지피복지도 찾는 중...'; year = await latestYear(b5); }
      if (!year) throw new Error('토지피복지도 자료를 찾지 못했습니다');
      const { feats } = await fetchAll(year, b5, msg);
      msg.textContent = '면적 계산 중...';
      await new Promise(r => setTimeout(r, 20));
      // 분류별 면적 (구분별: 사업지구·계획지구 등)
      const areas = {}, totals = {};
      Object.keys(byCat).forEach(k => { areas[k] = {}; totals[k] = byCat[k].getArea(); });
      const fmt3857 = new ol.format.GeoJSON();
      App.src.lc.clear();
      const olFeats = [];
      const prepared = Object.fromEntries(Object.entries(byCat).map(([k, g]) => [k, { g, env: g.getEnvelopeInternal() }]));
      feats.forEach(f => {
        const c3 = Number((f.properties || {}).l3_code) || 0;
        let g; try { g = rd.read(f.geometry); } catch (e) { return; }
        Object.entries(prepared).forEach(([k, p]) => {
          if (!g.getEnvelopeInternal().intersects(p.env)) return;
          let a = 0;
          try { a = g.intersection(p.g).getArea(); } catch (e) { try { a = g.buffer(0).intersection(p.g).getArea(); } catch (e2) { a = 0; } }
          if (a > 0) areas[k][c3] = (areas[k][c3] || 0) + a;
        });
        const of = fmt3857.readFeature({ type: 'Feature', geometry: f.geometry, properties: {} }, { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
        of.set('c3', c3); olFeats.push(of);
      });
      App.src.lc.addFeatures(olFeats);
      state = { year, n: feats.length, areas, totals, img: (feats[0] && feats[0].properties && feats[0].properties.img_date || '').slice(0, 10) };
      msg.textContent = `완료: ${year}년 세분류 토지피복지도 (항공영상 ${state.img || '-'}) · 폴리곤 ${feats.length.toLocaleString()}개`;
      render(); refreshMaps(); App.emit();
      if (App.layout && App.layout.fit && App.embedView && App.embedView.lc === 'print') App.layout.fit();
    } catch (e) { msg.textContent = '오류: ' + e.message; }
    finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------ 표 (분류 수준에 맞춰 합산, 발주처 면적 보정)
  // 보정 후에도 소수 둘째 자리 합계가 정확히 맞도록 나머지를 큰 순서로 배분
  function roundTo(vals, total) {
    const c = vals.map(v => Math.floor(v * 100)), want = Math.round(total * 100);
    let left = want - c.reduce((a, b) => a + b, 0);
    vals.map((v, i) => [v * 100 - Math.floor(v * 100), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { c[i]++; left--; } });
    return c.map(v => v / 100);
  }
  function model() {
    if (!state) return null;
    const o = O(), lv = o.level;
    return Object.keys(state.areas).map(cat => {
      const raw = {}; Object.entries(state.areas[cat]).forEach(([c3, a]) => { const c = lv === 3 ? +c3 : lv === 2 ? Math.floor(c3 / 10) * 10 : Math.floor(c3 / 100) * 100; raw[c] = (raw[c] || 0) + a; });
      const tot = state.totals[cat], covered = Object.values(raw).reduce((a, b) => a + b, 0), none = Math.max(0, tot - covered);
      const t = Number(o.target[cat]), k = t > 0 && tot > 0 ? t / tot : 1, finalTot = tot * k;
      const codes = Object.keys(raw).map(Number).sort((a, b) => a - b);
      const vals = codes.map(c => raw[c] * k); if (none * k >= 0.005) vals.push(none * k);
      const r = roundTo(vals, finalTot);
      const rows = codes.map((c, i) => ({ code: c, name: info(c, lv)[0], color: info(c, lv)[1], area: r[i] }));
      if (none * k >= 0.005) rows.push({ code: '', name: '자료 없음', color: '#ffffff', area: r[r.length - 1] });
      return { cat, rows, total: Math.round(finalTot * 100) / 100, rawTotal: tot, factor: k, corrected: k !== 1 };
    });
  }
  function render() {
    const m = model(), box = $('#lcResult');
    if (!m) { box.hidden = true; return; }
    box.hidden = false;
    const o = O();
    $('#lcFix').innerHTML = m.map(b => `<div class="fix-row"><span class="fix-cat">${esc(b.cat)}</span><span class="fix-raw">도면 ${fmt(b.rawTotal)}㎡</span>
      <label class="unit-input"><input type="number" min="0" step="any" data-lcfix="${esc(b.cat)}" value="${o.target[b.cat] || ''}" placeholder="발주처 면적"><span class="unit">㎡</span></label></div>
      ${b.corrected ? `<div class="hint fix-note">· 보정 비율 ${(b.factor * 100).toFixed(3)}%</div>` : ''}`).join('');
    let h = `<tr><th>${LV_NAME[o.level]}</th><th>면적(㎡)</th><th>비율(%)</th></tr>`;
    m.forEach(b => {
      h += `<tr class="cat-head"><td colspan="3">${esc(b.cat)}${b.corrected ? ' <span class="tag">면적 보정</span>' : ''}</td></tr>`;
      b.rows.forEach(r => { h += `<tr><td class="cat"><span class="lc-sw" style="background:${r.color}"></span>${esc(r.name)}${r.code ? ` <small>${r.code}</small>` : ''}</td><td>${fmt(r.area)}</td><td>${fmt(b.total ? r.area / b.total * 100 : 0)}</td></tr>`; });
      h += `<tr class="sum"><td class="cat">계</td><td>${fmt(b.total)}</td><td>${fmt(100)}</td></tr>`;
    });
    $('#lcTable').innerHTML = h;
  }
  function copyTable() {
    const m = model(); if (!m) return;
    const lines = [];
    m.forEach(b => { lines.push(b.cat); lines.push([LV_NAME[O().level], '면적(㎡)', '비율(%)'].join('\t')); b.rows.forEach(r => lines.push([r.name, r.area.toFixed(2), (b.total ? r.area / b.total * 100 : 0).toFixed(2)].join('\t'))); lines.push(['계', b.total.toFixed(2), '100.00'].join('\t')); lines.push(''); });
    navigator.clipboard.writeText(lines.join('\n')).then(() => App.toast('표를 복사했습니다. 엑셀에 붙여넣으세요.', 'ok'), () => App.toast('복사하지 못했습니다.', 'warn'));
  }

  function build() {
    const o = O();
    // 투명도 (공용 옵션 처리: data-opt / data-pct)
    const SLD = (lab, k) => `<div class="slider" data-row="${k}"><span>${lab}</span><input type="range" min="0" max="1" step="0.05" data-opt="${k}" value="${App.opts[k] == null ? (k === 'opLC' ? 0.8 : 1) : App.opts[k]}"> <span class="pct-box"><input type="number" min="0" max="100" step="5" data-pct="${k}" value="${Math.round((App.opts[k] == null ? (k === 'opLC' ? 0.8 : 1) : App.opts[k]) * 100)}"><span>%</span></span></div>`;
    if (App.opts.opLC == null) App.opts.opLC = 0.8;
    $('#lcOpts').innerHTML = SLD('토지피복 투명도', 'opLC') + SLD('도면 투명도(경계)', 'opS');
    $('#lcLevel').value = String(o.level); $('#lcYear').value = String(o.year); $('#lcMargin').value = o.margin;
    $('#lcLevel').addEventListener('change', e => { o.level = Number(e.target.value); App.saveOpts(); render(); refreshMaps(); App.emit(); if (App.layout && App.layout.redraw) App.layout.redraw(); });
    $('#lcYear').addEventListener('change', e => { o.year = e.target.value; App.saveOpts(); });
    $('#lcMargin').addEventListener('change', e => { o.margin = Math.max(0, Number(e.target.value) || 0); App.saveOpts(); });
    $('#btnLcRun').addEventListener('click', run);
    $('#lcFix').addEventListener('change', e => { const c = e.target.dataset.lcfix; if (c == null) return; const v = Number(e.target.value); if (v > 0) o.target[c] = v; else delete o.target[c]; App.saveOpts(); render(); });
    $('#btnLcCopy').addEventListener('click', copyTable);
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
