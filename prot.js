/* 보호구역 검토: 사업지구 주변의 보호구역(현재: 겨울철 조류 동시센서스 조사지역)을 API 로 받아
 * 지도에 표시하고, 구역별 중첩 여부·최단거리를 표로 보여준다. app.js 다음, app2.js 앞에 로드. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);

  // 레이어 목록 (나중에 브이월드 자연공원·상수원보호구역 등을 같은 형식으로 추가)
  // 출처 표기: src = 기관/서비스명, tags = 연결 방식, extra = 보충 설명(아랫줄)
  const PROXY = 'https://ecozm-proxy.seungw002799.workers.dev/?url=';
  const VW = { src: '브이월드 2D데이터 API', tags: ['실시간'] };
  const EG = { src: '환경공간정보서비스 API', tags: ['실시간', '중계'], extra: '기후에너지환경부' };
  const KEI = { src: 'KEI 지역환경정보시스템 API', tags: ['실시간', '중계'], extra: '신산경표 산줄기 (박성태, 2010)' };
  const NIER = { src: '물환경정보시스템 API', tags: ['실시간'], extra: ['국립환경과학원 수질오염총량 단위유역', '표에는 사업지구가 속한 유역만, 지도에는 맞닿은 주변 유역도 표시'] };
  const EIA = { src: 'EIAGIS API', tags: ['실시간', '중계'], extra: ['환경영향평가 지리정보서비스', '국립생물자원관 2014년 자료'] };
  const ECZ = { src: '에코뱅크 생태자연도 API (국립생태원)', tags: ['실시간'], extra: ['1등급 권역만 표시', '반경이 크면 받는 데 시간이 걸립니다'] };
  // 별도관리지역: 생태자연도 등급과 별개인 법정 보호지역 모음. 모두 브이월드(국토교통부 토지이용규제 등), 생태·경관보전지역만 브이월드에 없어 환경공간정보서비스
  const SEP = { src: '브이월드 2D데이터 API', tags: ['실시간'], extra: ['생태자연도 중 별도관리지역'] };
  // 천연기념물 명칭: 별칭(alias)에 이름, 비고(remark)에 지정번호가 있는 경우가 많아 '이름 (천연기념물 제○호)' 로 합침
  const uo = p => { const a = (p.alias || '').trim(), r = (p.remark || '').trim(); if (/천연기념물/.test(r) && a && !/천연기념물/.test(a)) return a + ' (' + r + ')'; if (/천연기념물/.test(a)) return a; return r || a || '천연기념물'; };
  const sg = p => [p.sigg_name, p.uname].filter(Boolean).join(' ');
  // 야생생물 보호구역: 자료 명칭이 옛 법령 이름(야생동·식물)이라 현행 이름으로 표기
  const sgW = p => sg(p).replace(/야생동·식물/g, '야생생물');
  // 묶음(group)은 목록에서 한 칸으로 보이고, 안의 항목을 각각 켜고 끌 수 있다. cat 은 비슷한 것끼리 모으는 구분
  const GROUPS = {
    sep: { label: '별도관리지역', note: SEP },
    ridge: { label: '백두대간 및 산줄기 (정맥·기맥·지맥)', note: KEI },
    river: { label: '하천 (국가·지방)', note: { src: '하천정보관리시스템(RIMGIS) API', tags: ['실시간', '중계'], extra: ['하천망도 (기후에너지환경부)', '소하천은 환경공간정보서비스 묶음에 있음'] } },
    egis: { label: '환경공간정보서비스', note: { src: '환경공간정보서비스 API', tags: ['실시간', '중계'], extra: ['기후에너지환경부'] } },
  };
  // 출처(제공 기관)별로 분류: 검증할 때 어디 자료인지 바로 보이도록
  const CATS = { ecobank: '에코뱅크 (국립생태원)', vworld: '브이월드 (국토교통부 등)', egis: '환경공간정보서비스 (기후에너지환경부)', kei: 'KEI 지역환경정보시스템', rim: '하천정보관리시스템 (RIMGIS)', nibr: '국립생물자원관', nier: '물환경정보시스템 (국립환경과학원)' };
  const PROT = [
    // ecobank
    { cat: 'ecobank', id: 'eco1', grade: '1', label: '생태자연도 1등급', short: '생태자연도 1등급', src: 'eco1', name: () => '생태자연도 1등급', labelNearest: true, color: '#1AA800', note: ECZ },
    // vworld
    { cat: 'vworld', group: 'sep', id: 'forest_gen', label: '산림유전자원보호구역 (산림보호구역 중)', short: '산림유전자원보호구역', src: 'vworld', data: 'LT_C_UF151', attr: 'uname:like:산림유전자원', name: sg, color: '#33691E', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'np_nat', label: '국립공원', short: '국립공원', src: 'vworld', data: 'LT_C_WGISNPGUG', name: p => p.park_name, color: '#1B7F3B', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'np_do', label: '도립공원', short: '도립공원', src: 'vworld', data: 'LT_C_WGISNPDO', name: p => p.park_name, color: '#5E9E1F', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'np_gun', label: '군립공원', short: '군립공원', src: 'vworld', data: 'LT_C_WGISNPGUN', name: p => p.park_name, color: '#A08A00', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'monument', label: '천연기념물 (국가유산보호도)', short: '천연기념물', src: 'vworld', data: 'LT_C_UO301', attrs: ['remark:like:천연기념물', 'alias:like:천연기념물'], keep: p => !/역사문화환경보존|현상변경/.test(p.uname || ''), name: uo, color: '#BF360C', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'wild', label: '야생생물 보호구역', short: '야생생물 보호구역', src: 'vworld', data: 'LT_C_UM221', keep: p => !/특별/.test(p.uname || ''), name: sgW, uid: p => [p.dyear, p.dnum].filter(Boolean).join('-'), color: '#C62828', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'wild_sp', label: '야생생물 특별보호구역', short: '야생생물 특별보호구역', src: 'vworld', data: 'LT_C_UM221', attr: 'uname:like:특별', name: sgW, uid: p => [p.dyear, p.dnum].filter(Boolean).join('-'), color: '#8E0000', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'fishery', label: '수산자원보호구역', short: '수산자원보호구역', src: 'vworld', data: 'LT_C_UQ141', attr: 'uname:like:수산자원', name: sg, color: '#D81B60', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'wetland', label: '습지보호지역 (내륙)', short: '습지보호지역', src: 'vworld', data: 'LT_C_UM901', name: sg, color: '#00838F', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'wetland_c', label: '습지보호지역 (연안, 해양수산부)', short: '연안 습지보호지역', src: 'vworld', data: 'LT_C_WGISARWET', name: p => p.uname || p.name || p.wet_name || '습지보호지역', color: '#006064', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'baekdu', label: '백두대간보호지역', short: '백두대간보호지역', src: 'vworld', data: 'LT_C_UF901', name: p => '백두대간보호지역' + (p.uname && p.uname !== '백두대간보호지역' ? ' (' + p.uname + ')' : ''), color: '#6D4C41', note: SEP },
    // egis
    { cat: 'egis', group: 'egis', id: 'eco_land', label: '생태·경관보전지역', short: '생태·경관보전지역', src: 'egis', typename: 'me:na_plg_conservation', cql: "type_code IN ('ESCA','SCAW')", name: p => p.name || '생태·경관보전지역', color: '#2E7D32', note: SEP },
    { cat: 'egis', group: 'egis', id: 'inland_wet', label: '내륙습지', short: '내륙습지', src: 'egis', typename: 'me:na_plg_wetland', name: p => p.wl_nm || '내륙습지', color: '#26A69A', note: Object.assign({}, EG, { extra: '국가 내륙습지 목록 (인공습지 포함)' }) },
    { cat: 'egis', group: 'egis', id: 'riverside', label: '수변구역', short: '수변구역', src: 'egis', typename: 'me:wa_plg_quality_restrict', cql: "district='수변구역'", name: () => '수변구역', color: '#29B6F6', note: EG },
    { cat: 'egis', group: 'egis', id: 'discharge', label: '폐수배출시설 설치제한지역', short: '폐수배출시설 설치제한지역', src: 'egis', typename: 'me:wa_plg_quality_restrict', cql: "district='배출시설설치제한지역'", name: () => '폐수배출시설 설치제한지역', color: '#F4511E', note: Object.assign({}, EG, { extra: '물환경보전법 제33조' }) },
    { cat: 'egis', group: 'egis', id: 'wq_special', label: '상수원 수질보전 특별대책지역', short: '상수원 수질보전 특별대책지역', src: 'egis', typename: 'me:wa_plg_quality_restrict', cql: "district='수질보전특별대책지역'", name: () => '특별대책지역', nameG: (p, g) => { let y = null; const w = c => { if (y !== null) return; if (typeof c[0] === 'number') y = c[1]; else c.forEach(w); }; w(g.coordinates); return (y > 37 ? '팔당호' : '대청호') + ' 특별대책지역'; }, color: '#00897B', note: Object.assign({}, EG, { extra: '팔당·대청호 2곳' }) },
    { cat: 'egis', group: 'egis', id: 'river_small', label: '소하천 (소하천구역)', short: '소하천', src: 'wfsb', base: 'https://api.mcee.go.kr/geoserver/ows', typename: 'EGIS:K33UJC100', name: () => '소하천구역', labelNearest: true, color: '#7986CB', note: VW },
    { cat: 'egis', group: 'egis', id: 'water', label: '상수원보호구역', short: '상수원보호구역', src: 'egis', typename: 'me:wa_plg_quality_restrict', cql: "district='상수원보호구역'", name: () => '상수원보호구역', color: '#1565C0', note: EG },
    { cat: 'egis', group: 'egis', id: 'air', label: '대기환경규제지역', short: '대기환경규제지역', src: 'egis', typename: 'me:ca_plg_air_restrict', name: () => '대기환경규제지역', color: '#FFB300', note: EG },
    // kei
    { cat: 'kei', group: 'ridge', id: 'ridge1', label: '백두대간', short: '백두대간', src: 'kei', typename: 'keilocal:mtridge_l1_pl', name: p => p.mbsnnm || '백두대간', color: '#4E342E', line: true, note: KEI },
    { cat: 'kei', group: 'ridge', id: 'ridge2', label: '정맥', short: '정맥', src: 'kei', typename: 'keilocal:mtridge_l2_pl', name: p => p.mbsnnm || '정맥', color: '#795548', line: true, note: KEI },
    { cat: 'kei', group: 'ridge', id: 'ridge3', label: '기맥', short: '기맥', src: 'kei', typename: 'keilocal:mtridge_l3_pl', name: p => p.sbsnnm || '기맥', color: '#A1887F', line: true, note: KEI },
    { cat: 'kei', group: 'ridge', id: 'ridge4', label: '지맥', short: '지맥', src: 'kei', typename: 'keilocal:mtridge_l4_pl', name: p => p.sbsnnm || '지맥', color: '#8D6E63', line: true, note: KEI },
    // rim
    { cat: 'rim', group: 'river', id: 'river_nat', label: '국가하천', short: '국가하천', src: 'wfsb', base: 'https://www.river.go.kr/geoserver/rimgis/wfs', typename: 'rimgis:tb_riverlist_1', name: p => p.rivnm || '국가하천', color: '#1A237E', note: VW },
    { cat: 'rim', group: 'river', id: 'river_loc', label: '지방하천', short: '지방하천', src: 'wfsb', base: 'https://www.river.go.kr/geoserver/rimgis/wfs', typename: 'rimgis:tb_riverlist_2', name: p => p.rivnm || '지방하천', color: '#3F51B5', note: VW },
    // nibr
    { cat: 'nibr', id: 'winter_bird', label: '겨울철 조류 동시센서스 조사지역', short: '겨울철 철새 도래지', src: 'local', nameField: 'name', nameFmt: n => n + ' 겨울철 철새 도래지', mapLabel: t => t.replace(/\s*겨울철 철새 도래지$/, '\n겨울철 철새 도래지'), color: '#7B3FA0', note: { src: '국립생물자원관 철새정보시스템', tags: ['2025-2026'], extra: ['동시센서스 조사지역 200개소 (2026.04.10 편집)', '자료실 지도파일을 사이트에 넣어 사용'] },
      local: 'data/winter_bird_2025.geojson' },   // 해마다 새 조사지역 파일이 올라오면 교체 (이전: EIAGIS 2014년 자료)
    // nier
    { cat: 'nier', id: 'tmdl', label: '수질오염총량 관리지역 (단위유역)', short: '수질오염총량 단위유역', src: 'nier', typename: 'water_new:tmdl_polygon', name: p => (p.tm_unit_nm || '') + ' 단위유역', overlapOnly: true, color: '#546E7A', note: NIER },
  ];
  const BY_ID = Object.fromEntries(PROT.map(p => [p.id, p]));
  // 도면 출력에서 바꾼 표시 이름·색·글자 크기 (App.opts.protCustom[id])
  App.protLook = p => {
    const c = ((App.opts.protCustom || {})[p.id]) || {};
    const dDash = p.line || p.src === 'eco1' ? 'solid' : 'dashed', dW = p.line ? 3 : p.src === 'eco1' ? 1 : 2;
    return { name: c.name || p.short, color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : p.color, pt: Number(c.pt) || 9,
      dash: ['solid', 'dashed', 'dotted'].includes(c.dash) ? c.dash : dDash, width: Number(c.width) > 0 ? Number(c.width) : dW };
  };
  App.protLabelKey = f => f.get('kind') + '|' + (f.get('name') || '');
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
    const nb = p.overlapOnly && !f.get('host');
    const lk = App.protLook(p), col = lk.color;
    const key = p.id + '|' + s.toFixed(3) + (nb ? '|nb' : '') + '|' + col + '|' + lk.dash + '|' + lk.width;
    const w = Math.max(0.5, lk.width * s), dsh = lk.dash === 'dashed' ? [6 * s, 4 * s] : lk.dash === 'dotted' ? [1.2 * s, 2.5 * s] : undefined;
    let st = cache.get(key);
    if (!st) {
      // 선 색·굵기·종류는 레이어 모음 탭의 '레이어 선 스타일'에서 바꿈
      st = p.line
        ? new ol.style.Style({ stroke: new ol.style.Stroke({ color: col, width: w, lineDash: dsh }) })
        : nb
        ? new ol.style.Style({ stroke: new ol.style.Stroke({ color: col, width: Math.max(0.8, 1.6 * s), lineDash: [6 * s, 4 * s] }) })
        : p.src === 'eco1'
        ? new ol.style.Style({ fill: new ol.style.Fill({ color: hexA(col, 0.45) }), stroke: new ol.style.Stroke({ color: col, width: w, lineDash: dsh }) })
        : new ol.style.Style({ fill: new ol.style.Fill({ color: hexA(col, 0.18) }), stroke: new ol.style.Stroke({ color: col, width: w, lineDash: dsh }) });
      if (cache.size > 500) cache.clear();
      cache.set(key, st);
    }
    if (p.labelNearest && !f.get('labelMe')) return st;
    const custom = (App.opts.protLabelText || {})[App.protLabelKey(f)];
    const label = App.opts.protLabel !== false ? (custom != null && custom !== '' ? custom : (p.mapLabel ? p.mapLabel(f.get('name') || '') : (f.get('name') || ''))) : '';
    if (!label) return st;
    const lp = labelPoint(f, set);
    if (!lp) return st;
    return [st, new ol.style.Style({ geometry: new ol.geom.Point(lp), text: new ol.style.Text({
      text: label, font: `bold ${Math.round(lk.pt * 0.3528 * App.PX_PER_MM96 * s * 10) / 10}px "EcoFont","Malgun Gothic",sans-serif`,
      fill: new ol.style.Fill({ color: col }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 * s }), overflow: true }) })];
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
  App.jsonp = jsonp;
  async function fetchVworld(p, bbox4326) {
    if (p.attrs && p.attrs.length) {   // 조건 여러 개: 각각 받아 합침 (같은 구역은 한 번만)
      const seen = new Set(), feats = [];
      for (const a of p.attrs) { const r = await fetchVworld(Object.assign({}, p, { attrs: null, attr: a }), bbox4326); r.features.forEach(f => { const k = JSON.stringify(f.geometry.coordinates).slice(0, 200); if (!seen.has(k)) { seen.add(k); feats.push(f); } }); }
      return { type: 'FeatureCollection', features: feats, _src: '브이월드 실시간' };
    }
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
      fs.filter(f => !p.keep || p.keep(f.properties || {})).forEach(f => feats.push({ type: 'Feature', geometry: f.geometry, properties: { name: p.name(f.properties || {}) || p.short, uid: p.uid ? p.uid(f.properties || {}) : '' } }));
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
        features: (j.features || []).filter(f => f.geometry).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { name: p.nameG ? p.nameG(f.properties || {}, f.geometry) : p.name(f.properties || {}) } })) };
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

  // 물환경정보시스템 GeoServer WFS (이 사이트 주소에서 직접 받기 허용됨)
  async function fetchNier(p, b) {
    const u = 'https://water.nier.go.kr/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326' +
      `&typeName=${p.typename}&bbox=${b.join(',')},EPSG:4326`;
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 30000);
    let j;
    try {
      let r; try { r = await fetch(u, { signal: ac.signal }); } catch (e) { r = await fetch(PROXY + encodeURIComponent(u), { signal: ac.signal }); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      j = await r.json();
    } catch (e) { throw new Error(`${p.short} 자료를 받지 못했습니다 (${e.name === 'AbortError' ? '시간 초과' : e.message})`); }
    finally { clearTimeout(tm); }
    return { type: 'FeatureCollection', _src: '물환경정보시스템 실시간',
      features: (j.features || []).filter(f => f.geometry).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { name: p.name(f.properties || {}) } })) };
  }

  // 생태자연도 1등급: 생태자연도 탭에서 받아 둔 자료가 범위를 덮으면 재사용, 아니면 새로 받기 (EPSG:5186)
  async function fetchEco1(p, b, msg) {
    if (!App.cfg.dataGoKrKey) throw new Error('생태자연도: data.go.kr 인증키가 없습니다.');
    const c = App.eczmCache;
    let feats;
    if (c && c.bbox[0] <= b[0] && c.bbox[1] <= b[1] && c.bbox[2] >= b[2] && c.bbox[3] >= b[3]) feats = c.features;
    else {
      try {
        const got = await App.collectEczm(b, (calls, n) => { msg.textContent = `생태자연도 받는 중... 호출 ${calls}회, 폴리곤 ${n.toLocaleString()}개`; });
        feats = got.features;
        App.eczmCache = { bbox: b, features: feats };
      } catch (e) { throw new Error(`생태자연도 자료를 받지 못했습니다 (${e.message})`); }
    }
    return { type: 'FeatureCollection', _src: '생태자연도 실시간', _crs5186: true,
      features: feats.filter(f => f.geometry && String((f.properties || {}).eczm_grad) === p.grade).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { name: p.name() } })) };
  }

  // 일반 WFS (bbox 조건, 중계 서버 경유): 하천정보관리시스템 하천망도, 환경공간정보 소하천구역
  async function fetchWfsBbox(p, b) {
    const u = `${p.base}?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&typeName=${p.typename}&bbox=${b.join(',')},EPSG:4326`;
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 40000);
    try {
      const r = await fetch(PROXY + encodeURIComponent(u), { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = JSON.parse(await r.text());
      return { type: 'FeatureCollection', _src: /river\.go\.kr/.test(p.base) ? '하천정보관리시스템 실시간' : '환경공간정보 실시간',
        features: (j.features || []).filter(f => f.geometry).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { name: p.name(f.properties || {}) } })) };
    } catch (e) { throw new Error(`${p.short} 자료를 받지 못했습니다 (${e.name === 'AbortError' ? '시간 초과' : e.message})`); }
    finally { clearTimeout(tm); }
  }

  // 사이트에 넣어 둔 자료 (예: 국립생물자원관 동시센서스 조사지역 지도파일)
  async function fetchLocal(p, b) {
    if (!localCache[p.id]) {
      const r = await fetch(p.local + '?v=2');
      if (!r.ok) throw new Error(`${p.short} 자료를 불러오지 못했습니다 (HTTP ${r.status})`);
      localCache[p.id] = await r.json();
    }
    const all = localCache[p.id];
    const inBox = g => { const e = [Infinity, Infinity, -Infinity, -Infinity]; const walk = c => { if (typeof c[0] === 'number') { e[0] = Math.min(e[0], c[0]); e[1] = Math.min(e[1], c[1]); e[2] = Math.max(e[2], c[0]); e[3] = Math.max(e[3], c[1]); } else c.forEach(walk); }; walk(g.coordinates); return e[0] <= b[2] && e[2] >= b[0] && e[1] <= b[3] && e[3] >= b[1]; };   // 범위가 겹치면 포함
    return { type: 'FeatureCollection', _src: '국립생물자원관 ' + (all.fetched || ''), features: all.features.filter(f => f.geometry && inBox(f.geometry)) };
  }

  // 사업지구(전체) 범위 + 반경 -> EPSG:4326 bbox [minLon,minLat,maxLon,maxLat]
  let pointCtx = null;
  const fcCache = new Map();   // 세션 동안 받은 레이어 자료 (레이어|범위 → 자료)   // 초기 입지 검토: 도면 대신 한 점(EPSG:5186)을 기준으로 조회
  function queryBox(radiusM) {
    const bs = pointCtx ? [[pointCtx.pt[0], pointCtx.pt[1], pointCtx.pt[0], pointCtx.pt[1]]] : App.sites.filter(s => s.bbox).map(s => s.bbox);
    if (!bs.length) return null;
    const b = [Math.min(...bs.map(x => x[0])) - radiusM, Math.min(...bs.map(x => x[1])) - radiusM,
      Math.max(...bs.map(x => x[2])) + radiusM, Math.max(...bs.map(x => x[3])) + radiusM];
    const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(p => proj4('EPSG:5186', 'EPSG:4326', p));
    return { b5186: b, b4326: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))] };
  }

  // ------------------------------------------------------------ 검토
  let rows = [];
  async function run(radiusKm) {
    const btn = pointCtx ? pointCtx.btn : $('#btnProt'), msg = pointCtx ? pointCtx.msg : $('#protMsg');
    const chosen = PROT.filter(p => (App.opts.protOn || {})[p.id] !== false);
    if (!pointCtx && !App.sites.some(s => s.geometry)) { App.toast && App.toast('먼저 도면을 추가하세요.', 'warn'); return; }
    if (!chosen.length) { msg.hidden = false; msg.textContent = '검토할 보호구역을 하나 이상 선택하세요.'; return; }
    const radius = (radiusKm != null ? Math.max(0.1, Number(radiusKm)) : Math.max(0, Number($('#protRadius').value) || 5)) * 1000;
    if (radiusKm == null) { App.opts.protRadius = radius / 1000; App.saveOpts(); }
    const q = queryBox(radius);
    btn.disabled = true; msg.hidden = false; msg.textContent = '보호구역 자료를 받는 중...';
    App.src.prot.clear();
    App.setArrows('prot', []);
    rows = [];
    try {
      // 사업지구 합치기 (EPSG:5186)
      const rd = new jsts.io.GeoJSONReader();
      let site;
      if (pointCtx) site = new jsts.geom.GeometryFactory().createPoint(new jsts.geom.Coordinate(pointCtx.pt[0], pointCtx.pt[1])).buffer(1);   // 검토 지점 (반지름 1m)
      else { const siteGeoms = App.sites.filter(s => s.geometry).map(s => rd.read(s.geometry)); site = siteGeoms[0]; for (let i = 1; i < siteGeoms.length; i++) site = site.union(siteGeoms[i]); }
      const fmt3857 = new ol.format.GeoJSON();
      // 지도용 도형: 검토 범위(+여유) 밖은 잘라내고 1m 단위로 단순화 (거리·중첩 계산은 원본 도형으로)
      const gwr = new jsts.io.GeoJSONWriter(), gfac = new jsts.geom.GeometryFactory();
      const clipOf = rM => { const b = queryBox(rM * 1.3 + 2000).b5186; return gfac.toGeometry(new jsts.geom.Envelope(b[0], b[2], b[1], b[3])); };
      const clipR = clipOf(radius), clipBig = clipOf(Math.max(radius, 20000));
      const disp = (jg, g5, clip) => {
        try {
          let d = jg;
          if (!clip.getEnvelopeInternal().contains(d.getEnvelopeInternal())) d = d.intersection(clip);
          d = jsts.simplify.DouglasPeuckerSimplifier.simplify(d, 1.0);
          return d.isEmpty() ? g5 : gwr.write(d);
        } catch (e) { return g5; }
      };
      const srcs = [], errs = [];
      // 자료 받기: 4개씩 동시에 받고(순서는 유지), 같은 범위로 다시 조회하면 이번 세션에서 받아 둔 자료를 그대로 사용
      const fetchOne = p => p.src === 'vworld' ? fetchVworld(p, q.b4326) : p.src === 'egis' ? fetchEgis(p, q.b4326) : p.src === 'kei' ? fetchKei(p, q.b4326) : p.src === 'nier' ? fetchNier(p, queryBox(Math.max(radius, 20000)).b4326) : p.src === 'eco1' ? fetchEco1(p, q.b5186, msg) : p.src === 'local' ? fetchLocal(p, q.b4326) : p.src === 'wfsb' ? fetchWfsBbox(p, q.b4326) : fetchEiagis(p, q.b4326);
      const bkey = q.b4326.map(v => v.toFixed(4)).join(',');
      const got = new Array(chosen.length); let done = 0, next = 0;
      const worker = async () => {
        while (next < chosen.length) {
          const i = next++, p = chosen[i], ck = p.id + '|' + bkey;
          try { got[i] = fcCache.get(ck) || await fetchOne(p); if (!got[i].error) fcCache.set(ck, got[i]); }
          catch (e) { got[i] = { error: e.message }; }
          done++; msg.textContent = `레이어 받는 중... ${done} / ${chosen.length}`;
        }
      };
      msg.textContent = `레이어 받는 중... 0 / ${chosen.length}`;
      await Promise.all(Array.from({ length: Math.min(4, chosen.length) }, worker));
      if (fcCache.size > 80) fcCache.clear();
      for (let ci = 0; ci < chosen.length; ci++) {
        const p = chosen[ci];
        msg.textContent = `거리 계산 중... ${ci + 1} / ${chosen.length} (${p.short})`;
        await new Promise(r => setTimeout(r, 0));   // 화면이 멈추지 않도록 한 레이어마다 숨 돌리기
        const fc = got[ci];
        if (!fc || fc.error) { errs.push((fc && fc.error) || `${p.short} 자료 없음`); continue; }
        if (!srcs.includes(fc._src)) srcs.push(fc._src);
        const nbr = [], hosts = [];   // 단위유역: 사업지구가 속하지 않은 주변 유역 (지도 표시용)
        (fc.features || []).forEach((f, i) => {
          if (!f.geometry) return;
          // 4326 -> 5186 (Z 제거)
          const tf = c => (typeof c[0] === 'number') ? (fc._crs5186 ? [c[0], c[1]] : proj4('EPSG:4326', 'EPSG:5186', [c[0], c[1]])) : c.map(tf);
          const g5 = { type: f.geometry.type, coordinates: tf(f.geometry.coordinates) };
          let jg; try { jg = rd.read(g5); if (!jg.isValid()) jg = jg.buffer(0); } catch (e) { return; }
          const dist = jg.distance(site);
          if (p.overlapOnly && dist > 0) { nbr.push({ jg, g5: disp(jg, g5, clipBig), dist, name: (f.properties || {}).name || '' }); return; }   // 표에는 속한 유역만
          if (dist > radius) return;                         // 반경 밖은 제외
          let over = 0; try { over = dist === 0 ? jg.intersection(site).getArea() : 0; } catch (e) { over = 0; }
          const raw = (f.properties || {})[p.nameField || 'name'];
          const name = raw ? (p.nameFmt ? p.nameFmt(raw) : raw) : `(이름 없음 ${i + 1})`;
          let np = null; try { if (dist > 0) np = jsts.operation.distance.DistanceOp.nearestPoints(site, jg).map(c => [c.x, c.y]); } catch (e) { np = null; }
          rows.push({ kind: p.id, kindLabel: p.short, name, uid: (f.properties || {}).uid || '', dist, over, area: jg.getArea(), np });
          const of = fmt3857.readFeature({ type: 'Feature', geometry: disp(jg, g5, p.overlapOnly ? clipBig : clipR), properties: {} }, { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
          of.set('kind', p.id); of.set('name', name); of.set('dist', dist); of.set('area', jg.getArea());
          if (p.overlapOnly) { of.set('host', true); hosts.push(jg); }
          App.src.prot.addFeature(of);
        });
        // 주변 단위유역: 속한 유역과 맞닿은 유역 + 검토 반경 안의 유역을 함께 표시 (표·화살표에는 넣지 않음)
        nbr.forEach(n => {
          const touch = hosts.some(h => { try { return h.distance(n.jg) < 50; } catch (e) { return false; } });
          if (!touch && n.dist > radius) return;
          const of = fmt3857.readFeature({ type: 'Feature', geometry: n.g5, properties: {} }, { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
          of.set('kind', p.id); of.set('name', n.name); of.set('dist', n.dist); of.set('host', false);
          App.src.prot.addFeature(of);
        });
        if (p.labelNearest) {   // 조각이 많은 생태자연도는 가장 가까운(겹치면 가장 큰) 조각 하나에만 명칭
          let best = null;
          App.src.prot.getFeatures().filter(f => f.get('kind') === p.id).forEach(f => { if (!best || f.get('dist') < best.get('dist') || (f.get('dist') === best.get('dist') && f.get('area') > best.get('area'))) best = f; });
          if (best) best.set('labelMe', true);
        }
      }
      // 같은 구분·명칭이 여러 조각이면 한 줄로 (최근접 거리 = 가장 가까운 조각, 중첩 = 합)
      const merged = new Map();
      rows.forEach(r => { const k = r.kind + '|' + r.name.trim() + '|' + (r.uid || ''); const m = merged.get(k); if (!m) merged.set(k, Object.assign({}, r, { name: r.name.trim() })); else { if (r.dist < m.dist) { m.dist = r.dist; m.np = r.np; } m.over += r.over; } });
      rows = [...merged.values()];
      rows.sort((a, b) => a.dist - b.dist);
      // 화살표: 구분별 가장 가까운 1곳만 기본으로 켬 (겹치는 곳 제외)
      const seenKind = new Set();
      rows.forEach((r, i) => { r.key = r.kind + '|' + r.name + (r.uid ? '|' + r.uid : ''); r.arrow = false; if (r.np && !seenKind.has(r.kind)) { r.arrow = true; seenKind.add(r.kind); } });
      syncArrows();
      msg.textContent = (rows.length ? `완료: 반경 ${fmt(radius / 1000)}km 안에 ${rows.length}곳 (${pointCtx ? '검토 지점' : '사업지구 경계'} 기준 최근접 거리)` : `반경 ${fmt(radius / 1000)}km 안에 해당 보호구역이 없습니다.`) + ` · 자료: ${srcs.join(', ')}` + (errs.length ? ` · 오류: ${errs.join(' / ')}` : '');
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
      renderTable();
      App.liveSets.forEach(s => s.changed());
      App.emit();
    }
  }

  // 결과: 구분별로 묶고, 가까운 구분부터 / 구분 안에서도 가까운 순. 많으면 3곳만 보이고 나머지는 펼치기
  function renderTable() {
    renderStyleBox();
    const t = $('#protTable');
    if (!rows.length) { t.innerHTML = ''; t.hidden = true; return; }
    t.hidden = false;
    const groups = new Map();
    rows.forEach(r => { if (!groups.has(r.kind)) groups.set(r.kind, []); groups.get(r.kind).push(r); });
    const list = [...groups.entries()].map(([kind, rs]) => ({ kind, rs: rs.slice().sort((a, b) => a.dist - b.dist) }))
      .sort((a, b) => a.rs[0].dist - b.rs[0].dist);
    const dtxt = r => r.dist === 0 ? (r.over > 0 ? '중첩' : '통과') : App.fmtDist(r.dist);
    const item = r => `<div class="pr-row">
        ${r.np ? `<input type="checkbox" data-arrow="${r.key}" ${r.arrow ? 'checked' : ''} title="최근접 거리 화살표">` : '<span class="pr-nochk"></span>'}
        <span class="pr-name">${r.name}</span>
        <span class="pr-dist ${r.dist === 0 ? 'zero' : ''}">${dtxt(r)}</span>
        ${r.over > 0 ? `<span class="pr-over">${fmt(r.over)}㎡</span>` : ''}</div>`;
    t.innerHTML = '<div class="pr-head"><span>↔ 화살표</span><span>가까운 순</span></div>' + list.map(g => {
      const p = BY_ID[g.kind] || {}, near = g.rs[0];
      const col = App.protLook && p.id ? App.protLook(p).color : (p.color || '#888');
      const more = g.rs.length > 3 ? `<details class="pr-more"><summary>외 ${g.rs.length - 3}곳 더 보기</summary>${g.rs.slice(3).map(item).join('')}</details>` : '';
      return `<div class="pr-group">
        <div class="pr-gh"><span class="swatch${p.line ? ' swatch-line' : ''}" style="border-color:${col};background:${p.line ? 'transparent' : hexA(col, 0.18)}"></span>
          <b>${p.short || g.kind}</b><span class="pr-cnt">${g.rs.length}곳</span><span class="pr-near ${near.dist === 0 ? 'zero' : ''}">최근접 ${near.dist === 0 ? '0.00km' : App.fmtDist(near.dist)}</span></div>
        ${g.rs.slice(0, 3).map(item).join('')}${more}</div>`;
    }).join('');
  }
  // 조회된 레이어만 선 스타일(색·굵기·종류) 선택
  function renderStyleBox() {
    const box = $('#protStyleBox'); if (!box) return;
    const kinds = [...new Set(rows.map(r => r.kind))].map(k => BY_ID[k]).filter(Boolean);
    if (!kinds.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="sty-sub">레이어 선 스타일 <small>(조회된 레이어)</small></div><div class="sty-head ls"><span>색</span><span>레이어</span><span>굵기</span><span>선 종류</span></div>' + kinds.map(p => { const lk = App.protLook(p);
      return `<div class="sty-row ls"><input type="color" data-ls="${p.id}" data-f="color" value="${lk.color}"><span class="ls-name" title="${p.short}">${lk.name}</span>
        <input type="number" min="0.5" max="10" step="0.5" data-ls="${p.id}" data-f="width" value="${lk.width}">
        <select data-ls="${p.id}" data-f="dash"><option value="solid" ${lk.dash === 'solid' ? 'selected' : ''}>실선</option><option value="dashed" ${lk.dash === 'dashed' ? 'selected' : ''}>파선</option><option value="dotted" ${lk.dash === 'dotted' ? 'selected' : ''}>점선</option></select></div>`; }).join('');
  }
  App.protRunAt = async (pt5186, radiusKm, ui) => { pointCtx = Object.assign({ pt: pt5186 }, ui); try { await run(radiusKm); } finally { pointCtx = null; mirror(); } };
  function mirror() { const a = $('#protTable'), b = $('#pickTable'); if (a && b) { b.innerHTML = a.innerHTML; b.hidden = a.hidden; } }
  App.protRows = () => rows;
  App.protSetArrow = (key, on) => { const r = rows.find(x => x.key === key); if (r) { r.arrow = on; syncArrows(); renderTable(); } };
  App.protRestore = (rs, msgText) => { rows = rs || []; renderTable(); const m = $('#protMsg'); if (m && msgText) { m.hidden = false; m.textContent = msgText; } };
  App.protMsgText = () => { const m = $('#protMsg'); return m && !m.hidden ? m.textContent : ''; };
  function syncArrows() {
    App.setArrows('prot', rows.filter(r => r.np).map(r => ({ key: r.key, pts: r.np, on: r.arrow, label: `${App.fmtDist(r.dist)} 이격` })));
  }

  // ------------------------------------------------------------ UI
  function build() {
    App.opts.protOn = App.opts.protOn || {};
    App.opts.protShow = App.opts.protShow || {};
    const noteHtml = (n, withSrc) => (withSrc ? `<span class="src-line">${n.src}<span class="tags">${(n.tags || []).map(t => `<span class="tag ${/중계|사본/.test(t) ? 'tag-gray' : ''}">${t}</span>`).join('')}</span></span>` : '') +
      [].concat(n.extra || []).map(x => `<span class="src-extra">${x}</span>`).join('');
    const on = id => App.opts.protOn[id] !== false;
    const sw = p => `<span class="swatch${p.line ? ' swatch-line' : ''}" style="border-color:${p.color};background:${p.line ? 'transparent' : hexA(p.color, 0.18)}"></span>`;
    let html = '', lastCat = null; const done = new Set();
    PROT.forEach(p => {
      if (p.cat !== lastCat) { html += `<div class="prot-cat">${CATS[p.cat]}</div>`; lastCat = p.cat; }
      if (!p.group) {
        html += `<label class="prot-item"><input type="checkbox" data-prot="${p.id}" ${on(p.id) ? 'checked' : ''}>${sw(p)}
          <span class="prot-text"><b>${p.label}</b>${noteHtml(p.note, true)}</span></label>`;
        return;
      }
      if (done.has(p.group)) return; done.add(p.group);
      const g = GROUPS[p.group], kids = PROT.filter(x => x.group === p.group);
      html += `<div class="prot-item prot-group" data-group="${p.group}">
        <label class="prot-ghead"><input type="checkbox" data-pgroup="${p.group}">
          <span class="prot-text"><b>${g.label}</b>${noteHtml(g.note, true)}</span></label>
        <div class="prot-kids">${kids.map(k => `<label class="prot-kid"><input type="checkbox" data-prot="${k.id}" ${on(k.id) ? 'checked' : ''}>${sw(k)}<span>${k.label}</span></label>`).join('')}</div></div>`;
    });
    $('#protList').innerHTML = '<div class="prot-bulk"><button type="button" class="btn small" data-pall="1">전체 선택</button><button type="button" class="btn small" data-pall="0">전체 해제</button></div>' + html;
    const syncGroups = () => document.querySelectorAll('#protList [data-pgroup]').forEach(cb => {
      const ids = PROT.filter(x => x.group === cb.dataset.pgroup).map(x => x.id), n = ids.filter(on).length;
      cb.checked = n === ids.length; cb.indeterminate = n > 0 && n < ids.length;
    });
    syncGroups();
    $('#protList').addEventListener('click', e => {
      const b = e.target.closest('[data-pall]'); if (!b) return;
      const v = b.dataset.pall === '1';
      PROT.forEach(x => { App.opts.protOn[x.id] = v; App.opts.protShow[x.id] = v; });
      document.querySelectorAll('#protList [data-prot]').forEach(c => { c.checked = v; });
      syncGroups(); App.saveOpts(); App.liveSets.forEach(s => s.changed()); App.emit();
    });
    $('#protList').addEventListener('change', e => {
      const gid = e.target.dataset.pgroup;
      if (gid) {
        PROT.filter(x => x.group === gid).forEach(x => { App.opts.protOn[x.id] = e.target.checked; App.opts.protShow[x.id] = e.target.checked; });
        document.querySelectorAll(`#protList [data-group="${gid}"] [data-prot]`).forEach(c => { c.checked = e.target.checked; });
      } else {
        const id = e.target.dataset.prot; if (!id) return;
        App.opts.protOn[id] = e.target.checked; App.opts.protShow[id] = e.target.checked;
      }
      syncGroups(); App.saveOpts();
      App.liveSets.forEach(s => s.changed()); App.emit();
    });
    $('#protRadius').value = App.opts.protRadius || 5;
    $('#protLabelChk').checked = App.opts.protLabel !== false;
    $('#protLabelChk').addEventListener('change', e => { App.opts.protLabel = e.target.checked; App.saveOpts(); cache.clear(); App.liveSets.forEach(s => s.changed()); App.emit(); });
    $('#btnProt').addEventListener('click', () => run());   // 이벤트 객체가 반경 인자로 들어가지 않도록
    const sb = $('#protStyleBox');
    if (sb) sb.addEventListener('input', e => {
      const id = e.target.dataset.ls, f = e.target.dataset.f; if (!id || !f) return;
      App.opts.protCustom = App.opts.protCustom || {}; const c = App.opts.protCustom[id] = App.opts.protCustom[id] || {};
      c[f] = f === 'width' ? Number(e.target.value) || null : e.target.value;
      App.saveOpts(); cache.clear(); App.liveSets.forEach(s => s.changed()); App.emit();
    });
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
