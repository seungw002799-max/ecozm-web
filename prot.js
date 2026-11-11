/* 보호구역 검토: 사업지구 주변의 보호구역(현재: 겨울철 조류 동시센서스 조사지역)을 API 로 받아
 * 지도에 표시하고, 구역별 중첩 여부·최단거리를 표로 보여준다. app.js 다음, app2.js 앞에 로드. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);

  // 레이어 목록 (나중에 브이월드 자연공원·상수원보호구역 등을 같은 형식으로 추가)
  const VW_NOTE = '브이월드 2D데이터 API (실시간)';
  const EG_NOTE = '환경공간정보서비스 API (실시간, 중계) · 기후에너지환경부';
  const PROXY = 'https://ecozm-proxy.seungw002799.workers.dev/?url=';
  const KEI_NOTE = 'KEI 지역환경정보시스템 API (실시간, 중계) · 신산경표 산줄기 (박성태, 2010)';   // Cloudflare Workers 중계 (CORS 우회)
  const PROT = [
    { id: 'ridge1', label: '산줄기 - 백두대간', short: '백두대간(산줄기)', src: 'kei', typename: 'keilocal:mtridge_l1_pl', name: p => p.mbsnnm || '백두대간', color: '#4E342E', line: true, note: KEI_NOTE },
    { id: 'ridge2', label: '산줄기 - 정맥', short: '정맥', src: 'kei', typename: 'keilocal:mtridge_l2_pl', name: p => p.mbsnnm || '정맥', color: '#795548', line: true, note: KEI_NOTE },
    { id: 'ridge3', label: '산줄기 - 기맥', short: '기맥', src: 'kei', typename: 'keilocal:mtridge_l3_pl', name: p => p.sbsnnm || '기맥', color: '#A1887F', line: true, note: KEI_NOTE },
    { id: 'ridge4', label: '산줄기 - 지맥', short: '지맥', src: 'kei', typename: 'keilocal:mtridge_l4_pl', name: p => p.sbsnnm || '지맥', color: '#8D6E63', line: true, note: KEI_NOTE },
    { id: 'np_nat', label: '국립공원', short: '국립공원', src: 'vworld', data: 'LT_C_WGISNPGUG', name: p => p.park_name, color: '#1B7F3B', note: VW_NOTE },
    { id: 'np_do', label: '도립공원', short: '도립공원', src: 'vworld', data: 'LT_C_WGISNPDO', name: p => p.park_name, color: '#5E9E1F', note: VW_NOTE },
    { id: 'np_gun', label: '군립공원', short: '군립공원', src: 'vworld', data: 'LT_C_WGISNPGUN', name: p => p.park_name, color: '#A08A00', note: VW_NOTE },
    { id: 'wild', label: '야생생물(동·식물) 보호구역', short: '야생생물보호구역', src: 'vworld', data: 'LT_C_UM221', keep: p => !/특별/.test(p.uname || ''), name: p => [p.sigg_name, p.uname].filter(Boolean).join(' '), color: '#C62828', note: VW_NOTE },
    { id: 'wild_sp', label: '야생생물 특별보호구역', short: '야생생물특별보호구역', src: 'vworld', data: 'LT_C_UM221', attr: 'uname:like:특별', name: p => [p.sigg_name, p.uname].filter(Boolean).join(' '), color: '#8E0000', note: VW_NOTE },
    { id: 'forest_gen', label: '산림유전자원 보호구역', short: '산림유전자원보호구역', src: 'vworld', data: 'LT_C_UF151', attr: 'uname:like:산림유전자원', name: p => [p.sigg_name, p.uname].filter(Boolean).join(' '), color: '#33691E', note: VW_NOTE + ' · 산림보호구역 중 산림유전자원보호구역' },
    { id: 'baekdu', label: '백두대간보호지역', short: '백두대간보호지역', src: 'vworld', data: 'LT_C_UF901', name: p => '백두대간보호지역 ' + (p.uname && p.uname !== '백두대간보호지역' ? '(' + p.uname + ')' : ''), color: '#6D4C41', note: VW_NOTE + ' · 핵심/완충구역' },
    { id: 'wetland_c', label: '습지보호지역 (연안·지정명칭)', short: '습지보호지역(연안)', src: 'vworld', data: 'LT_C_WGISARWET', name: p => p.uname || p.name || p.wet_name || '습지보호지역', color: '#006064', note: VW_NOTE + ' · 해양수산부' },
    { id: 'wetland', label: '습지보호지역', short: '습지보호지역', src: 'vworld', data: 'LT_C_UM901', name: p => [p.sigg_name, p.uname].filter(Boolean).join(' '), color: '#00838F', note: VW_NOTE },
    { id: 'fishery', label: '수산자원보호구역', short: '수산자원보호구역', src: 'vworld', data: 'LT_C_UQ141', attr: 'uname:like:수산자원', name: p => [p.sigg_name, p.uname].filter(Boolean).join(' '), color: '#0277BD', note: VW_NOTE + ' · 국토계획 용도구역' },
    { id: 'air', label: '대기환경규제지역 (대기관리권역 등)', short: '대기환경규제지역', src: 'vworld', data: 'LT_C_UM301', name: p => [p.sigg_name, p.uname].filter(Boolean).join(' ') || '대기환경규제지역', color: '#7E57C2', note: VW_NOTE + ' · 전국 5건, 세부 구분 없음' },
    { id: 'riverside', label: '수변구역', short: '수변구역', src: 'egis', typename: 'me:wa_plg_quality_restrict', cql: "district='수변구역'", name: () => '수변구역', color: '#039BE5', note: EG_NOTE },
    { id: 'wq_special', label: '수질보전 특별대책지역', short: '수질보전특별대책지역', src: 'egis', typename: 'me:wa_plg_quality_restrict', cql: "district='수질보전특별대책지역'", name: () => '수질보전특별대책지역', color: '#00897B', note: EG_NOTE },
    { id: 'discharge', label: '배출시설 설치제한지역', short: '배출시설설치제한지역', src: 'egis', typename: 'me:wa_plg_quality_restrict', cql: "district='배출시설설치제한지역'", name: () => '배출시설설치제한지역', color: '#F4511E', note: EG_NOTE },
    { id: 'eco_land', label: '생태·경관보전지역', short: '생태경관보전지역', src: 'egis', typename: 'me:na_plg_conservation', cql: "type_code IN ('ESCA','SCAW')", name: p => p.name || '생태·경관보전지역', color: '#2E7D32', note: EG_NOTE },
    { id: 'water', label: '상수원보호구역', short: '상수원보호구역', src: 'vworld', data: 'LT_C_UM710', name: p => p.alias || [p.sigg_name, p.uname || '상수원보호구역'].filter(Boolean).join(' '), color: '#1565C0', note: VW_NOTE },
    {
      id: 'winter_bird', label: '겨울철 조류 동시센서스 조사지역', short: '조류 조사지역',
      src: 'eiagis', typename: 'WINTER_BIRD', nameField: 'name',
      color: '#7B3FA0', note: 'EIAGIS 환경영향평가 지리정보서비스 API (실시간, 중계) · 국립생물자원관 2014년 자료',
      local: 'data/winter_bird.geojson',   // EIAGIS 서버가 외부 사이트 접속(CORS)을 막아 둔 경우 쓰는 사본
    },
  ];
  const BY_ID = Object.fromEntries(PROT.map(p => [p.id, p]));
  App.PROT = PROT;

  const fmt = n => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // ------------------------------------------------------------ 지도 스타일
  const cache = new Map();
  const gjf = new ol.format.GeoJSON();
  // 명칭 위치: 직접 옮긴 위치(labelPos)가 있으면 그것, 없으면 "지금 보이는 화면 안에 들어온 부분"의 가운데
  function labelPoint(f, set) {
    const manual = f.get('labelPos'); if (manual) return manual;
    const ext = set && set.viewExtent;
    const k = '__lp_' + (set ? set.id : 0);
    if (!ext) return null;
    const ek = ext.map(v => Math.round(v)).join(',');
    if (f[k + 'key'] === ek) return f[k];
    let pt = null;
    try {
      const w = ext[2] - ext[0], h = ext[3] - ext[1], m = 0.06;
      const box = [ext[0] + w * m, ext[1] + h * m, ext[2] - w * m, ext[3] - h * m];
      const rd = new jsts.io.GeoJSONReader();
      const g = rd.read(gjf.writeGeometryObject(f.getGeometry()));
      const b = rd.read({ type: 'Polygon', coordinates: [[[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1]]]] });
      let part = g.intersection(b);
      if (!part.isEmpty()) {
        // 가장 큰 조각 안쪽 점
        let big = part, ba = -1;
        for (let i = 0; i < part.getNumGeometries(); i++) { const q = part.getGeometryN(i); const sz = q.getArea() || q.getLength(); if (sz > ba) { ba = sz; big = q; } }
        const c = big.getInteriorPoint().getCoordinate(); pt = [c.x, c.y];
      }
    } catch (e) { pt = null; }
    f[k + 'key'] = ek; f[k] = pt;
    return pt;
  }
  App.protLabelPoint = labelPoint;
  App.protStyle = function (f, s, set) {
    const p = BY_ID[f.get('kind')]; if (!p) return null;
    const show = (App.opts.protShow || {})[p.id] !== false;
    if (!show) return null;
    const key = p.id + '|' + s.toFixed(3);
    let st = cache.get(key);
    if (!st) {
      st = p.line
        ? new ol.style.Style({ stroke: new ol.style.Stroke({ color: p.color, width: Math.max(1, 3 * s) }) })
        : new ol.style.Style({
          fill: new ol.style.Fill({ color: hexA(p.color, 0.18) }),
          stroke: new ol.style.Stroke({ color: p.color, width: Math.max(0.8, 2 * s), lineDash: [6 * s, 4 * s] }),
        });
      if (cache.size > 500) cache.clear();
      cache.set(key, st);
    }
    const label = App.opts.protLabel !== false ? (f.get('name') || '') : '';
    if (!label) return st;
    const lp = labelPoint(f, set);
    if (!lp) return st;
    return [st, new ol.style.Style({ geometry: new ol.geom.Point(lp), text: new ol.style.Text({
      text: label, font: `bold ${Math.round(12 * s)}px "EcoFont","Malgun Gothic",sans-serif`,
      fill: new ol.style.Fill({ color: p.color }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 * s }), overflow: true }) })];
  };

  // ------------------------------------------------------------ 자료 받기
  // EIAGIS WFS 직접 요청 -> 막히면 사이트에 포함된 사본(같은 자료)을 사용
  const localCache = {};
  async function fetchEiagis(p, bbox4326) {
    const u = 'https://eiagissv.eiass.go.kr/EIASS/wfs?SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature' +
      `&TYPENAME=${p.typename}&outputFormat=application/json&SRSNAME=EPSG:4326&BBOX=${bbox4326.join(',')}`;
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(PROXY + encodeURIComponent(u), { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); j._src = 'EIAGIS 실시간'; return j;
    } catch (e) {
      if (!p.local) throw new Error(`${p.short} 자료를 받지 못했습니다 (${e.name === 'AbortError' ? '시간 초과' : e.message})`);
    } finally { clearTimeout(tm); }
    if (!localCache[p.id]) {
      const r = await fetch(p.local + '?v=1');
      if (!r.ok) throw new Error(`${p.short} 사본을 불러오지 못했습니다 (HTTP ${r.status})`);
      localCache[p.id] = await r.json();
    }
    // bbox 안에 걸치는 것만 (경위도 범위 비교)
    const inBox = g => { let hit = false; const walk = c => { if (hit) return; if (typeof c[0] === 'number') { if (c[0] >= bbox4326[0] && c[0] <= bbox4326[2] && c[1] >= bbox4326[1] && c[1] <= bbox4326[3]) hit = true; } else c.forEach(walk); }; walk(g.coordinates); return hit; };
    const all = localCache[p.id];
    return { type: 'FeatureCollection', features: all.features.filter(f => f.geometry && inBox(f.geometry)), _src: 'EIAGIS 사본(' + (all.fetched || '') + ')' };
  }

  // 브이월드 2D데이터 API (브라우저 직접 요청이 막혀 있어 JSONP 사용), 1000건씩 페이지
  function jsonp(url) {
    return new Promise((ok, no) => {
      const cb = 'vw_' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const tm = setTimeout(() => { cleanup(); no(new Error('시간 초과')); }, 30000);
      const cleanup = () => { clearTimeout(tm); delete window[cb]; s.remove(); };
      window[cb] = d => { cleanup(); ok(d); };
      s.onerror = () => { cleanup(); no(new Error('요청 실패')); };
      s.src = url + '&callback=' + cb;
      document.head.appendChild(s);
    });
  }
  async function fetchVworld(p, bbox4326) {
    const key = App.cfg.vworldKey;
    if (!key) throw new Error('브이월드 인증키가 없습니다.');
    const feats = [];
    for (let page = 1; page <= 20; page++) {
      const u = 'https://api.vworld.kr/req/data?service=data&request=GetFeature&format=json&crs=EPSG:4326&geometry=true&attribute=true&size=1000' +
        `&page=${page}&data=${p.data}${p.attr ? '&attrFilter=' + encodeURIComponent(p.attr) : ''}&key=${key}&domain=${encodeURIComponent(location.origin)}&geomFilter=BOX(${bbox4326.join(',')})`;
      let j;
      try { j = await jsonp(u); } catch (e) { throw new Error(`${p.short} 자료를 받지 못했습니다 (${e.message})`); }
      const r = j.response || {};
      if (r.status === 'NOT_FOUND') break;
      if (r.status !== 'OK') throw new Error(`${p.short}: ${(r.error && r.error.text) || r.status}${/인증키/.test((r.error && r.error.text) || '') ? ' (브이월드 키가 이 사이트 주소로 등록됐는지 확인)' : ''}`);
      const fs = (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
      fs.filter(f => !p.keep || p.keep(f.properties || {})).forEach(f => feats.push({ type: 'Feature', geometry: f.geometry, properties: { name: p.name(f.properties || {}) || p.short } }));
      const total = Number(r.record && r.record.total) || 0;
      if (feats.length >= total || !fs.length) break;
    }
    return { type: 'FeatureCollection', features: feats, _src: '브이월드 실시간' };
  }

  // 환경공간정보서비스 GeoServer WFS (중계 서버 경유), 조건 + 범위 필터
  async function fetchEgis(p, b) {
    const cql = (p.cql ? p.cql + ' AND ' : '') + `BBOX(geom,${b.join(',')},'EPSG:4326')`;
    const u = 'https://api.mcee.go.kr/geoserver/me/wfs?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326' +
      `&typeName=${p.typename}&CQL_FILTER=${encodeURIComponent(cql)}`;
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 40000);
    try {
      const r = await fetch(PROXY + encodeURIComponent(u), { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return { type: 'FeatureCollection', _src: '환경공간정보 실시간',
        features: (j.features || []).filter(f => f.geometry).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { name: p.name(f.properties || {}) } })) };
    } catch (e) {
      throw new Error(`${p.short} 자료를 받지 못했습니다 (${e.name === 'AbortError' ? '시간 초과' : e.message})`);
    } finally { clearTimeout(tm); }
  }

  // KEI 산줄기: 중계 서버로 실시간 요청(12초) -> 실패/잘린 응답이면 사이트에 포함된 같은 자료(신산경표, 고정 자료)를 사용
  const keiCache = {};
  async function fetchKei(p, b) {
    const layer = p.typename.split(':')[1];
    const mapF = fs => fs.filter(f => f.geometry).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { name: p.name(f.properties || {}) } }));
    const u = 'https://eiaresearch.kei.re.kr/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326' +
      `&typename=${p.typename}&bbox=${b.join(',')},EPSG:4326`;
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(PROXY + encodeURIComponent(u), { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = JSON.parse(await r.text());          // 응답이 잘리면 여기서 실패
      return { type: 'FeatureCollection', _src: 'KEI 산줄기 실시간', features: mapF(j.features || []) };
    } catch (e) { /* 사본 사용 */ } finally { clearTimeout(tm); }
    if (!keiCache[layer]) {
      const r = await fetch(`data/${layer}.geojson?v=1`);
      if (!r.ok) throw new Error(`${p.short} 자료를 받지 못했습니다 (HTTP ${r.status})`);
      keiCache[layer] = await r.json();
    }
    const inBox = g => { let hit = false; const walk = c => { if (hit) return; if (typeof c[0] === 'number') { if (c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3]) hit = true; } else c.forEach(walk); }; walk(g.coordinates); return hit; };
    return { type: 'FeatureCollection', _src: 'KEI 산줄기 사본(' + (keiCache[layer].fetched || '') + ')', features: mapF(keiCache[layer].features.filter(f => f.geometry && inBox(f.geometry))) };
  }

  // 사업지구(전체) 범위 + 반경 -> EPSG:4326 bbox [minLon,minLat,maxLon,maxLat]
  function queryBox(radiusM) {
    const bs = App.sites.filter(s => s.bbox).map(s => s.bbox);
    if (!bs.length) return null;
    const b = [Math.min(...bs.map(x => x[0])) - radiusM, Math.min(...bs.map(x => x[1])) - radiusM,
      Math.max(...bs.map(x => x[2])) + radiusM, Math.max(...bs.map(x => x[3])) + radiusM];
    const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(p => proj4('EPSG:5186', 'EPSG:4326', p));
    return { b5186: b, b4326: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))] };
  }

  // ------------------------------------------------------------ 검토
  let rows = [];
  async function run() {
    const btn = $('#btnProt'), msg = $('#protMsg');
    const chosen = PROT.filter(p => (App.opts.protOn || {})[p.id] !== false);
    if (!App.sites.some(s => s.geometry)) { App.toast && App.toast('먼저 도면을 추가하세요.', 'warn'); return; }
    if (!chosen.length) { msg.hidden = false; msg.textContent = '검토할 보호구역을 하나 이상 선택하세요.'; return; }
    const radius = Math.max(0, Number($('#protRadius').value) || 5) * 1000;
    App.opts.protRadius = radius / 1000; App.saveOpts();
    const q = queryBox(radius);
    btn.disabled = true; msg.hidden = false; msg.textContent = '보호구역 자료를 받는 중...';
    App.src.prot.clear();
    App.setArrows('prot', []);
    rows = [];
    try {
      // 사업지구 합치기 (EPSG:5186)
      const rd = new jsts.io.GeoJSONReader();
      const siteGeoms = App.sites.filter(s => s.geometry).map(s => rd.read(s.geometry));
      let site = siteGeoms[0];
      for (let i = 1; i < siteGeoms.length; i++) site = site.union(siteGeoms[i]);
      const fmt3857 = new ol.format.GeoJSON();
      const srcs = [], errs = [];
      for (const p of chosen) {
        msg.textContent = `${p.short} 받는 중...`;
        let fc;
        try { fc = p.src === 'vworld' ? await fetchVworld(p, q.b4326) : p.src === 'egis' ? await fetchEgis(p, q.b4326) : p.src === 'kei' ? await fetchKei(p, q.b4326) : await fetchEiagis(p, q.b4326); }
        catch (e) { errs.push(e.message); continue; }
        if (!srcs.includes(fc._src)) srcs.push(fc._src);
        (fc.features || []).forEach((f, i) => {
          if (!f.geometry) return;
          // 4326 -> 5186 (Z 제거)
          const tf = c => (typeof c[0] === 'number') ? proj4('EPSG:4326', 'EPSG:5186', [c[0], c[1]]) : c.map(tf);
          const g5 = { type: f.geometry.type, coordinates: tf(f.geometry.coordinates) };
          let jg; try { jg = rd.read(g5); if (!jg.isValid()) jg = jg.buffer(0); } catch (e) { return; }
          const dist = jg.distance(site);
          if (dist > radius) return;                         // 반경 밖은 제외
          let over = 0; try { over = dist === 0 ? jg.intersection(site).getArea() : 0; } catch (e) { over = 0; }
          const name = (f.properties || {})[p.nameField || 'name'] || `(이름 없음 ${i + 1})`;
          let np = null; try { if (dist > 0) np = jsts.operation.distance.DistanceOp.nearestPoints(site, jg).map(c => [c.x, c.y]); } catch (e) { np = null; }
          rows.push({ kind: p.id, kindLabel: p.short, name, dist, over, area: jg.getArea(), np });
          const of = fmt3857.readFeature({ type: 'Feature', geometry: g5, properties: {} }, { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
          of.set('kind', p.id); of.set('name', name);
          App.src.prot.addFeature(of);
        });
      }
      // 같은 구분·명칭이 여러 조각이면 한 줄로 (최근접 거리 = 가장 가까운 조각, 중첩 = 합)
      const merged = new Map();
      rows.forEach(r => { const k = r.kind + '|' + r.name.trim(); const m = merged.get(k); if (!m) merged.set(k, Object.assign({}, r, { name: r.name.trim() })); else { if (r.dist < m.dist) { m.dist = r.dist; m.np = r.np; } m.over += r.over; } });
      rows = [...merged.values()];
      rows.sort((a, b) => a.dist - b.dist);
      // 화살표: 구분별 가장 가까운 1곳만 기본으로 켬 (겹치는 곳 제외)
      const seenKind = new Set();
      rows.forEach((r, i) => { r.key = 'p' + i; r.arrow = false; if (r.np && !seenKind.has(r.kind)) { r.arrow = true; seenKind.add(r.kind); } });
      syncArrows();
      msg.textContent = (rows.length ? `완료: 반경 ${fmt(radius / 1000)}km 안에 ${rows.length}곳 (사업지구 경계 기준 최근접 거리)` : `반경 ${fmt(radius / 1000)}km 안에 해당 보호구역이 없습니다.`) + ` · 자료: ${srcs.join(', ')}` + (errs.length ? ` · 오류: ${errs.join(' / ')}` : '');
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
      renderTable();
      App.liveSets.forEach(s => s.changed());
      App.emit();
    }
  }

  function renderTable() {
    const t = $('#protTable');
    if (!rows.length) { t.innerHTML = ''; t.hidden = true; return; }
    t.hidden = false;
    t.innerHTML = '<tr><th title="최근접 거리 화살표">↔</th><th>구분</th><th>명칭</th><th>거리(km)</th><th>중첩(㎡)</th></tr>' + rows.map(r =>
      `<tr><td>${r.np ? `<input type="checkbox" data-arrow="${r.key}" ${r.arrow ? 'checked' : ''}>` : ''}</td><td class="cat">${r.kindLabel}</td><td style="text-align:left">${r.name}</td><td>${r.dist === 0 ? '0.00' : App.fmtDist(r.dist, false)}</td>` +
      `<td>${r.over > 0 ? `<b class="ok-blue">${fmt(r.over)}</b>` : (r.dist === 0 ? '<b class="ok-blue">통과</b>' : '-')}</td></tr>`).join('');
  }
  App.protRows = () => rows;
  function syncArrows() {
    App.setArrows('prot', rows.filter(r => r.np).map(r => ({ key: r.key, pts: r.np, on: r.arrow, label: `${App.fmtDist(r.dist)} 이격` })));
  }

  // ------------------------------------------------------------ UI
  function build() {
    App.opts.protOn = App.opts.protOn || {};
    App.opts.protShow = App.opts.protShow || {};
    // 출처 표시: "기관 API (실시간, 중계) · 추가설명" -> 기관 한 줄 + 태그 + 추가설명 줄
    const noteHtml = n => {
      const parts = String(n || '').split(' · ');
      const m = parts[0].match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      const src = m ? m[1] : parts[0], tags = m ? m[2].split(/,\s*/) : [];
      return `<span class="src-line">${src}${tags.map(t => `<span class="tag ${/중계|사본/.test(t) ? 'tag-gray' : ''}">${t}</span>`).join('')}</span>` +
        parts.slice(1).map(x => `<span class="src-extra">${x}</span>`).join('');
    };
    $('#protList').innerHTML = PROT.map(p => `
      <label class="prot-item"><input type="checkbox" data-prot="${p.id}" ${App.opts.protOn[p.id] !== false ? 'checked' : ''}>
        <span class="swatch${p.line ? ' swatch-line' : ''}" style="border-color:${p.color};background:${p.line ? 'transparent' : hexA(p.color, 0.18)}"></span>
        <span class="prot-text"><b>${p.label}</b>${noteHtml(p.note)}</span></label>`).join('');
    $('#protRadius').value = App.opts.protRadius || 5;
    $('#protLabelChk').checked = App.opts.protLabel !== false;
    $('#protList').addEventListener('change', e => {
      const id = e.target.dataset.prot; if (!id) return;
      App.opts.protOn[id] = e.target.checked; App.opts.protShow[id] = e.target.checked; App.saveOpts();
      App.liveSets.forEach(s => s.changed()); App.emit();
    });
    $('#protLabelChk').addEventListener('change', e => { App.opts.protLabel = e.target.checked; App.saveOpts(); cache.clear(); App.liveSets.forEach(s => s.changed()); App.emit(); });
    $('#btnProt').addEventListener('click', run);
    $('#protTable').addEventListener('change', e => {
      const k = e.target.dataset.arrow; if (!k) return;
      const r = rows.find(x => x.key === k); if (r) { r.arrow = e.target.checked; syncArrows(); }
    });
  }
  // 범례용: 지도에 실제로 표시된 보호구역 종류
  App.protLegend = () => PROT.filter(p => (App.opts.protShow || {})[p.id] !== false && App.src.prot.getFeatures().some(f => f.get('kind') === p.id));

  // App.init(설정 불러오기) 이후에 UI 구성
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
