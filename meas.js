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

  // ------------------------------------------------------------ 입력: 항목마다 개수를 정하고 1, 2, 3 ... 칸에 주소·명칭을 붙여넣음
  const ent = c => { const o = M(); o.ent = o.ent || {}; o.cnt = o.cnt || {}; const a = o.ent[c.k] = o.ent[c.k] || []; const n = o.cnt[c.k] == null ? 1 : o.cnt[c.k]; while (a.length < n) a.push({ addr: '', name: '', pos: 'u' }); return a; };
  const cnt = c => { const o = M(); o.cnt = o.cnt || {}; return o.cnt[c.k] == null ? 1 : Number(o.cnt[c.k]) || 0; };
  function rebuildRows() {   // 지도·범례용 목록 (부호 = 항목 부호 - 칸 번호)
    const o = M(); o.rows = [];
    o.cats.forEach(c => { const a = ent(c); for (let i = 0; i < cnt(c); i++) { const e = a[i]; if (!e || !e.addr.trim()) continue; e.code = `${c.pre}-${i + 1}`; o.rows.push(Object.assign(e, { cat: c.k })); } });
  }
  function codes() { rebuildRows(); }

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
    const btn = $('#btnMeasRun'), msg = $('#measMsg');
    if (!App.cfg.vworldKey) { App.toast('브이월드 키가 필요합니다 (도면 탭 1. 설정).', 'warn'); return; }
    rebuildRows(); const rows = M().rows;
    if (!rows.length) { App.toast('주소를 하나 이상 넣으세요.', 'warn'); return; }
    btn.disabled = true; msg.hidden = false;
    let done = 0, bad = 0;
    for (const r of rows) {
      if (!r.ll || (r.how === '실패')) {
        const g = await geocode(r.addr.trim());
        if (g) { r.ll = g.ll; r.how = g.how; r.refined = g.refined; } else { r.ll = null; r.how = '실패'; bad++; }
      }
      done++; msg.textContent = `위치 찾는 중... ${done} / ${rows.length}`;
    }
    btn.disabled = false;
    msg.textContent = `${rows.length}곳 중 ${rows.length - bad}곳 위치 찾음` + (bad ? ` · ${bad}곳은 못 찾음 ('찍기'로 지정)` : '');
    renderInputs(); saveAll(); fitAll();
  }
  // 도면 출력 '도면 이동': 측정지점 위치도에서는 지점 + 도면 전체
  App.layoutExtent = function () {
    if (App.theme === 'target') {   // 대상지역 설정도: 가장 큰 거리 범위까지
      const rs = App.src.target.getFeatures().filter(f => f.get('tk') === 'ring'); if (!rs.length) return null;
      const e = ol.extent.createEmpty(); rs.forEach(f => ol.extent.extend(e, f.getGeometry().getExtent()));
      return ol.extent.buffer(e, (e[2] - e[0]) * 0.06);
    }
    if (App.theme !== 'meas') return null;
    const fs = App.src.meas.getFeatures(); if (!fs.length) return null;
    const e = ol.extent.createEmpty(); fs.forEach(f => ol.extent.extend(e, f.getGeometry().getExtent()));
    const se = App.sitesExtent && App.sitesExtent(); if (se) ol.extent.extend(e, se);
    return ol.extent.buffer(e, Math.max(100, (e[2] - e[0]) * 0.08));
  };
  function fitAll() {
    if (App.embedView && App.embedView.meas === 'print' && App.layout && App.layout.fit) { App.layout.fit(); return; }
    const fs = App.src.meas.getFeatures(); if (!fs.length) return;
    let e = ol.extent.createEmpty(); fs.forEach(f => ol.extent.extend(e, f.getGeometry().getExtent()));
    const se = App.sitesExtent && App.sitesExtent(); if (se) ol.extent.extend(e, se);
    App.workMap.getView().fit(ol.extent.buffer(e, Math.max(150, (e[2] - e[0]) * 0.12)), { duration: 300, maxZoom: 17 });
  }

  // ------------------------------------------------------------ 지도 그림
  function draw() {
    rebuildRows(); const o = M(); App.src.meas.clear();
    // 같은 위치 + 같은 모양이면 한 점에 부호를 위아래로 (예: A-1 / NV-1)
    const groups = new Map();
    o.rows.forEach((r, i) => {
      if (!r.ll) return;
      const c = catOf(r.cat) || { shape: 'circle', color: '#9E9E9E' };
      const key = r.ll.map(v => v.toFixed(6)).join(',') + '|' + c.shape + c.color;
      if (!groups.has(key)) groups.set(key, { ll: r.ll, c, codes: [], idx: i, pos: r.pos || 'u' });
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
    const pos = f.get('pos') || 'u';
    const anchor = { u: 'above', d: 'below', l: 'left', r: 'right' }[pos] || 'above';
    const rows = String(f.get('label') || '').split('\n').map(t => ({ t, fg: '#111', bg: '#fff' }));
    return [
      new ol.style.Style({ geometry: g, image: symbol(f.get('shape'), f.get('color'), r, s), zIndex: 1 }),
      new ol.style.Style({ geometry: g, image: App.badge({ rows, border: '#222', font: 11 * fsc, anchor, gap: 6.5 * fsc + 5 }, s), zIndex: 2 }),
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
  let pickRow = null;   // [항목, 칸 번호]
  const POS = [['u', '위'], ['d', '아래'], ['l', '왼쪽'], ['r', '오른쪽']];
  function renderInputs() {
    const o = M(), box = $('#measInputs');
    box.innerHTML = o.cats.map((c, ci) => { const a = ent(c), n = cnt(c);
      return `<div class="mi-cat"><div class="mi-head"><span class="mi-sym" style="--c:${esc(c.color)}" data-shape="${esc(c.shape)}"></span><b>${esc(c.k)}</b><span class="mi-pre">${esc(c.pre)}</span>
        <label class="mi-cnt">개수 <input type="number" min="0" max="30" step="1" data-mcnt="${ci}" value="${n}"></label>
        ${ci > 0 ? `<button type="button" class="btn small" data-mcopy="${ci}" title="바로 위 항목의 주소·명칭을 그대로 복사">위와 같게</button>` : ''}</div>
        ${Array.from({ length: n }, (_, i) => { const e = a[i]; const st = !e.addr.trim() ? '' : e.ll ? (e.how === '직접 지정' ? '<span class="mi-st ok">직접</span>' : '<span class="mi-st ok">찾음</span>') : (e.how === '실패' ? '<span class="mi-st bad">못 찾음</span>' : '<span class="mi-st">대기</span>');
          const pk = pickRow && pickRow[0] === ci && pickRow[1] === i;
          return `<div class="mi-row"><span class="mi-code">${esc(c.pre)}-${i + 1}</span>
            <input type="text" class="mi-addr" placeholder="주소 (붙여넣기)" data-mci="${ci}" data-mi="${i}" data-mf="addr" value="${esc(e.addr)}">
            <input type="text" class="mi-name" placeholder="명칭" data-mci="${ci}" data-mi="${i}" data-mf="name" value="${esc(e.name)}">
            <select data-mci="${ci}" data-mi="${i}" data-mf="pos" title="부호 상자 위치">${POS.map(p => `<option value="${p[0]}" ${(e.pos || 'u') === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select>
            <button type="button" class="btn small${pk ? ' on' : ''}" data-mpick="${ci}:${i}" title="지도에서 위치 지정">${pk ? '누르기' : '찍기'}</button>${st}</div>`; }).join('')}</div>`; }).join('');
  }
  function renderList() { renderInputs(); }
  function build() {
    const o = M();
    $('#measFontPct').value = o.fontPct || 100;
    renderCats(); renderInputs(); draw();
    $('#btnMeasRun').addEventListener('click', locate);
    const box = $('#measInputs');
    box.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.mcnt != null) { const c = o.cats[+t.dataset.mcnt]; o.cnt[c.k] = Math.max(0, Math.min(30, Number(t.value) || 0)); ent(c); App.saveOpts(); clearTimeout(box._t); box._t = setTimeout(() => { renderInputs(); saveAll(); }, 400); return; }
      if (t.dataset.mf && t.tagName === 'INPUT') { const c = o.cats[+t.dataset.mci], en = ent(c)[+t.dataset.mi]; en[t.dataset.mf] = t.value; if (t.dataset.mf === 'addr') { en.ll = null; en.how = ''; } App.saveOpts(); clearTimeout(box._d); box._d = setTimeout(saveAll, 500); }
    });
    box.addEventListener('change', e => { const t = e.target; if (t.tagName === 'SELECT' && t.dataset.mf === 'pos') { ent(o.cats[+t.dataset.mci])[+t.dataset.mi].pos = t.value; saveAll(); } });
    // 여러 줄을 한 번에 붙여넣으면 (엑셀에서 주소 열 복사) 아래 칸으로 차례로 채움. 탭으로 나뉘면 두 번째 칸은 명칭
    box.addEventListener('paste', e => {
      const t = e.target; if (!t.dataset || t.dataset.mf !== 'addr') return;
      const txt = (e.clipboardData || window.clipboardData).getData('text'); const lines = txt.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2 && !/\t/.test(txt)) return;
      e.preventDefault();
      const c = o.cats[+t.dataset.mci], start = +t.dataset.mi;
      if (start + lines.length > cnt(c)) o.cnt[c.k] = start + lines.length;
      const a = ent(c);
      lines.forEach((l, j) => { const p = l.split('\t').map(x => x.trim()); const en = a[start + j]; en.addr = p[0] || ''; if (p[1]) en.name = p.slice(1).filter(Boolean).join(' '); en.ll = null; en.how = ''; });
      renderInputs(); saveAll();
    });
    box.addEventListener('click', e => {
      const cp = e.target.closest('[data-mcopy]');
      if (cp) { const ci = +cp.dataset.mcopy, from = o.cats[ci - 1], to = o.cats[ci]; o.cnt[to.k] = cnt(from); o.ent[to.k] = ent(from).map(x => ({ addr: x.addr, name: x.name, pos: x.pos, ll: x.ll, how: x.how })); renderInputs(); saveAll(); return; }
      const b = e.target.closest('[data-mpick]'); if (!b) return;
      const [ci, i] = b.dataset.mpick.split(':').map(Number);
      pickRow = pickRow && pickRow[0] === ci && pickRow[1] === i ? null : [ci, i];
      if (pickRow) App.setEmbedView && App.setEmbedView('meas', 'map');
      App.workMap.getTargetElement().style.cursor = pickRow ? 'crosshair' : ''; renderInputs();
    });
    App.workMap.on('singleclick', e => {
      if (!pickRow) return;
      const en = ent(o.cats[pickRow[0]])[pickRow[1]]; en.ll = ol.proj.toLonLat(e.coordinate); en.how = '직접 지정'; if (!en.addr.trim()) en.addr = '(지도에서 지정)';
      pickRow = null; App.workMap.getTargetElement().style.cursor = ''; renderInputs(); saveAll();
    });
    $('#btnMeasClear').addEventListener('click', () => { o.ent = {}; o.cnt = {}; renderInputs(); saveAll(); });
    $('#measCats').addEventListener('input', e => { const t = e.target, i = t.dataset.mc; if (i == null) return; const c = o.cats[+i];
      if (t.dataset.f === 'k' && t.value && t.value !== c.k) { o.ent[t.value] = o.ent[c.k]; o.cnt[t.value] = o.cnt[c.k]; delete o.ent[c.k]; delete o.cnt[c.k]; }
      c[t.dataset.f] = t.value; renderInputs(); saveAll(); });
    $('#btnMeasCatReset').addEventListener('click', () => { o.cats = JSON.parse(JSON.stringify(DEFCAT)); renderCats(); renderInputs(); saveAll(); });
    $('#measFontPct').addEventListener('input', e => { o.fontPct = Math.max(30, Number(e.target.value) || 100); saveAll(); });
    $('#btnMeasRiver').addEventListener('click', () => {
      rebuildRows();
      const pts = o.rows.filter(r => r.ll).map(r => proj4('EPSG:4326', 'EPSG:5186', r.ll));
      const bs = App.sites.filter(s => s.bbox).map(s => s.bbox);
      pts.forEach(p => bs.push([p[0], p[1], p[0], p[1]]));
      if (!bs.length) { App.toast('먼저 위치를 찾거나 도면을 올리세요.', 'warn'); return; }
      const mg = 1000, b5 = [Math.min(...bs.map(b => b[0])) - mg, Math.min(...bs.map(b => b[1])) - mg, Math.max(...bs.map(b => b[2])) + mg, Math.max(...bs.map(b => b[3])) + mg];
      App.targetLoadRivers(b5, $('#measRiverMsg'), $('#btnMeasRiver'));
    });
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
