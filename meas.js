/* 측정지점 위치도: 엑셀(항목 / 주소 / 명칭)을 붙여넣거나 파일로 열면 주소 위치에 측정지점을 찍고
 * 사업지구·노선, 주변 하천과 함께 표시. 대기질 A-1, 소음진동 NV-1 처럼 항목별 부호를 자동으로 붙임. target.js 다음에 로드. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  const DEFCAT = [
    { k: '대기질', pre: 'A', shape: 'circle', color: '#ffffff' },
    { k: '소음진동', pre: 'NV', shape: 'circle', color: '#ffffff' },
    { k: '지표수질', pre: 'W', shape: 'circle', color: '#1E5BFF' },
    { k: '지하수질', pre: 'GW', shape: 'circle', color: '#8E24AA' },
    { k: '토양', pre: 'S', shape: 'square', color: '#8D5524' },
  ];
  const SHAPES = [['circle', '동그라미'], ['square', '네모'], ['triangle', '세모'], ['diamond', '마름모']];
  const M = () => {
    const o = App.opts.meas = App.opts.meas || {};
    if (!Array.isArray(o.cats)) o.cats = JSON.parse(JSON.stringify(DEFCAT));
    if (!Array.isArray(o.rows)) o.rows = [];
    if (o.raw == null) o.raw = '';
    if (o.fontPct == null) o.fontPct = 100;
    return o;
  };
  const norm = s => String(s || '').replace(/[\s·ㆍ.\-_/]/g, '');
  const catOf = k => M().cats.find(c => norm(c.k) === norm(k));
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const refreshMaps = () => App.liveSets.forEach(s => s.changed && s.changed());
  const saveAll = () => { App.saveOpts(); draw(); if (App.layout && App.layout.redraw) App.layout.redraw(); App.emit(); };

  // ------------------------------------------------------------ 입력 해석 (엑셀 붙여넣기: 탭 구분, 항목 칸이 비면 위 항목을 이어 씀)
  function parse(text) {
    const out = []; let last = '';
    String(text || '').split(/\r?\n/).forEach(line => {
      if (!line.trim()) return;
      let c = line.split('\t'); if (c.length < 2) c = line.split(/\s*,\s*/);
      c = c.map(x => x.trim());
      if (/주소/.test(c[1] || '') && /항목|구분/.test(c[0] || '')) return;   // 머리글 줄
      const cat = c[0] || last; last = cat;
      const addr = c[1] || '', name = c.slice(2).filter(Boolean).join(' ');
      if (!addr) return;
      out.push({ cat, addr, name });
    });
    return out;
  }
  function codes() {   // 항목별 순번: A-1, A-2 ...
    const n = {};
    M().rows.forEach(r => { const c = catOf(r.cat); const pre = c ? c.pre : (r.cat || '?').slice(0, 2); n[pre] = (n[pre] || 0) + 1; r.code = `${pre}-${n[pre]}`; });
  }

  // ------------------------------------------------------------ 주소 → 좌표 (브이월드 주소 API: 지번 → 도로명 → 장소 검색)
  const geoCache = {};
  async function geocode(addr) {
    if (geoCache[addr]) return geoCache[addr];
    const key = App.cfg.vworldKey, dom = encodeURIComponent(location.origin);
    for (const type of ['PARCEL', 'ROAD']) {
      const u = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&refine=true&simple=false&format=json&type=${type}&address=${encodeURIComponent(addr)}&key=${key}&domain=${dom}`;
      try {
        const j = await App.jsonp(u), r = j.response;
        if (r && r.status === 'OK' && r.result && r.result.point) { const v = { ll: [+r.result.point.x, +r.result.point.y], how: type === 'PARCEL' ? '지번' : '도로명', refined: (r.refined && r.refined.text) || '' }; geoCache[addr] = v; return v; }
      } catch (e) { /* 다음 방식 */ }
    }
    try {
      const u = `https://api.vworld.kr/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=1&page=1&format=json&type=place&query=${encodeURIComponent(addr)}&key=${key}&domain=${dom}`;
      const j = await App.jsonp(u), it = j.response && j.response.result && j.response.result.items && j.response.result.items[0];
      if (it && it.point) { const v = { ll: [+it.point.x, +it.point.y], how: '장소 검색', refined: it.title || '' }; geoCache[addr] = v; return v; }
    } catch (e) { /* 실패 */ }
    return null;
  }
  async function locate() {
    const o = M(), btn = $('#btnMeasRun'), msg = $('#measMsg');
    if (!App.cfg.vworldKey) { App.toast('브이월드 키가 필요합니다 (도면 탭 1. 설정).', 'warn'); return; }
    const parsed = parse($('#measRaw').value);
    if (!parsed.length) { App.toast('항목 / 주소 / 명칭을 붙여넣으세요.', 'warn'); return; }
    o.raw = $('#measRaw').value;
    // 같은 줄(항목+주소+명칭)은 전에 찾은 위치·글자 방향을 유지
    const prev = new Map(o.rows.map(r => [r.cat + '|' + r.addr + '|' + r.name, r]));
    o.rows = parsed.map(p => { const q = prev.get(p.cat + '|' + p.addr + '|' + p.name); return q && q.ll ? q : Object.assign({ pos: 'r' }, p); });
    btn.disabled = true; msg.hidden = false;
    let done = 0, bad = 0;
    for (const r of o.rows) {
      if (!r.ll || r.how === '실패') {
        const g = await geocode(r.addr);
        if (g) { r.ll = g.ll; r.how = g.how; r.refined = g.refined; } else { r.ll = null; r.how = '실패'; bad++; }
      }
      done++; msg.textContent = `위치 찾는 중... ${done} / ${o.rows.length}`;
    }
    btn.disabled = false;
    msg.textContent = `${o.rows.length}곳 중 ${o.rows.length - bad}곳 위치 찾음` + (bad ? ` · ${bad}곳은 못 찾음 (목록에서 '지도에서 찍기')` : '');
    codes(); renderList(); saveAll(); fitAll();
  }
  function fitAll() {
    const fs = App.src.meas.getFeatures(); if (!fs.length) return;
    let e = ol.extent.createEmpty(); fs.forEach(f => ol.extent.extend(e, f.getGeometry().getExtent()));
    const se = App.sitesExtent && App.sitesExtent(); if (se) ol.extent.extend(e, se);
    App.workMap.getView().fit(ol.extent.buffer(e, Math.max(150, (e[2] - e[0]) * 0.12)), { duration: 300, maxZoom: 17 });
  }

  // ------------------------------------------------------------ 지도 그림
  function draw() {
    const o = M(); App.src.meas.clear();
    // 같은 위치 + 같은 모양이면 한 점에 부호를 위아래로 (예: A-1 / NV-1)
    const groups = new Map();
    o.rows.forEach((r, i) => {
      if (!r.ll) return;
      const c = catOf(r.cat) || { shape: 'circle', color: '#9E9E9E' };
      const key = r.ll.map(v => v.toFixed(6)).join(',') + '|' + c.shape + c.color;
      if (!groups.has(key)) groups.set(key, { ll: r.ll, c, codes: [], idx: i, pos: r.pos || 'r' });
      groups.get(key).codes.push(r.code);
    });
    const at = new Map();   // 같은 자리에 모양이 다른 점이 겹치면 옆으로 조금 비킴
    groups.forEach(g => {
      const pk = g.ll.map(v => v.toFixed(6)).join(','); const n = at.get(pk) || 0; at.set(pk, n + 1);
      const f = new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat(g.ll)));
      f.setProperties({ shape: g.c.shape, color: g.c.color, label: g.codes.join('\n'), pos: g.pos, nudge: n });
      App.src.meas.addFeature(f);
    });
    refreshMaps();
  }
  function symbol(shape, color, r, s) {
    const fill = new ol.style.Fill({ color }), stroke = new ol.style.Stroke({ color: '#111', width: Math.max(1, 1.4 * s) });
    if (shape === 'square') return new ol.style.RegularShape({ points: 4, radius: r * 1.25, angle: Math.PI / 4, fill, stroke });
    if (shape === 'triangle') return new ol.style.RegularShape({ points: 3, radius: r * 1.3, fill, stroke });
    if (shape === 'diamond') return new ol.style.RegularShape({ points: 4, radius: r * 1.35, angle: 0, fill, stroke });
    return new ol.style.Circle({ radius: r, fill, stroke });
  }
  App.measStyle = function (f, s, res) {
    if (App.theme !== 'meas') return null;
    const o = M(), fsc = (Number(o.fontPct) || 100) / 100, r = 6.5 * fsc * s;
    let g = f.getGeometry(); const n = f.get('nudge');
    if (n && res) { const c = g.getCoordinates(); g = new ol.geom.Point([c[0] + n * r * 2.4 * res, c[1]]); }
    const pos = f.get('pos') || 'r', lines = String(f.get('label') || '').split('\n').length;
    const off = { r: [r + 6 * s, 0, 'left'], l: [-(r + 6 * s), 0, 'right'], u: [0, -(r + 6 * s + lines * 7 * fsc * s), 'center'], d: [0, r + 6 * s + lines * 7 * fsc * s, 'center'] }[pos] || [r + 6 * s, 0, 'left'];
    return [
      new ol.style.Style({ geometry: g, image: symbol(f.get('shape'), f.get('color'), r, s) }),
      new ol.style.Style({ geometry: g, text: new ol.style.Text({ text: f.get('label'), font: `bold ${Math.round(11 * fsc * s * 10) / 10}px "EcoFont","Malgun Gothic",sans-serif`,
        textAlign: off[2], offsetX: off[0], offsetY: off[1], fill: new ol.style.Fill({ color: '#111' }),
        backgroundFill: new ol.style.Fill({ color: '#fff' }), backgroundStroke: new ol.style.Stroke({ color: '#111', width: 1.1 * s }),
        padding: [2 * s, 4 * s, 1 * s, 4 * s], overflow: true }) }),
    ];
  };
  // 범례: 모양·색이 같은 항목은 한 줄로 (예: 대기질·소음진동 측정지점)
  App.measLegend = function () {
    const o = M(), used = new Set(o.rows.filter(r => r.ll).map(r => norm(r.cat))), out = [];
    o.cats.filter(c => used.has(norm(c.k))).forEach(c => {
      const same = out.find(x => x.shape === c.shape && x.color === c.color);
      if (same) same.names.push(c.k); else out.push({ shape: c.shape, color: c.color, names: [c.k] });
    });
    return out.map(x => ({ t: x.names.join('·') + ' 측정지점', sym: { shape: x.shape, color: x.color } }));
  };

  // ------------------------------------------------------------ 탭 UI
  function renderCats() {
    $('#measCats').innerHTML = `<div class="mc-head"><span>항목</span><span>부호</span><span>모양</span><span>색</span></div>` + M().cats.map((c, i) => `<div class="mc-row">
      <input type="text" data-mc="${i}" data-f="k" value="${esc(c.k)}"><input type="text" data-mc="${i}" data-f="pre" value="${esc(c.pre)}">
      <select data-mc="${i}" data-f="shape">${SHAPES.map(s => `<option value="${s[0]}" ${c.shape === s[0] ? 'selected' : ''}>${s[1]}</option>`).join('')}</select>
      <input type="color" data-mc="${i}" data-f="color" value="${esc(c.color)}"></div>`).join('');
  }
  let pickRow = null;
  function renderList() {
    const o = M(), box = $('#measList');
    if (!o.rows.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<table class="meas-table"><thead><tr><th>부호</th><th>명칭 · 주소</th><th>글자</th><th></th></tr></thead><tbody>` + o.rows.map((r, i) => `<tr class="${r.ll ? '' : 'bad'}">
      <td><b>${esc(r.code)}</b><br><small>${esc(r.cat)}</small></td>
      <td>${esc(r.name) || '-'}<br><small>${esc(r.addr)}${r.ll ? ` · ${esc(r.how)}` : ' · <b class="warn">못 찾음</b>'}</small></td>
      <td><select data-mpos="${i}">${[['r', '오른쪽'], ['l', '왼쪽'], ['u', '위'], ['d', '아래']].map(p => `<option value="${p[0]}" ${(r.pos || 'r') === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></td>
      <td><button type="button" class="btn small" data-mpick="${i}">${pickRow === i ? '지도 누르기' : '지도에서 찍기'}</button></td></tr>`).join('') + '</tbody></table><ul class="bullets"><li>같은 주소·같은 모양은 한 점에 부호를 위아래로 씁니다 (예: A-1 / NV-1)</li><li>위치가 다르면 \'지도에서 찍기\'로 고칠 수 있습니다</li></ul>';
  }
  async function readFile(file) {
    let rows = [];
    if (/\.csv$/i.test(file.name) || /\.txt$/i.test(file.name)) {
      const buf = await file.arrayBuffer(); let t = new TextDecoder('utf-8').decode(buf); if (t.includes('\uFFFD')) t = new TextDecoder('euc-kr').decode(buf);
      rows = t.split(/\r?\n/).map(l => l.split(/\t|,/));
    } else {
      if (!window.ExcelJS) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = EXCELJS; s.onload = ok; s.onerror = () => no(new Error('엑셀 읽기 도구를 불러오지 못했습니다')); document.head.appendChild(s); });
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      ws.eachRow({ includeEmpty: false }, row => { const v = []; for (let c = 1; c <= Math.max(3, row.cellCount); c++) { const x = row.getCell(c); let t = x.isMerged && x.master !== x ? '' : x.text; v.push(String(t || '').trim()); } rows.push(v); });
    }
    $('#measRaw').value = rows.filter(r => r.some(x => String(x).trim())).map(r => r.slice(0, 3).join('\t')).join('\n');
  }
  function build() {
    const o = M();
    $('#measRaw').value = o.raw || '';
    $('#measFontPct').value = o.fontPct || 100;
    renderCats(); codes(); renderList(); draw();
    $('#btnMeasRun').addEventListener('click', locate);
    $('#measFile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { await readFile(f); App.toast('파일을 읽었습니다. "위치 찾기"를 누르세요.'); } catch (err) { App.toast(err.message, 'warn'); } e.target.value = ''; });
    $('#btnMeasExample').addEventListener('click', () => { $('#measRaw').value = ['대기질\t강원 화천군 하남면 안평리 574-1\t안평리경로당', '\t강원 화천군 하남면 안평리 528-1\t주거시설', '소음진동\t강원 화천군 하남면 안평리 574-1\t안평리경로당', '\t강원 화천군 하남면 안평리 528-1\t주거시설', '지표수질\t강원 화천군 하남면 안평리 1484\t논미천 상류(회동교)', '\t강원 화천군 하남면 안평리 472-31\t논미천 하류(홍촌교)', '지하수질\t강원 화천군 하남면 안평리 886\t농어업용(전작용)', '\t강원 화천군 하남면 안평리 522-6\t생활용(가정용)', '토양\t강원 화천군 하남면 안평리 921-8\t대지 내부'].join('\n'); });
    $('#btnMeasClear').addEventListener('click', () => { o.rows = []; o.raw = ''; $('#measRaw').value = ''; renderList(); saveAll(); });
    $('#measCats').addEventListener('input', e => { const t = e.target, i = t.dataset.mc; if (i == null) return; o.cats[+i][t.dataset.f] = t.value; codes(); renderList(); saveAll(); });
    $('#btnMeasCatReset').addEventListener('click', () => { o.cats = JSON.parse(JSON.stringify(DEFCAT)); renderCats(); codes(); renderList(); saveAll(); });
    $('#measFontPct').addEventListener('input', e => { o.fontPct = Math.max(30, Number(e.target.value) || 100); saveAll(); });
    $('#measList').addEventListener('change', e => { const i = e.target.dataset.mpos; if (i == null) return; o.rows[+i].pos = e.target.value; saveAll(); });
    $('#measList').addEventListener('click', e => { const b = e.target.closest('[data-mpick]'); if (!b) return; const i = +b.dataset.mpick; pickRow = pickRow === i ? null : i; App.workMap.getTargetElement().style.cursor = pickRow != null ? 'crosshair' : ''; renderList(); });
    App.workMap.on('singleclick', e => {
      if (pickRow == null) return;
      const r = o.rows[pickRow]; r.ll = ol.proj.toLonLat(e.coordinate); r.how = '직접 지정';
      pickRow = null; App.workMap.getTargetElement().style.cursor = ''; renderList(); saveAll();
    });
    $('#btnMeasRiver').addEventListener('click', () => {
      const pts = o.rows.filter(r => r.ll).map(r => proj4('EPSG:4326', 'EPSG:5186', r.ll));
      const bs = App.sites.filter(s => s.bbox).map(s => s.bbox);
      pts.forEach(p => bs.push([p[0], p[1], p[0], p[1]]));
      if (!bs.length) { App.toast('먼저 위치를 찾거나 도면을 올리세요.', 'warn'); return; }
      const m = 1000, b5 = [Math.min(...bs.map(b => b[0])) - m, Math.min(...bs.map(b => b[1])) - m, Math.max(...bs.map(b => b[2])) + m, Math.max(...bs.map(b => b[3])) + m];
      App.targetLoadRivers(b5, $('#measRiverMsg'), $('#btnMeasRiver'));
    });
    $('#btnMeasLayout').addEventListener('click', () => { App.switchTab('layout'); App.setTheme('meas'); });
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
