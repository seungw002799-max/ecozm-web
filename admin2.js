/* 행정구역 경계 (법정구역, 브이월드 2D데이터 API)
 * - 시도(LT_C_ADSIDO_INFO) · 시군구(LT_C_ADSIGG_INFO) : 항상 표시
 * - 읍면동(LT_C_ADEMD_INFO) : 도면 축척이 기준(기본 1:25,000)보다 크게 확대됐을 때만 표시
 * - 명칭은 글자마다 네모 칸 (시도 회색, 시군구 파랑, 읍면동 연파랑, 흰 글자)
 * admin.js 를 대체. prot.js 다음, project.js / app2.js 앞에 로드. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const gjf = new ol.format.GeoJSON();
  const LV = {
    sido: { data: 'LT_C_ADSIDO_INFO', field: 'ctp_kor_nm', pad: 40000, name: '시도' },
    sigg: { data: 'LT_C_ADSIGG_INFO', field: 'sig_kor_nm', pad: 30000, name: '시군구' },
    emd: { data: 'LT_C_ADEMD_INFO', field: 'emd_kor_nm', pad: 8000, name: '읍면동' },
  };
  // 명칭 칸 모양 (pt = 글자 크기)
  const TILE = {
    sido: { bg: '#827878', pt: 13 },
    sigg: { bg: '#3B8BF0', pt: 11 },
    emd: { bg: '#AFCFF5', pt: 8.5 },
  };
  let loadedKey = null, loading = false;

  App.admLook = () => {
    const c = App.opts.admCustom || {};
    return { color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#555555', pt: Number(c.pt) || 11, name: c.name || '행정구역 경계' };
  };
  const emdScale = () => Number(App.opts.admEmdScale) || 25000;

  // 글자 칸 이미지 (캐시)
  const tileCache = new Map();
  function tileImage(text, lvl, s) {
    const t = TILE[lvl]; const base = App.admLook().pt / 11;          // 명칭 크기(pt) 설정은 전체 배율로 사용
    const px = Math.max(6, t.pt * base * 0.3528 * App.PX_PER_MM96 * s);
    const key = text + '|' + lvl + '|' + px.toFixed(1);
    let c = tileCache.get(key); if (c) return c;
    const chars = [...String(text).replace(/\s+/g, '')];
    const box = Math.round(px * 1.25), gap = Math.round(px * (lvl === 'emd' ? 0.45 : 0.55)), pad = Math.ceil(px * 0.12);
    c = document.createElement('canvas');
    c.width = chars.length * box + (chars.length - 1) * gap + pad * 2; c.height = box + pad * 2;
    const g = c.getContext('2d');
    g.font = `bold ${px}px "EcoFont","Malgun Gothic",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    chars.forEach((ch, i) => {
      const x = pad + i * (box + gap), y = pad;
      g.fillStyle = t.bg; g.fillRect(x, y, box, box);
      g.lineWidth = Math.max(1, px * 0.06); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.strokeRect(x + 0.5, y + 0.5, box - 1, box - 1);
      g.lineJoin = 'round'; g.lineWidth = Math.max(1.5, px * 0.14); g.strokeStyle = lvl === 'emd' ? '#4a6a90' : '#222';
      g.strokeText(ch, x + box / 2, y + box / 2 + px * 0.04);
      g.fillStyle = '#fff'; g.fillText(ch, x + box / 2, y + box / 2 + px * 0.04);
    });
    if (tileCache.size > 400) tileCache.clear();
    tileCache.set(key, c);
    return c;
  }

  // 명칭 위치: 시도는 보이는 부분 중 도면 왼쪽 위에 가까운 곳, 시군구·읍면동은 사업지구를 피한 보이는 부분의 안쪽
  const gw = new ol.format.GeoJSON();
  let siteKey = '', siteG = null;
  function siteGeom3857(rd) {
    const k = App.sites.filter(s => s.geometry).map(s => s.id + ':' + s.area).join(',');
    if (k !== siteKey) {
      siteKey = k; siteG = null;
      App.sites.filter(s => s.feature).forEach(s => { try { const g = rd.read(gw.writeGeometryObject(s.feature.getGeometry())); siteG = siteG ? siteG.union(g) : g; } catch (e) { /* 무시 */ } });
    }
    return siteG;
  }
  function admLabelPoint(f, set) {
    const manual = f.get('labelPos'); if (manual) return manual;
    const ext = set && set.viewExtent; if (!ext) return null;
    const ck = '__alp_' + set.id, ek = ext.map(v => Math.round(v)).join(',') + '|' + siteKey;
    if (f[ck + 'k'] === ek) return f[ck];
    let pt = null;
    try {
      const rd = new jsts.io.GeoJSONReader();
      const w = ext[2] - ext[0], h = ext[3] - ext[1], m = 0.07;
      const box = rd.read({ type: 'Polygon', coordinates: [[[ext[0] + w * m, ext[1] + h * m], [ext[2] - w * m, ext[1] + h * m], [ext[2] - w * m, ext[3] - h * m], [ext[0] + w * m, ext[3] - h * m], [ext[0] + w * m, ext[1] + h * m]]] });
      let part = rd.read(gw.writeGeometryObject(f.getGeometry())).intersection(box);
      if (!part.isEmpty()) {
        const sg = siteGeom3857(rd);
        if (sg) { try { const cut = part.difference(sg.buffer(w * 0.06)); if (!cut.isEmpty() && cut.getArea() > part.getArea() * 0.05) part = cut; } catch (e) { /* 무시 */ } }
        let big = part, ba = -1;
        for (let i = 0; i < part.getNumGeometries(); i++) { const q = part.getGeometryN(i); if (q.getArea() > ba) { ba = q.getArea(); big = q; } }
        const lvl = f.get('lvl');
        if (lvl === 'sido' || lvl === 'sigg') {
          // 겹치지 않도록 기준점을 나눔: 시도는 왼쪽 위, 시군구는 가운데 위쪽 (보이는 부분 중 기준점에 가장 가까운 곳)
          const ax = lvl === 'sido' ? 0.16 : 0.62, ay = lvl === 'sido' ? 0.12 : 0.3;
          const corner = new jsts.geom.GeometryFactory().createPoint(new jsts.geom.Coordinate(ext[0] + w * ax, ext[3] - h * ay));
          const c = jsts.operation.distance.DistanceOp.nearestPoints(big, corner)[0];
          const ip = big.getInteriorPoint().getCoordinate();
          pt = [c.x + (ip.x - c.x) * 0.15, c.y + (ip.y - c.y) * 0.15];
        } else { const c = big.getInteriorPoint().getCoordinate(); pt = [c.x, c.y]; }
      }
    } catch (e) { pt = null; }
    f[ck + 'k'] = ek; f[ck] = pt;
    return pt;
  }
  App.admLabelPoint = admLabelPoint;

  const stCache = new Map();
  function lineStyle(lvl, s) {
    const lk = App.admLook(), key = lvl + lk.color + s.toFixed(3);
    let st = stCache.get(key); if (st) return st;
    const w = lvl === 'sido' ? 2.4 : lvl === 'sigg' ? 1.6 : 0.9;
    const dash = lvl === 'sido' ? [12, 4, 2, 4] : lvl === 'sigg' ? [9, 3, 2, 3] : [2, 2.5];
    st = new ol.style.Style({ stroke: new ol.style.Stroke({ color: lk.color, width: Math.max(0.6, w * s), lineDash: dash.map(v => v * s) }) });
    if (stCache.size > 200) stCache.clear(); stCache.set(key, st);
    return st;
  }
  App.admStyle = function (f, s, set, res) {
    if (!App.opts.adm) return null;
    const lvl = f.get('lvl') || 'sigg';
    // 축척(1:N) 계산: 지도 단위/px × px/mm × 1000 × 위도 보정
    if (lvl === 'emd') {
      const lat = f.get('lat') || 36.5;
      const denom = (res || 0) * Math.cos(lat * Math.PI / 180) * App.PX_PER_MM96 * s * 1000;
      if (!res || denom > emdScale()) return null;
    }
    const st = lineStyle(lvl, s);
    if (App.ADM_LABELS_OFF || App.opts.admLabel === false) return st;   // 행정구역 명칭 표시 안 함 (경계선만)
    const lp = admLabelPoint(f, set);
    if (!lp) return st;
    const custom = (App.opts.protLabelText || {})['adm|' + f.get('name')];
    const img = tileImage(custom != null && custom !== '' ? custom : f.get('name'), lvl, s);
    return [st, new ol.style.Style({ geometry: new ol.geom.Point(lp), image: new ol.style.Icon({ img }), zIndex: lvl === 'sido' ? 3 : lvl === 'sigg' ? 2 : 1 })];
  };

  function wantedBox(pad) {
    const bs = App.sites.filter(s => s.bbox).map(s => s.bbox);
    if (!bs.length) return null;
    const b = [Math.min(...bs.map(x => x[0])) - pad, Math.min(...bs.map(x => x[1])) - pad, Math.max(...bs.map(x => x[2])) + pad, Math.max(...bs.map(x => x[3])) + pad];
    return b.map(v => Math.round(v / 1000) * 1000);
  }
  async function fetchLevel(lvl) {
    const L = LV[lvl], b = wantedBox(L.pad);
    const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(p => proj4('EPSG:5186', 'EPSG:4326', p));
    const bb = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    const feats = [];
    for (let page = 1; page <= 10; page++) {
      const u = 'https://api.vworld.kr/req/data?service=data&request=GetFeature&format=json&crs=EPSG:4326&geometry=true&attribute=true&size=1000' +
        `&page=${page}&data=${L.data}&key=${App.cfg.vworldKey}&domain=${encodeURIComponent(location.origin)}&geomFilter=BOX(${bb.join(',')})`;
      const j = await App.jsonp(u);
      const r = j.response || {};
      if (r.status === 'NOT_FOUND') break;
      if (r.status !== 'OK') throw new Error((r.error && r.error.text) || r.status);
      const fs = (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
      fs.forEach(f => feats.push(f));
      if (feats.length >= (Number(r.record && r.record.total) || 0) || !fs.length) break;
    }
    // 받은 범위 밖은 잘라내고 단순화 (시도 경계는 도 전체라 꼭짓점이 수십만 개)
    const e3 = ol.proj.transformExtent(bb, 'EPSG:4326', 'EPSG:3857');
    const rd = new jsts.io.GeoJSONReader(), wr = new jsts.io.GeoJSONWriter();
    const clip = new jsts.geom.GeometryFactory().toGeometry(new jsts.geom.Envelope(e3[0], e3[2], e3[1], e3[3]));
    const tol = lvl === 'sido' ? 15 : lvl === 'sigg' ? 6 : 2;   // 3857 단위(m) 단순화 허용치
    return feats.filter(f => f.geometry).map(f => {
      const of = gjf.readFeature({ type: 'Feature', geometry: f.geometry, properties: {} }, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
      try {
        let g = rd.read(gjf.writeGeometryObject(of.getGeometry()));
        g = jsts.simplify.DouglasPeuckerSimplifier.simplify(g, tol);            // 먼저 단순화 (잘라내기 오류가 나도 가벼워지도록)
        if (!clip.getEnvelopeInternal().contains(g.getEnvelopeInternal())) { try { g = g.intersection(clip); } catch (e) { try { g = g.buffer(0).intersection(clip); } catch (e2) { /* 자르지 않고 사용 */ } } }
        if (!g.isEmpty()) of.setGeometry(gjf.readGeometry(wr.write(g)));
      } catch (e) { /* 원본 유지 */ }
      of.set('name', (f.properties || {})[L.field] || ''); of.set('kind', 'adm'); of.set('lvl', lvl);
      of.set('lat', (bb[1] + bb[3]) / 2);
      return of;
    });
  }
  async function load() {
    if (!App.opts.adm || loading) return;
    const msg = $('#admMsg');
    const b = wantedBox(0);
    if (!b) { if (msg) { msg.hidden = false; msg.textContent = '도면을 먼저 추가하면 주변 행정구역 경계를 불러옵니다.'; } return; }
    const k = b.join(',');
    if (k === loadedKey) return;
    if (!App.cfg.vworldKey || !App.jsonp) { if (msg) { msg.hidden = false; msg.textContent = '브이월드 인증키가 없습니다.'; } return; }
    loading = true;
    if (msg) { msg.hidden = false; msg.textContent = '행정구역 경계를 받는 중...'; }
    try {
      const out = [];
      for (const lvl of ['sido', 'sigg', 'emd']) out.push(...await fetchLevel(lvl));
      App.src.admin.clear(); App.src.admin.addFeatures(out);
      loadedKey = k;
      const n = l => out.filter(f => f.get('lvl') === l).length;
      if (msg) msg.textContent = `시도 ${n('sido')} · 시군구 ${n('sigg')} · 읍면동 ${n('emd')} (법정구역, 브이월드 실시간)`;
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = '행정구역 경계를 받지 못했습니다: ' + (e.message || e); }
    } finally {
      loading = false;
      App.liveSets.forEach(s => s.changed && s.changed()); App.emit();
    }
  }
  App.loadAdmin = load;

  function sync() {
    ['#admChk', '#admChk2'].forEach(id => { const c = $(id); if (c) c.checked = !!App.opts.adm; });
    ['#admLabelChk'].forEach(id => { const c = $(id); if (c) c.checked = App.opts.admLabel !== false; });
    const sc = $('#admEmdScale'); if (sc) sc.value = String(emdScale());
  }
  function build() {
    if (App.opts.admLabel === undefined || App.opts.admLabelV !== 2) { App.opts.admLabel = true; App.opts.admLabelV = 2; App.saveOpts(); }   // 새 명칭 방식은 기본으로 켬
    ['#admChk', '#admChk2'].forEach(id => {
      const c = $(id); if (!c) return;
      c.addEventListener('change', e => {
        App.opts.adm = e.target.checked; App.saveOpts(); sync();
        if (App.opts.adm) load();
        App.liveSets.forEach(s => s.changed && s.changed()); App.emit();
      });
    });
    const lc = $('#admLabelChk'); if (lc) lc.addEventListener('change', e => { App.opts.admLabel = e.target.checked; App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); App.emit(); });
    const sc = $('#admEmdScale'); if (sc) sc.addEventListener('change', e => { App.opts.admEmdScale = Number(e.target.value) || 25000; App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); App.emit(); });
    sync();
    App.listeners.push(() => { if (App.opts.adm) { const b = wantedBox(0); if (b && b.join(',') !== loadedKey) load(); } });
    if (App.opts.adm) setTimeout(load, 1500);
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
