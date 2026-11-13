/* 대상지역 설정도: 올린 도면(사업지구·노선)에서 거리별 범위(예: 150·300·500m)를 그리고,
 * 범위별 조사항목 표(평가대상지역)와 주변 하천(국가·지방·소하천)을 함께 표시. prot.js 다음에 로드. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const DEF = {
    rows: [
      { d: 150, items: '동·식물상 (식물상 및 식생, 양서·파충류, 육상곤충류)' },
      { d: 300, items: '동·식물상 (포유류, 조류)' },
      { d: 500, items: '대기질, 소음·진동' },
    ],
    around: '육수생물상, 기상, 수질, 수리·수문, 친환경적 자원순환, 토지이용, 토양, 지형·지질, 경관',
    aroundHead: '사업지구 주변지역(수계)',
    title: '평 가 대 상 지 역',
    head: '사업지구',
    ringColor: 'auto',
    ringShow: true,
    fontPct: 100,
    river: { river_nat: true, river_loc: true, river_small: true },
  };
  const RIVER = [
    { id: 'river_nat', cls: '국가하천', color: '#1E4FD8' },
    { id: 'river_loc', cls: '지방하천', color: '#1E4FD8' },
    { id: 'river_small', cls: '소하천', color: '#2F80ED' },
  ];
  const T = () => {
    const o = App.opts.tgt = App.opts.tgt || {};
    Object.keys(DEF).forEach(k => { if (o[k] == null) o[k] = JSON.parse(JSON.stringify(DEF[k])); });
    return o;
  };
  const dists = () => T().rows.map(r => Number(r.d)).filter(v => v > 0);
  const fmtM = m => m >= 1000 ? (Math.round(m / 100) / 10) + 'km' : Math.round(m) + 'm';
  const refreshMaps = () => { App.liveSets.forEach(s => s.changed && s.changed()); };

  // ------------------------------------------------------------ 지도 그림
  const ringStroke = c => {
    const n = parseInt((c || '#ffffff').slice(1), 16), lum = ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
    return lum > 140 ? 'rgba(40,40,40,0.85)' : 'rgba(255,255,255,0.95)';   // 밝은 선은 어두운 테두리, 어두운 선은 흰 테두리
  };
  // 자동: 항공사진이면 흰색, 그 밖에는 검정
  const ringCol = () => { const c = T().ringColor; return /^#[0-9a-f]{6}$/i.test(c || '') ? c : (App.opts.basemap === 'sat' ? '#ffffff' : '#222222'); };
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  // 거리 상자 위치: 도면 가운데를 지나는 세로선과 범위선이 만나는 가장 위쪽 점 (모든 상자가 한 줄로 가운데 정렬)
  function ringTops(f, set) {
    const ext = set && set.viewExtent, se = App.sitesExtent && App.sitesExtent();
    const ek = (ext ? ext.map(v => Math.round(v)).join(',') : '-') + '|' + (se ? se.map(v => Math.round(v)).join(',') : ''), k = '__rt_' + (set ? set.id : 0);
    if (f[k + 'key'] === ek) return f[k];
    const g = f.getGeometry(), polys = g.getType() === 'MultiPolygon' ? g.getPolygons() : [g], out = [];
    const cx = se ? (se[0] + se[2]) / 2 : null;
    polys.forEach(p => {
      const ring = p.getLinearRing(0).getCoordinates(), pe = ol.extent.boundingExtent(ring);
      const x = cx != null && cx > pe[0] && cx < pe[2] ? cx : (pe[0] + pe[2]) / 2;
      let best = null;
      for (let i = 0; i < ring.length - 1; i++) { const a = ring[i], b = ring[i + 1]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) { const y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); if (!best || y > best[1]) best = [x, y]; } }
      if (best && ext && !(best[0] > ext[0] && best[0] < ext[2] && best[1] > ext[1] && best[1] < ext[3])) best = null;   // 화면 밖이면 생략
      if (best) out.push(best);
    });
    f[k + 'key'] = ek; f[k] = out; return out;
  }
  App.targetStyle = function (f, s, set) {
    if (App.theme !== 'target' && !(App.theme === 'meas' && f.get('tk') === 'river')) return null;   // 측정지점 위치도에서는 하천만
    const o = T(), k = f.get('tk'), fsc = (Number(o.fontPct) || 100) / 100, font = px => `bold ${Math.round(px * fsc * s * 10) / 10}px "EcoFont","Malgun Gothic",sans-serif`;
    if (k === 'ring') {
      if (o.ringShow === false) return null;
      const out = [
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: ringStroke(ringCol()), width: 3.6 * s }) }),
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: ringCol(), width: 1.8 * s }) }),
      ];
      ringTops(f, set).forEach(p => out.push(new ol.style.Style({ geometry: new ol.geom.Point(p), text: new ol.style.Text({
        text: f.get('label'), font: font(11), offsetY: -9 * fsc * s, fill: new ol.style.Fill({ color: '#111' }),
        backgroundFill: new ol.style.Fill({ color: '#fff' }), backgroundStroke: new ol.style.Stroke({ color: '#111', width: 1.1 * s }),
        padding: [1.5 * s, 4 * s, 0.5 * s, 4 * s], overflow: true }) })));
      return out;
    }
    if (k === 'river') {
      const r = RIVER.find(x => x.id === f.get('rid')); if (!r || !o.river[r.id]) return null;
      const st = [new ol.style.Style({ fill: new ol.style.Fill({ color: hexA(r.color, 0.45) }), stroke: new ol.style.Stroke({ color: r.color, width: 1.2 * s }) })];
      const lp = (set && set.viewExtent && App.protLabelPoint) ? (App.protLabelPoint(f, set) || f.get('lp')) : f.get('lp');
      const nm = f.get('name'), named = nm && nm !== r.cls && !/구역$/.test(nm);
      if (lp && f.get('labelMe') && !named) st.push(new ol.style.Style({ geometry: new ol.geom.Point(lp), text: new ol.style.Text({ text: r.cls, font: font(10), fill: new ol.style.Fill({ color: '#111' }), backgroundFill: new ol.style.Fill({ color: '#fff' }), backgroundStroke: new ol.style.Stroke({ color: r.color, width: 1 * s }), padding: [1.5 * s, 5 * s, 0.5 * s, 5 * s], overflow: true }) }));
      if (lp && f.get('labelMe') && named) {
        st.push(new ol.style.Style({ geometry: new ol.geom.Point(lp), text: new ol.style.Text({ text: f.get('name'), font: font(10.5), offsetY: -7.5 * fsc * s,
          fill: new ol.style.Fill({ color: '#fff' }), backgroundFill: new ol.style.Fill({ color: r.color }), backgroundStroke: new ol.style.Stroke({ color: '#fff', width: 0.8 * s }),
          padding: [1.5 * s, 5 * s, 0.5 * s, 5 * s], overflow: true }) }));
        st.push(new ol.style.Style({ geometry: new ol.geom.Point(lp), text: new ol.style.Text({ text: r.cls, font: font(10), offsetY: 8 * fsc * s,
          fill: new ol.style.Fill({ color: '#111' }), backgroundFill: new ol.style.Fill({ color: '#fff' }), backgroundStroke: new ol.style.Stroke({ color: r.color, width: 1 * s }),
          padding: [1.5 * s, 5 * s, 0.5 * s, 5 * s], overflow: true }) }));
      }
      return st;
    }
    return null;
  };
  // 범례: 표시 중인 하천 구분
  App.targetLegend = function () {
    const o = T(), have = new Set(App.src.target.getFeatures().filter(f => f.get('tk') === 'river').map(f => f.get('rid')));
    return RIVER.filter(r => o.river[r.id] && have.has(r.id)).map(r => ({ t: r.cls, color: r.color }));
  };

  // ------------------------------------------------------------ 거리 범위 (도면 전체를 합쳐 버퍼)
  let sig = null;
  function siteUnion() {
    const rd = new jsts.io.GeoJSONReader();
    const gs = App.sites.filter(s => s.geometry).map(s => rd.read(s.geometry));
    if (!gs.length) return null;
    let u = gs[0]; for (let i = 1; i < gs.length; i++) { try { u = u.union(gs[i]); } catch (e) { /* 건너뜀 */ } }
    return u;
  }
  const fmt3857 = new ol.format.GeoJSON();
  const to3857 = g => fmt3857.readGeometry(new jsts.io.GeoJSONWriter().write(g), { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
  function drawRings(force) {
    const s = App.sites.filter(x => x.geometry).map(x => x.id + ':' + (x.bbox || []).map(v => Math.round(v)).join(',')).join('|') + '#' + dists().join(',');
    if (!force && s === sig) return;
    sig = s;
    App.src.target.getFeatures().filter(f => f.get('tk') === 'ring').forEach(f => App.src.target.removeFeature(f));
    const u = siteUnion(); if (!u) { refreshMaps(); return; }
    dists().forEach(d => {
      let b; try { b = u.buffer(d, 24); } catch (e) { return; }
      const g = densify(to3857(b), d / 3);
      const polys = g.getType() === 'MultiPolygon' ? g.getPolygons() : [g];
      const tops = polys.map(p => { let best = null; p.getLinearRing(0).getCoordinates().forEach(c => { if (!best || c[1] > best[1]) best = c; }); return best; });
      const f = new ol.Feature(g); f.set('tk', 'ring'); f.set('d', d); f.set('label', fmtM(d)); f.set('tops', tops);
      App.src.target.addFeature(f);
    });
    refreshMaps();
  }
  function densify(g, stepM) {   // 직선 구간에도 점을 넣어 거리 상자가 화면 안에 놓이도록
    const st = stepM * 1.25;   // 대략 3857 배율 보정
    const dr = ring => { const out = []; for (let i = 0; i < ring.length - 1; i++) { const a = ring[i], b = ring[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / st)); for (let j = 0; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); } out.push(ring[ring.length - 1]); return out; };
    if (g.getType() === 'Polygon') return new ol.geom.Polygon(g.getCoordinates().map(dr));
    if (g.getType() === 'MultiPolygon') return new ol.geom.MultiPolygon(g.getCoordinates().map(p => p.map(dr)));
    return g;
  }
  App.targetRefresh = () => drawRings(false);
  App.targetLoadRivers = loadRivers;

  // ------------------------------------------------------------ 하천
  // b5Opt: 범위를 직접 줄 때 (측정지점 위치도) [minX,minY,maxX,maxY] EPSG:5186
  async function loadRivers(b5Opt, msgOpt, btnOpt) {
    const msg = msgOpt || $('#tgtMsg'), btn = btnOpt || $('#btnTgtRiver');
    let b5, ext;
    if (Array.isArray(b5Opt)) { b5 = b5Opt; ext = Math.min(b5[2] - b5[0], b5[3] - b5[1]) * 0.3; }
    else {
      const u = siteUnion();
      if (!u) { App.toast('먼저 도면을 올리세요.', 'warn'); return; }
      ext = 1500 + Math.max(...dists(), 500);
      const env = u.getEnvelopeInternal();
      b5 = [env.getMinX() - ext, env.getMinY() - ext, env.getMaxX() + ext, env.getMaxY() + ext];
    }
    const ll = [[b5[0], b5[1]], [b5[2], b5[1]], [b5[0], b5[3]], [b5[2], b5[3]]].map(p => proj4('EPSG:5186', 'EPSG:4326', p));
    const b4 = [Math.min(...ll.map(p => p[0])), Math.min(...ll.map(p => p[1])), Math.max(...ll.map(p => p[0])), Math.max(...ll.map(p => p[1]))];
    btn.disabled = true; msg.hidden = false; msg.textContent = '하천 받는 중...';
    App.src.target.getFeatures().filter(f => f.get('tk') === 'river').forEach(f => App.src.target.removeFeature(f));
    const rd = new jsts.io.GeoJSONReader(), gf = new jsts.geom.GeometryFactory();
    const clip = gf.toGeometry(new jsts.geom.Envelope(b5[0], b5[2], b5[1], b5[3]));
    const view = gf.toGeometry(new jsts.geom.Envelope(b5[0] + ext * 0.35, b5[2] - ext * 0.35, b5[1] + ext * 0.35, b5[3] - ext * 0.35));
    const errs = []; let n = 0;
    for (const r of RIVER) {
      try {
        const fc = await App.protFetchLayer(r.id, b4);
        const byName = new Map();
        (fc.features || []).forEach(f => {
          let g; try { g = rd.read(fc5186(f.geometry)); if (!g.isValid()) g = g.buffer(0); g = g.intersection(clip); } catch (e) { return; }
          if (g.isEmpty()) return;
          const nm = (f.properties && f.properties.name) || r.cls;
          const of = new ol.Feature(to3857(g)); of.set('tk', 'river'); of.set('rid', r.id); of.set('name', nm);
          // 명칭 위치: 화면 가운데 쪽(검토 범위 안) 가장 큰 조각의 안쪽 점
          let part = g; try { const v = g.intersection(view); if (!v.isEmpty()) part = v; } catch (e) { /* 전체 사용 */ }
          let big = part, ba = -1; for (let i = 0; i < part.getNumGeometries(); i++) { const q = part.getGeometryN(i); if (q.getArea() > ba) { ba = q.getArea(); big = q; } }
          const c = big.getInteriorPoint().getCoordinate();
          of.set('lp', ol.proj.transform(proj4('EPSG:5186', 'EPSG:4326', [c.x, c.y]), 'EPSG:4326', 'EPSG:3857'));
          of.set('size', ba);
          const prev = byName.get(nm); if (!prev || prev.get('size') < ba) byName.set(nm, of);
          App.src.target.addFeature(of); n++;
        });
        byName.forEach(f => f.set('labelMe', true));   // 같은 하천은 명칭 한 번만
      } catch (e) { errs.push(r.cls + ': ' + e.message); }
    }
    btn.disabled = false;
    msg.textContent = `하천 ${n}개 조각 표시` + (errs.length ? ` (오류: ${errs.join(' / ')})` : '');
    refreshMaps(); App.emit();
  }
  function fc5186(g) {   // EPSG:4326 GeoJSON 도형 → EPSG:5186
    const tr = c => (typeof c[0] === 'number' ? proj4('EPSG:4326', 'EPSG:5186', c) : c.map(tr));
    return { type: g.type, coordinates: tr(g.coordinates) };
  }

  // ------------------------------------------------------------ 표 (도면 출력 요소)
  App.targetTable = function () {
    const o = T();
    return { title: o.title, head: o.head, aroundHead: o.aroundHead,
      cols: o.rows.filter(r => Number(r.d) > 0).map(r => ({ h: `${o.head}\n~${fmtM(Number(r.d))}`, items: String(r.items || '').split(/[,\n]+(?![^(]*\))/).map(t => t.trim()).filter(Boolean) })),
      around: String(o.around || '').split(/[,\n]+(?![^(]*\))/).map(t => t.trim()).filter(Boolean) };
  };

  // ------------------------------------------------------------ 탭 UI
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function renderRows() {
    const o = T();
    $('#tgtRows').innerHTML = o.rows.map((r, i) => `<div class="tgt-row">
      <label class="unit-input"><span class="lbl">~</span><input type="number" min="1" step="10" data-tr="${i}" data-tf="d" value="${esc(r.d)}"><span class="unit">m</span></label>
      <textarea rows="2" data-tr="${i}" data-tf="items" placeholder="조사항목 (쉼표로 구분)">${esc(r.items)}</textarea>
      <button type="button" class="btn small" data-tdel="${i}" title="이 범위 빼기">빼기</button></div>`).join('');
  }
  function changed(rings) { App.saveOpts(); if (rings) drawRings(true); else refreshMaps(); if (App.layout && App.layout.redraw) App.layout.redraw(); App.emit(); }
  function build() {
    const o = T();
    renderRows();
    $('#tgtAround').value = o.around; $('#tgtTitle').value = o.title; $('#tgtHead').value = o.head;
    $('#tgtRingShow').checked = o.ringShow !== false; $('#tgtFontPct').value = o.fontPct || 100; $('#tgtRingColor').value = o.ringColor || 'auto';
    RIVER.forEach(r => { const c = document.querySelector(`[data-triv="${r.id}"]`); if (c) c.checked = o.river[r.id] !== false; });
    $('#tgtRows').addEventListener('input', e => {
      const t = e.target, i = t.dataset.tr; if (i == null) return;
      o.rows[+i][t.dataset.tf] = t.dataset.tf === 'd' ? Number(t.value) : t.value;
      changed(t.dataset.tf === 'd');
    });
    $('#tgtRows').addEventListener('click', e => { const b = e.target.closest('[data-tdel]'); if (!b) return; o.rows.splice(+b.dataset.tdel, 1); renderRows(); changed(true); });
    $('#btnTgtAdd').addEventListener('click', () => { const last = o.rows.length ? Number(o.rows[o.rows.length - 1].d) || 0 : 0; o.rows.push({ d: last ? last + 500 : 150, items: '' }); renderRows(); changed(true); });
    $('#btnTgtReset').addEventListener('click', () => { Object.assign(o, JSON.parse(JSON.stringify({ rows: DEF.rows, around: DEF.around, title: DEF.title, head: DEF.head }))); build2(); changed(true); });
    const build2 = () => { renderRows(); $('#tgtAround').value = o.around; $('#tgtTitle').value = o.title; $('#tgtHead').value = o.head; };
    $('#tgtAround').addEventListener('input', e => { o.around = e.target.value; changed(); });
    $('#tgtTitle').addEventListener('input', e => { o.title = e.target.value; changed(); });
    $('#tgtHead').addEventListener('input', e => { o.head = e.target.value; changed(); });
    $('#tgtFontPct').addEventListener('input', e => { o.fontPct = Math.max(30, Number(e.target.value) || 100); changed(); });
    $('#tgtRingShow').addEventListener('change', e => { o.ringShow = e.target.checked; changed(); });
    $('#tgtRingColor').addEventListener('change', e => { o.ringColor = e.target.value; changed(); });
    document.querySelectorAll('[data-triv]').forEach(c => c.addEventListener('change', e => { o.river[e.target.dataset.triv] = e.target.checked; changed(); }));
    $('#btnTgtRiver').addEventListener('click', () => loadRivers());
    $('#btnTgtLayout').addEventListener('click', () => { App.switchTab('layout'); App.setTheme('target'); });
    App.listeners.push(() => { if (App.theme === 'target') drawRings(false); });
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
