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
  const ECZ = { src: '에코뱅크 생태자연도 API (국립생태원)', tags: ['실시간'], };
  // 별도관리지역: 생태자연도 등급과 별개인 법정 보호지역 모음. 모두 브이월드(국토교통부 토지이용규제 등), 생태·경관보전지역만 브이월드에 없어 환경공간정보서비스
  const SEP = { src: '브이월드 2D데이터 API', tags: ['실시간'], extra: ['생태자연도 중 별도관리지역'] };
  // 천연기념물 명칭: 별칭(alias)에 이름, 비고(remark)에 지정번호가 있는 경우가 많아 '이름 (천연기념물 제○호)' 로 합침
  const uo = p => { const a = (p.alias || '').trim(), r = (p.remark || '').trim(); if (/천연기념물/.test(r) && a && !/천연기념물/.test(a)) return a + ' (' + r + ')'; if (/천연기념물/.test(a)) return a; return r || a || '천연기념물'; };
  const sg = p => [p.sigg_name, p.uname].filter(Boolean).join(' ');
  // 상수원보호구역 명칭: 짐작하지 않음. ① 원자료 별칭(alias)에 구체적 이름이 있으면 사용 ② 팀 명칭표(사람이 확인해 저장) ③ 없으면 '명칭 미확인'
  // 구역 식별: 고시번호가 있으면 같은 고시의 조각을 한 구역으로(관리번호 끝 3자리=조각 번호 제외), 고시번호가 없으면 조각마다 따로
  App.waterNames = App.waterNames || {};
  App.WATER_UNK = '상수원보호구역(명칭 미확인)';
  App.waterUid = p => { const m = String(p.mnum || ''); return p.dyear && p.dyear !== '0000' && m.length > 3 ? m.slice(0, -3) : m; };
  const fullWater = n => /보호구역$/.test(n) ? n : n + ' 상수원보호구역';
  App.waterName = p => { const a = String(p.alias || '').trim(); if (a && a !== '상수원보호구역' && /상수원|보호구역|수원지/.test(a)) return fullWater(a); const t = App.waterNames[App.waterUid(p)]; return t && t.n ? fullWater(t.n) : App.WATER_UNK; };
  App.waterInfo = App.waterInfo || {};
  const NAMES_URL = 'https://ecozm-proxy.seungw002799.workers.dev/names?l=water';
  App.loadWaterNames = async () => { try { const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 6000); const r = await fetch(NAMES_URL, { signal: ac.signal, cache: 'no-store' }); clearTimeout(tm); if (r.ok) App.waterNames = await r.json(); } catch (e) { /* 명칭표를 못 받아도 조회는 계속 */ } return App.waterNames; };
  App.saveWaterName = async (uids, name) => { const r = await fetch(NAMES_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ uids, name }) }); if (!r.ok) throw new Error('저장 실패 (HTTP ' + r.status + ')'); App.waterNames = await r.json(); return App.waterNames; };
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
  const CATS = { ecobank: '에코뱅크 (국립생태원)', vworld: '브이월드 (국토교통부 등)', egis: '환경공간정보서비스 (기후에너지환경부)', kei: 'KEI 지역환경정보시스템', rim: '하천정보관리시스템 (RIMGIS)', nibr: '국립생물자원관', nier: '물환경정보시스템 (국립환경과학원)', kdpa: '보호·보전지역 정보망 (KDPA)' };
  const PROT = [
    // ecobank
    { cat: 'ecobank', id: 'eco1', grade: '1', label: '생태자연도 1등급', short: '생태자연도 1등급', src: 'eco1', name: () => '생태자연도 1등급', labelNearest: true, color: '#1AA800', note: ECZ },
    // vworld
    { cat: 'vworld', group: 'sep', id: 'forest_gen', label: '산림유전자원보호구역 (산림보호구역 중)', short: '산림유전자원보호구역', src: 'vworld', data: 'LT_C_UF151', attr: 'uname:like:산림유전자원', name: sg, color: '#33691E', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'np_nat', label: '국립공원', short: '국립공원', src: 'vworld', data: 'LT_C_WGISNPGUG', name: p => p.park_name, color: '#1B7F3B', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'np_do', label: '도립공원', short: '도립공원', src: 'vworld', data: 'LT_C_WGISNPDO', name: p => p.park_name, color: '#5E9E1F', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'np_gun', label: '군립공원', short: '군립공원', src: 'vworld', data: 'LT_C_WGISNPGUN', name: p => p.park_name, color: '#A08A00', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'monument', label: '천연기념물 (천연보호구역 포함)', short: '천연기념물', src: 'local', local: 'data/heritage_kdpa.geojson', srcName: '보호·보전지역 정보망(KDPA)', nameField: 'name', color: '#BF360C', note: { src: '보호·보전지역 정보망(KDPA, kdpa.kr)', tags: ['2025년 12월'], extra: ['국가유산청 천연기념물 400곳 · 천연보호구역 11곳 (구역이 있는 것, 명칭 포함)', '사이트에 넣어 둔 자료 · 반년마다 갱신'] } },
    { cat: 'vworld', group: 'sep', id: 'wild', label: '야생생물 보호구역', short: '야생생물 보호구역', src: 'vworld', data: 'LT_C_UM221', keep: p => !/특별/.test(p.uname || ''), name: sgW, uid: p => [p.dyear, p.dnum].filter(Boolean).join('-'), color: '#C62828', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'wild_sp', label: '야생생물 특별보호구역', short: '야생생물 특별보호구역', src: 'vworld', data: 'LT_C_UM221', attr: 'uname:like:특별', name: sgW, uid: p => [p.dyear, p.dnum].filter(Boolean).join('-'), color: '#8E0000', note: SEP },
    { cat: 'vworld', group: 'sep', id: 'fishery', label: '수산자원보호구역', short: '수산자원보호구역', src: 'vworld', data: 'LT_C_UQ141', attr: 'uname:like:수산자원', name: sg, kdpa: 'data/fishery_kdpa.geojson', kdpaFmt: n => /보호구역$/.test(n) ? n : n + ' 수산자원보호구역', color: '#D81B60', note: SEP },
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
    { cat: 'vworld', id: 'water', label: '상수원보호구역', short: '상수원보호구역', src: 'vworld', data: 'LT_C_UM710', name: p => App.waterName(p), uid: p => App.waterUid(p), wuid: p => App.waterUid(p), info: p => ({ sigg: [p.sido_name, p.sigg_name].filter(Boolean).join(' '), remark: p.remark || '', alias: p.alias || '', gosi: p.dyear && p.dyear !== '0000' ? p.dyear + '-' + p.dnum : '' }), kdpa: 'data/water_kdpa.geojson', kdpaFmt: n => /보호구역$/.test(n) ? n : n + ' 상수원보호구역', color: '#1565C0', note: Object.assign({}, VW, { extra: ['위치: 국토교통부 연속주제도 (수도법 상수원보호구역)', '명칭: 보호·보전지역 정보망(KDPA)과 구역이 겹치면 그 명칭 → 원자료 별칭 → 팀 명칭표 → 명칭 미확인'] }) },
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
      dash: ['solid', 'dashed', 'dotted'].includes(c.dash) ? c.dash : dDash, width: Number(c.width) > 0 ? Number(c.width) : dW,
      halo: /^#[0-9a-fA-F]{6}$/.test(c.halo || '') ? c.halo : '#ffffff', haloW: Math.max(0, Number(c.haloW) || 0) };   // 버퍼(선 둘레 테두리)
  };
  App.protLabelKey = f => f.get('kind') + '|' + (f.get('name') || '') + (f.get('wuid') && f.get('name') === App.WATER_UNK ? '|' + f.get('wuid') : '');
  App.PROT = PROT;
  // 대상지역 설정도(target.js)에서 하천 등 한 레이어만 받을 때
  App.protFetchLayer = (id, b4326) => { const p = BY_ID[id]; if (!p) return Promise.reject(new Error('레이어 없음')); return cachedWfs(p, b4326); };

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
    {
      // 이전 위치가 아직 화면 안이면 그대로 둠 (끌거나 확대할 때 명칭이 이리저리 옮겨 다니지 않도록)
      const w0 = ext[2] - ext[0], h0 = ext[3] - ext[1], prev = f[k];
      if (prev && prev[0] > ext[0] + w0 * 0.06 && prev[0] < ext[2] - w0 * 0.06 && prev[1] > ext[1] + h0 * 0.06 && prev[1] < ext[3] - h0 * 0.06) { f[k + 'key'] = ek; return prev; }
    }
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
    const key = p.id + '|' + s.toFixed(3) + (nb ? '|nb' : '') + '|' + col + '|' + lk.dash + '|' + lk.width + '|' + lk.halo + lk.haloW;
    const w = Math.max(0.5, lk.width * s), dsh = lk.dash === 'dashed' ? [6 * s, 4 * s] : lk.dash === 'dotted' ? [1.2 * s, 2.5 * s] : undefined;
    let st = cache.get(key);
    if (!st) {
      // 선 색·굵기·종류는 레이어 모음 탭의 '레이어 선 스타일'에서 바꿈
      st = p.point
        ? new ol.style.Style({ image: new ol.style.RegularShape({ points: 3, radius: Math.max(4, 6 * s), fill: new ol.style.Fill({ color: col }), stroke: new ol.style.Stroke({ color: '#fff', width: Math.max(1, 1.5 * s) }) }) })
        : p.line
        ? new ol.style.Style({ stroke: new ol.style.Stroke({ color: col, width: w, lineDash: dsh }) })
        : nb
        ? new ol.style.Style({ stroke: new ol.style.Stroke({ color: col, width: Math.max(0.8, 1.6 * s), lineDash: [6 * s, 4 * s] }) })
        : p.src === 'eco1'
        ? new ol.style.Style({ fill: new ol.style.Fill({ color: hexA(col, 0.45) }), stroke: new ol.style.Stroke({ color: col, width: w, lineDash: dsh }) })
        : new ol.style.Style({ fill: new ol.style.Fill({ color: hexA(col, 0.18) }), stroke: new ol.style.Stroke({ color: col, width: w, lineDash: dsh }) });
      // 버퍼: 선 아래에 더 굵은 테두리 선
      if (lk.haloW > 0 && !p.point) st = [new ol.style.Style({ stroke: new ol.style.Stroke({ color: lk.halo, width: w + 2 * lk.haloW * s }) }), st];
      if (cache.size > 500) cache.clear();
      cache.set(key, st);
    }
    if (App.LABELS_OFF) return st;   // 레이어 명칭은 표시하지 않음 (경계선만)
    if (App.opts.riverLabel === false && /^river_/.test(p.id)) return st;   // 하천명 끄기
    if (p.labelNearest && !f.get('labelMe')) return st;
    const ls = (App.opts.lblSt || {})[App.protLabelKey(f)] || {};   // 명칭 하나하나의 설정 (미리보기에서 두 번 눌러 바꿈)
    if (ls.hide) return st;
    const LS = (App.opts.sty || {})['p:' + p.id] || {};   // 레이어 단위 문자 설정 (스타일 편집기)
    if (LS.lshow === false) return st;
    const custom = (App.opts.protLabelText || {})[App.protLabelKey(f)];
    const label = App.opts.protLabel !== false ? (custom != null && custom !== '' ? custom : (p.mapLabel ? p.mapLabel(f.get('name') || '') : (f.get('name') || ''))) : '';
    if (!label) return st;
    const lp = labelPoint(f, set);
    if (!lp) return st;
    return [].concat(st, new ol.style.Style({ geometry: new ol.geom.Point(lp), text: new ol.style.Text({
      // 글자 크기(%)·글자 색(비우면 레이어 색)·버퍼 색·두께는 초기 입지 검토 > 출력 > 표시 스타일에서
      text: label, font: `bold ${Math.round(lk.pt * 0.3528 * App.PX_PER_MM96 * s * ((Number(App.opts.lblPct) || 100) / 100) * ((Number(ls.size) || 100) / 100) * ((Number(LS.lsize) || 100) / 100) * 10) / 10}px "EcoFont","Malgun Gothic",sans-serif`,
      fill: new ol.style.Fill({ color: ls.auto === false && ls.color ? ls.color : (LS.lauto === false && LS.lcolor ? LS.lcolor : (App.opts.lblColor || col)) }), stroke: new ol.style.Stroke({ color: ls.halo || LS.lhalo || App.opts.lblHalo || '#fff', width: (ls.haloW != null && ls.haloW !== '' ? Number(ls.haloW) : (LS.lhaloW != null && LS.lhaloW !== '' ? Number(LS.lhaloW) : (App.opts.lblHaloW == null ? 3 : Number(App.opts.lblHaloW)))) * s }), overflow: true, offsetY: p.point ? -11 * s : 0 }) }));
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
  // 브이월드(API) 구역에 보호·보전지역 정보망(KDPA) 명칭 붙이기: 위치는 API 그대로, 두 구역이 실제로 겹칠 때만 (API 구역 면적의 50% 이상)
  const kdpaCache = {};
  async function kdpaIndex(file) {
    if (!kdpaCache[file]) kdpaCache[file] = (async () => { const r = await fetch(file + '?v=1'); if (!r.ok) return []; const j = await r.json(); const rd = new jsts.io.GeoJSONReader(); return (j.features || []).map(f => { let g = null; try { g = rd.read(f.geometry); if (!g.isValid()) g = g.buffer(0); } catch (e) { g = null; } return g ? { n: (f.properties || {}).name || '', g, e: g.getEnvelopeInternal() } : null; }).filter(Boolean); })();
    return kdpaCache[file];
  }
  async function attachKdpa(p, feats) {
    let idx = []; try { idx = await kdpaIndex(p.kdpa); } catch (e) { return; }
    if (!idx.length) return;
    const rd = new jsts.io.GeoJSONReader();
    feats.forEach(f => {
      let g; try { g = rd.read(f.geometry); if (!g.isValid()) g = g.buffer(0); } catch (e) { return; }
      const ge = g.getEnvelopeInternal(), area = g.getArea(); if (!(area > 0)) return;
      let best = null, ba = 0;
      idx.forEach(k => { if (!k.e.intersects(ge)) return; let a = 0; try { a = k.g.intersection(g).getArea(); } catch (e) { a = 0; } if (a > ba) { ba = a; best = k; } });
      if (best && best.n && ba / area >= 0.5) { f.properties.name = p.kdpaFmt ? p.kdpaFmt(best.n) : best.n; f.properties.kdpa = true; if (p.id === 'water') f.properties.uid = ''; }
    });
  }
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
      fs.filter(f => !p.keep || p.keep(f.properties || {})).forEach(f => feats.push({ type: 'Feature', geometry: f.geometry, properties: { name: p.name(f.properties || {}) || p.short, uid: p.uid ? p.uid(f.properties || {}) : '', wuid: p.wuid ? p.wuid(f.properties || {}) : '', info: p.info ? p.info(f.properties || {}) : null } }));
      const total = Number(r.record && r.record.total) || 0;
      if (feats.length >= total || !fs.length) break;
    }
    if (p.kdpa) await attachKdpa(p, feats);
    return { type: 'FeatureCollection', features: feats, _src: '브이월드 실시간' + (p.kdpa ? ' · 명칭 KDPA' : '') };
  }

  // 환경공간정보서비스 GeoServer WFS (중계 서버 경유), 조건 + 범위 필터
  // 중계 서버 캐시가 잘 맞도록 조회 범위를 0.02° 격자로 넓혀 맞춤 (같은 동네를 다시 조회하면 바로 응답)
  const snapB = b => { const s = 0.02; return [Math.floor(b[0] / s) * s, Math.floor(b[1] / s) * s, Math.ceil(b[2] / s) * s, Math.ceil(b[3] / s) * s].map(v => +v.toFixed(4)); };
  async function fetchEgis(p, b) {
    b = snapB(b);
    const cql = (p.cql ? p.cql + ' AND ' : '') + `BBOX(geom,${b.join(',')},'EPSG:4326')`;
    const u = 'https://api.mcee.go.kr/geoserver/me/wfs?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326' +
      `&typeName=${p.typename}&CQL_FILTER=${encodeURIComponent(cql)}`;
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 60000);
    try {
      // 하천정보관리시스템은 큰 하천(국가하천)이 느릴 때가 있어 한 번 더 시도
      const get = () => fetch(PROXY + encodeURIComponent(u), { signal: ac.signal });
      let r; try { r = await get(); if (!r.ok && /river\.go\.kr/.test(p.base)) r = await get(); } catch (e0) { if (e0.name === 'AbortError' || !/river\.go\.kr/.test(p.base)) throw e0; r = await get(); }
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
    b = snapB(b);
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
  // 생태자연도 1등급: API가 등급 구분 없이 모든 폴리곤을 주므로 넓은 범위는 매우 느림 (10km 반경이면 1분 이상)
  // → 사업지구 주변 1km부터 2배씩 넓혀 가며 1등급이 처음 나오는 범위까지만 받음 (최근접 거리는 그대로 정확)
  async function fetchEco1(p, b, msg, radius) {
    if (!App.cfg.dataGoKrKey) throw new Error('생태자연도: data.go.kr 인증키가 없습니다.');
    const covers = (c, bb) => c && c.bbox[0] <= bb[0] && c.bbox[1] <= bb[1] && c.bbox[2] >= bb[2] && c.bbox[3] >= bb[3];
    const pick = fs => fs.filter(f => f.geometry && String((f.properties || {}).eczm_grad) === p.grade);
    const R = radius || 0, core = [b[0] + R, b[1] + R, b[2] - R, b[3] - R];   // 사업지구(또는 검토 지점) 범위
    let feats = null;
    if (covers(App.eczmCache, b)) feats = App.eczmCache.features;
    else {
      try {
        for (let r = Math.min(1000, R); ; r = Math.min(R, r * 2)) {
          const bb = [core[0] - r, core[1] - r, core[2] + r, core[3] + r];
          let fs;
          if (covers(App.eczmCache, bb)) fs = App.eczmCache.features;
          else {
            const got = await App.collectEczm(bb, (calls, n) => { msg.textContent = `생태자연도 받는 중 (주변 ${(r / 1000).toFixed(1)}km)... 호출 ${calls}회, 폴리곤 ${n.toLocaleString()}개`; });
            fs = got.features; App.eczmCache = { bbox: bb, features: fs };
          }
          if (pick(fs).length || r >= R) { feats = fs; break; }
        }
      } catch (e) { throw new Error(`생태자연도 자료를 받지 못했습니다 (${e.message})`); }
    }
    return { type: 'FeatureCollection', _src: '생태자연도 실시간', _crs5186: true,
      features: pick(feats).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { name: p.name() } })) };
  }


  // 일반 WFS (bbox 조건, 중계 서버 경유): 하천정보관리시스템 하천망도, 환경공간정보 소하천구역
  // 국가하천: 한 하천이 통째로(예: 낙동강 전체) 내려와 매우 느림 → 범위 안 하천 목록만 먼저 받고(빠름),
  // 하천 도형은 하천마다 한 번만 받아 이 컴퓨터(IndexedDB)에 60일 보관
  const RCACHE_DAYS = 60;
  function rdb() { return new Promise((ok, no) => { const q = indexedDB.open('ecozmCache', 1); q.onupgradeneeded = () => q.result.createObjectStore('river'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); }
  async function rget(k) { try { const db = await rdb(); return await new Promise(ok => { const r = db.transaction('river').objectStore('river').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); }); } catch (e) { return null; } }
  async function rput(k, v) { try { const db = await rdb(); db.transaction('river', 'readwrite').objectStore('river').put(v, k); } catch (e) { /* 저장 못 해도 진행 */ } }
  async function fetchRiverByList(p, b) {
    const base = `${p.base}?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&typeName=${p.typename}`;
    const get = async (u, ms) => { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms); try { const r = await fetch(PROXY + encodeURIComponent(u), { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return JSON.parse(await r.text()); } finally { clearTimeout(tm); } };
    const list = await get(`${base}&propertyName=id,rivcd,rivnm&bbox=${b.join(',')},EPSG:4326`, 40000);
    const ids = [...new Map((list.features || []).map(f => [f.properties.id, f.properties])).values()];
    const feats = [];
    for (const pr of ids) {
      const key = p.typename + '|' + pr.id; let c = await rget(key);
      if (!c || Date.now() - c.t > RCACHE_DAYS * 864e5) {
        const j = await get(`${base}&srsName=EPSG:4326&CQL_FILTER=${encodeURIComponent('id=' + pr.id)}`, 150000);
        const f = (j.features || [])[0]; if (!f || !f.geometry) continue;
        let geom = f.geometry;
        try { const rd = new jsts.io.GeoJSONReader(), wr = new jsts.io.GeoJSONWriter(); geom = wr.write(jsts.simplify.DouglasPeuckerSimplifier.simplify(rd.read(geom), 0.00002)); } catch (e) { /* 원본 사용 */ }   // 약 2m 단위로 단순화
        c = { t: Date.now(), geom, props: f.properties || pr }; rput(key, c);
      }
      feats.push({ type: 'Feature', geometry: c.geom, properties: { name: p.name(c.props || pr) } });
    }
    return { type: 'FeatureCollection', _src: '하천정보관리시스템 실시간 (하천 도형은 이 컴퓨터에 보관)', features: feats };
  }
  // 하천 등 WFS 자료: 이번 세션에서 이미 받은 더 넓은 범위가 있으면 다시 받지 않음 (레이어 모음·초기 입지·대상지역·측정지점이 같이 씀)
  const wfsCov = {};
  async function cachedWfs(p, b) {
    const L = wfsCov[p.id] = wfsCov[p.id] || [];
    const hit = L.find(x => x.b[0] <= b[0] && x.b[1] <= b[1] && x.b[2] >= b[2] && x.b[3] >= b[3]);
    if (hit) return hit.fc;
    const fc = await fetchWfsBbox(p, b);
    L.push({ b: b.slice(), fc }); if (L.length > 6) L.shift();
    return fc;
  }
  async function fetchWfsBbox(p, b) {
    if (p.id === 'river_nat') { try { return await fetchRiverByList(p, snapB(b)); } catch (e) { throw new Error(`${p.short} 자료를 받지 못했습니다 (${e.name === 'AbortError' ? '시간 초과' : e.message})`); } }
    b = snapB(b);
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
    return { type: 'FeatureCollection', _src: (p.srcName || '국립생물자원관') + ' ' + (all.fetched || ''), features: all.features.filter(f => f.geometry && inBox(f.geometry)) };
  }

  // 사업지구(전체) 범위 + 반경 -> EPSG:4326 bbox [minLon,minLat,maxLon,maxLat]
  let pointCtx = null;
  const fcCache = new Map();   // 세션 동안 받은 레이어 자료 (레이어|범위 → 자료)   // 초기 입지 검토: 도면 대신 한 점(EPSG:5186)을 기준으로 조회
  function queryBox(radiusM) {
    const bs = pointCtx ? [pointCtx.bbox || [pointCtx.pt[0], pointCtx.pt[1], pointCtx.pt[0], pointCtx.pt[1]]] : App.sites.filter(s => s.bbox).map(s => s.bbox);
    if (!bs.length) return null;
    const b = [Math.min(...bs.map(x => x[0])) - radiusM, Math.min(...bs.map(x => x[1])) - radiusM,
      Math.max(...bs.map(x => x[2])) + radiusM, Math.max(...bs.map(x => x[3])) + radiusM];
    const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(p => proj4('EPSG:5186', 'EPSG:4326', p));
    return { b5186: b, b4326: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))] };
  }

  // ------------------------------------------------------------ 검토
  let rows = [];
  // 사업지구가 걸친 시군구 (브이월드 법정 시군구 경계, EPSG:5186). 여러 시군구에 걸치면 합침
  const siggCache = new Map();
  async function siteSigg(site) {
    const e = site.getEnvelopeInternal();
    const c = [[e.getMinX(), e.getMinY()], [e.getMaxX(), e.getMaxY()]].map(p => proj4('EPSG:5186', 'EPSG:4326', p));
    const ck = c.flat().map(v => v.toFixed(5)).join(','); if (siggCache.has(ck)) return siggCache.get(ck);
    const u = 'https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LT_C_ADSIGG_INFO&format=json&size=20&page=1&geometry=true&attribute=true&crs=EPSG:4326&geomFilter=' + encodeURIComponent('BOX(' + c[0][0] + ',' + c[0][1] + ',' + c[1][0] + ',' + c[1][1] + ')') + '&key=' + App.cfg.vworldKey + '&domain=' + encodeURIComponent(location.origin);
    const j = await jsonp(u), fs = (j.response && j.response.result && j.response.result.featureCollection && j.response.result.featureCollection.features) || [];
    const rd = new jsts.io.GeoJSONReader(); let g = null; const names = [];
    for (const f of fs) {
      const tf = a => typeof a[0] === 'number' ? proj4('EPSG:4326', 'EPSG:5186', [a[0], a[1]]) : a.map(tf);
      let jg; try { jg = rd.read({ type: f.geometry.type, coordinates: tf(f.geometry.coordinates) }); if (!jg.isValid()) jg = jg.buffer(0); } catch (e2) { continue; }
      let a = 0; try { a = jg.intersection(site).getArea(); } catch (e2) { a = jg.intersects(site) ? 1 : 0; }
      if (a < 1) continue;   // 경계에 살짝 닿기만 한 시군구는 제외 (1㎡ 미만)
      names.push((f.properties || {}).sig_kor_nm || ''); g = g ? g.union(jg) : jg;
    }
    const r = g ? { g: jsts.simplify.TopologyPreservingSimplifier.simplify(g, 5), names } : null;
    siggCache.set(ck, r); return r;
  }
  async function run(radiusKm) {
    const btn = pointCtx ? pointCtx.btn : $('#btnProt'), msg = pointCtx ? pointCtx.msg : $('#protMsg');
    // 초기 입지 검토는 기본으로 전체 레이어 조회 (선택한 것만: pointCtx.onlyChosen)
    const chosen = pointCtx && !pointCtx.onlyChosen ? PROT.slice() : PROT.filter(p => (App.opts.protOn || {})[p.id] !== false);
    if (!pointCtx && !App.sites.some(s => s.geometry)) { App.toast && App.toast('먼저 도면을 추가하세요.', 'warn'); return; }
    if (!chosen.length) { msg.hidden = false; msg.textContent = '검토할 보호구역을 하나 이상 선택하세요.'; return; }
    const radius = (radiusKm != null ? Math.max(pointCtx && pointCtx.geom ? 0 : 0.1, Number(radiusKm) || 0) : Math.max(0, Number($('#protRadius').value) || 5)) * 1000;
    if (radiusKm == null) { App.opts.protRadius = radius / 1000; App.saveOpts(); }
    // 검토 범위: radius 반경 안 / sigg 사업지구가 속한 시군구 안(반경 무관) / both 반경 안이면서 시군구 안 (레이어 모음에서만)
    const scope = pointCtx ? 'radius' : (App.opts.protScope || 'radius');
    let q = queryBox(radius), radQ = radius;
    btn.disabled = true; msg.hidden = false; msg.textContent = '보호구역 자료를 받는 중...';
    App.src.prot.clear();
    App.setArrows('prot', []);
    rows = [];
    if (chosen.some(p => p.id === 'water')) { await App.loadWaterNames(); fcCache.forEach((v, k) => { if (k.startsWith('water|')) fcCache.delete(k); }); }   // 팀 명칭표 최신으로
    try {
      // 사업지구 합치기 (EPSG:5186)
      const rd = new jsts.io.GeoJSONReader();
      let site;
      if (pointCtx && pointCtx.geom) site = rd.read(pointCtx.geom);   // 행정구역 전체를 기준으로
      else if (pointCtx) site = new jsts.geom.GeometryFactory().createPoint(new jsts.geom.Coordinate(pointCtx.pt[0], pointCtx.pt[1])).buffer(1);   // 검토 지점 (반지름 1m)
      else { const siteGeoms = App.sites.filter(s => s.geometry).map(s => rd.read(s.geometry)); site = siteGeoms[0]; for (let i = 1; i < siteGeoms.length; i++) site = site.union(siteGeoms[i]); }
      const fmt3857 = new ol.format.GeoJSON();
      let region = null, regionPrep = null, regionNm = '';
      if (scope !== 'radius') {
        msg.textContent = '사업지구가 속한 시군구를 찾는 중...';
        const r = await siteSigg(site);
        if (!r) throw new Error('사업지구가 속한 시군구를 찾지 못했습니다 (브이월드 행정구역)');
        region = r.g; regionNm = r.names.join('·');
        const rEnv = region.getEnvelopeInternal(); regionPrep = { intersects: g => rEnv.intersects(g.getEnvelopeInternal()) && region.intersects(g) };
        if (scope === 'sigg') {   // 시군구 전체가 들어가도록 조회 범위를 넓힘
          const e = region.getEnvelopeInternal(), s = site.getEnvelopeInternal();
          radQ = Math.max(s.getMinX() - e.getMinX(), s.getMinY() - e.getMinY(), e.getMaxX() - s.getMaxX(), e.getMaxY() - s.getMaxY(), 0) + 200;
          q = queryBox(radQ);
        }
      }
      // 지도용 도형: 검토 범위(+여유) 밖은 잘라내고 1m 단위로 단순화 (거리·중첩 계산은 원본 도형으로)
      const gwr = new jsts.io.GeoJSONWriter(), gfac = new jsts.geom.GeometryFactory();
      const clipOf = rM => { const b = queryBox(rM * 1.3 + 2000).b5186; return gfac.toGeometry(new jsts.geom.Envelope(b[0], b[2], b[1], b[3])); };
      const clipR = clipOf(radQ), clipBig = clipOf(Math.max(radQ, 20000));
      // 행정구역 전체로 검토할 때: 지도에는 행정구역(+반경) 안에 든 부분만 표시 (반경 0이면 행정구역 경계로 자름)
      let areaClip = null; if (pointCtx && pointCtx.geom) { try { areaClip = radius > 0 ? site.buffer(radius, 16) : site; } catch (e) { areaClip = null; } }
      if (region) { try { areaClip = scope === 'both' ? region.intersection(site.buffer(radius, 32)) : region; } catch (e) { areaClip = region; } }   // 시군구 기준: 지도에는 시군구(∩반경) 안만
      const disp = (jg, g5, clip) => {
        try {
          let d = jg;
          if (areaClip) d = d.intersection(areaClip);
          else if (!clip.getEnvelopeInternal().contains(d.getEnvelopeInternal())) d = d.intersection(clip);
          d = jsts.simplify.DouglasPeuckerSimplifier.simplify(d, 1.0);
          return d.isEmpty() ? (areaClip ? null : g5) : gwr.write(d);
        } catch (e) { return areaClip ? null : g5; }
      };
      const srcs = [], errs = [];
      // 자료 받기: 4개씩 동시에 받고(순서는 유지), 같은 범위로 다시 조회하면 이번 세션에서 받아 둔 자료를 그대로 사용
      const fetchOne = p => p.src === 'vworld' ? fetchVworld(p, q.b4326) : p.src === 'egis' ? fetchEgis(p, q.b4326) : p.src === 'kei' ? fetchKei(p, q.b4326) : p.src === 'nier' ? fetchNier(p, queryBox(Math.max(radQ, 20000)).b4326) : p.src === 'eco1' ? fetchEco1(p, q.b5186, msg, radQ) : p.src === 'local' ? fetchLocal(p, q.b4326) : p.src === 'wfsb' ? cachedWfs(p, q.b4326) : fetchEiagis(p, q.b4326);
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
      // 검토 반경 범위 (사업지구 경계에서 반경만큼): 레이어가 이 안에 얼마나 들어오는지 계산 + 지도에 표시
      let radBuf = null; try { radBuf = region ? areaClip : (radius > 0 ? site.buffer(radius, 32) : site); } catch (e) { radBuf = null; }
      App.src.pick.getFeatures().filter(f => f.get('src') === 'prot').forEach(f => App.src.pick.removeFeature(f));
      if (radBuf && !pointCtx) { try { const rg = fmt3857.readGeometry(new jsts.io.GeoJSONWriter().write(radBuf), { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' }); const rf = new ol.Feature(rg); rf.set('pk', 'ring'); rf.set('src', 'prot'); rf.set('label', scope === 'sigg' ? regionNm + ' 경계' : scope === 'both' ? '검토 반경 ' + fmt(radius / 1000) + 'km · ' + regionNm : '검토 반경 ' + fmt(radius / 1000) + 'km'); App.src.pick.addFeature(rf); } catch (e) { /* 표시 생략 */ } }
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
          if (scope !== 'sigg' && dist > radius) return;     // 반경 밖은 제외
          if (regionPrep) { let inn = false; try { inn = regionPrep.intersects(jg); } catch (e) { inn = true; } if (!inn) return; }   // 시군구 밖은 제외
          let over = 0; try { over = dist === 0 ? jg.intersection(site).getArea() : 0; } catch (e) { over = 0; }
          const raw = (f.properties || {})[p.nameField || 'name'];
          const name = raw ? (p.nameFmt ? p.nameFmt(raw) : raw) : `(이름 없음 ${i + 1})`;
          let np = null; try { if (dist > 0) np = jsts.operation.distance.DistanceOp.nearestPoints(site, jg).map(c => [c.x, c.y]); } catch (e) { np = null; }
          // 반경 안에 든 양: 면은 면적, 선(산줄기 등)은 길이. 전체 대비 비율도 함께
          const isLine = !!p.line, tot = isLine ? jg.getLength() : jg.getArea();
          let inR = 0; try { if (radBuf) { const ig = jg.intersection(radBuf); inR = isLine ? ig.getLength() : ig.getArea(); } } catch (e) { try { const ig = jg.buffer(0).intersection(radBuf); inR = isLine ? ig.getLength() : ig.getArea(); } catch (e2) { inR = 0; } }
          const wuid = (f.properties || {}).wuid || ''; if (wuid && (f.properties || {}).info) App.waterInfo[wuid] = (f.properties || {}).info;
          rows.push({ kind: p.id, kindLabel: p.short, name, wuid, wuids: wuid ? [wuid] : [], uid: (f.properties || {}).uid || '', dist, over, area: jg.getArea(), np, inR, tot, isLine });
          const dg = disp(jg, g5, p.overlapOnly ? clipBig : clipR);
          if (!dg) return;   // 행정구역 밖이라 지도에 그릴 부분 없음
          const of = fmt3857.readFeature({ type: 'Feature', geometry: dg, properties: {} }, { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
          of.set('kind', p.id); of.set('name', name); of.set('dist', dist); of.set('area', jg.getArea()); if (wuid) { of.set('wuid', wuid); of.set('g5', jg); }
          if (p.overlapOnly) { of.set('host', true); hosts.push(jg); }
          App.src.prot.addFeature(of);
        });
        // 주변 단위유역: 속한 유역과 맞닿은 유역 + 검토 반경 안의 유역을 함께 표시 (표·화살표에는 넣지 않음)
        nbr.forEach(n => {
          const touch = hosts.some(h => { try { return h.distance(n.jg) < 50; } catch (e) { return false; } });
          if (!touch && n.dist > radius) return; if (!n.g5) return;
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
      rows.forEach(r => { const unk = r.kind === 'water' && r.name === App.WATER_UNK; const k = r.kind + '|' + r.name.trim() + '|' + (r.kind === 'water' ? (unk ? r.wuid : '') : (r.uid || '')); const m = merged.get(k); if (!m) merged.set(k, Object.assign({}, r, { name: r.name.trim(), wuids: (r.wuids || []).slice() })); else { if (r.dist < m.dist) { m.dist = r.dist; m.np = r.np; } m.over += r.over; (r.wuids || []).forEach(w => { if (!m.wuids.includes(w)) m.wuids.push(w); }); } });
      rows = [...merged.values()];
      rows.sort((a, b) => a.dist - b.dist);
      // 화살표: 구분별 가장 가까운 1곳만 기본으로 켬 (겹치는 곳 제외)
      const seenKind = new Set();
      rows.forEach(r => { r.key = r.kind + '|' + r.name + (r.uid ? '|' + r.uid : '') + (r.kind === 'water' && r.name === App.WATER_UNK ? '|' + r.wuid : ''); r.arrow = false; });   // 화살표는 기본 꺼짐 (필요한 것만 체크)
      if (pointCtx) rows.forEach(r => { r.arrow = false; r.noArrow = true; });   // 초기 입지 검토: 화살표 없이 목록만
      chosen.forEach(p => { App.opts.protShow[p.id] = true; }); App.saveOpts();   // 조회한 레이어는 지도에 표시 (결과 목록의 구분 체크로 끄고 켬)
      syncArrows();
      const scopeTxt = scope === 'sigg' ? `${regionNm} 안` : scope === 'both' ? `반경 ${fmt(radius / 1000)}km 안 · ${regionNm} 안` : `반경 ${fmt(radius / 1000)}km 안`;
      msg.textContent = (rows.length ? `완료: ${scopeTxt}에 ${rows.length}곳 (${pointCtx ? (pointCtx.geom ? '행정구역 경계' : '검토 지점') : '사업지구 경계'} 기준 최근접 거리)` : `${scopeTxt}에 해당 레이어가 없습니다.`) + (errs.length ? ` · 오류 ${errs.length}건 (아래 자료 출처 참고)` : '');
      lastSrc = { srcs, errs };
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
    const qty = (v, line) => line ? (v >= 1000 ? (v / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + 'km' : Math.round(v).toLocaleString('ko-KR') + 'm') : (v >= 1e6 ? (v / 1e6).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '㎢' : Math.round(v).toLocaleString('ko-KR') + '㎡');
    const pctT = (a, b) => (b > 0 ? (a / b * 100) : 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '%';
    const inTxt = r => r.inR != null && r.tot > 0 ? `<span class="pr-in" title="검토 반경 안에 든 ${r.isLine ? '길이' : '면적'} / 전체 ${qty(r.tot, r.isLine)}">반경 내 ${qty(r.inR, r.isLine)} · ${pctT(r.inR, r.tot)}</span>` : '';
    const item = r => `<div class="pr-row">
        ${r.np && !r.noArrow ? `<input type="checkbox" data-arrow="${r.key}" ${r.arrow ? 'checked' : ''} title="최근접 거리 화살표">` : '<span class="pr-nochk"></span>'}
        <span class="pr-name">${r.name}${r.kind === 'water' && r.name === App.WATER_UNK ? ` <button type="button" class="pr-confirm" data-wconfirm="${r.wuid}">명칭 확인</button>` : ''}</span>
        <span class="pr-dist ${r.dist === 0 ? 'zero' : ''}">${dtxt(r)}</span>
        ${r.over > 0 ? `<span class="pr-over">${fmt(r.over)}㎡</span>` : ''}${inTxt(r)}</div>`;
    const noArr = rows.every(r => r.noArrow);
    t.innerHTML = `<div class="pr-head"><span>${noArr ? '구분 체크: 지도 표시' : '구분 체크: 지도 표시 · 줄 체크: 화살표'}</span><span>가까운 순</span></div>` + list.map(g => {
      const p = BY_ID[g.kind] || {}, near = g.rs[0];
      const col = App.protLook && p.id ? App.protLook(p).color : (p.color || '#888');
      const more = g.rs.length > 3 ? `<details class="pr-more"><summary>외 ${g.rs.length - 3}곳 더 보기</summary>${g.rs.slice(3).map(item).join('')}</details>` : '';
      return `<div class="pr-group">
        <div class="pr-gh"><input type="checkbox" data-show="${g.kind}" ${(App.opts.protShow || {})[g.kind] !== false ? 'checked' : ''} title="지도에 표시"><span class="swatch${p.line ? ' swatch-line' : ''}${p.point ? ' swatch-pt' : ''}" style="border-color:${col};background:${p.line ? 'transparent' : hexA(col, 0.18)}"></span>
          <b>${p.short || g.kind}</b><span class="pr-cnt">${g.rs.length}곳</span><span class="pr-near ${near.dist === 0 ? 'zero' : ''}">최근접 ${near.dist === 0 ? '0.00km' : App.fmtDist(near.dist)}</span></div>
        ${(() => { const s = g.rs.filter(r => r.inR != null), a = s.reduce((x, r) => x + r.inR, 0), t = s.reduce((x, r) => x + r.tot, 0), ln = s.some(r => r.isLine); return s.length && t > 0 ? `<div class="pr-insum">반경 내 합계 ${qty(a, ln)} / 전체 ${qty(t, ln)} (${pctT(a, t)})</div>` : ''; })()}
        ${g.rs.slice(0, 3).map(item).join('')}${more}</div>`;
    }).join('') + srcHtml();
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
  let lastSrc = null;
  // 자료 출처: 결과 맨 아래 접힌 칸 (누르면 펼침)
  function srcHtml() { if (!lastSrc) return ''; return `<details class="pr-src"><summary>자료 출처 보기</summary><ul class="bullets">${lastSrc.srcs.map(s => `<li>${s}</li>`).join('')}${lastSrc.errs.map(e => `<li class="err">오류: ${e}</li>`).join('')}</ul></details>`; }
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
    const sw = p => `<span class="swatch${p.line ? ' swatch-line' : ''}${p.point ? ' swatch-pt' : ''}" style="border-color:${p.color};background:${p.line ? 'transparent' : hexA(p.color, 0.18)}"></span>`;
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
      PROT.forEach(x => { App.opts.protOn[x.id] = v; });
      document.querySelectorAll('#protList [data-prot]').forEach(c => { c.checked = v; });
      syncGroups(); App.saveOpts(); App.liveSets.forEach(s => s.changed()); App.emit();
    });
    $('#protList').addEventListener('change', e => {
      const gid = e.target.dataset.pgroup;
      if (gid) {
        PROT.filter(x => x.group === gid).forEach(x => { App.opts.protOn[x.id] = e.target.checked; });
        document.querySelectorAll(`#protList [data-group="${gid}"] [data-prot]`).forEach(c => { c.checked = e.target.checked; });
      } else {
        const id = e.target.dataset.prot; if (!id) return;
        App.opts.protOn[id] = e.target.checked;
      }
      syncGroups(); App.saveOpts();
      App.liveSets.forEach(s => s.changed()); App.emit();
    });
    $('#protRadius').value = App.opts.protRadius || 5;
  { const sc = $('#protScope'), seg = $('#protScopeSeg'); if (sc) { sc.value = App.opts.protScope || 'radius';
    const HINT = { radius: '사업지구 경계에서 입력한 거리 안', sigg: '사업지구가 속한 시군구 안 전체 (반경 무관)', both: '입력한 거리 안이면서 사업지구 시군구 안' };
    const upd = () => { const r = $('#protRadius'); if (r) r.closest('label').hidden = sc.value === 'sigg'; if (seg) seg.querySelectorAll('[data-sc]').forEach(b => b.classList.toggle('on', b.dataset.sc === sc.value)); const h = $('#protScopeHint'); if (h) h.textContent = HINT[sc.value] || ''; };
    upd(); sc.addEventListener('change', () => { App.opts.protScope = sc.value; App.saveOpts(); upd(); });
    if (seg) seg.addEventListener('click', e => { const b = e.target.closest('[data-sc]'); if (!b) return; sc.value = b.dataset.sc; sc.dispatchEvent(new Event('change')); }); } }
    $('#protLabelChk').checked = App.opts.protLabel !== false;
    $('#protLabelChk').addEventListener('change', e => { App.opts.protLabel = e.target.checked; App.saveOpts(); cache.clear(); App.liveSets.forEach(s => s.changed()); App.emit(); });
    $('#protRingChk').checked = App.opts.protRingShow !== false;
    $('#protRingChk').addEventListener('change', e => { App.opts.protRingShow = e.target.checked; App.saveOpts(); App.liveSets.forEach(s => s.changed()); App.emit(); });
    ['#riverLblChk', '#riverLblChk2'].forEach(id => { const c = $(id); if (!c) return; c.checked = App.opts.riverLabel !== false; c.addEventListener('change', e => { App.opts.riverLabel = e.target.checked; App.saveOpts(); ['#riverLblChk', '#riverLblChk2'].forEach(j => { const d = $(j); if (d) d.checked = e.target.checked; }); cache.clear(); App.liveSets.forEach(s => s.changed()); App.emit(); }); });
    $('#btnProt').addEventListener('click', () => run());   // 이벤트 객체가 반경 인자로 들어가지 않도록
    const sb = $('#protStyleBox');
    if (sb) sb.addEventListener('input', e => {
      const id = e.target.dataset.ls, f = e.target.dataset.f; if (!id || !f) return;
      App.opts.protCustom = App.opts.protCustom || {}; const c = App.opts.protCustom[id] = App.opts.protCustom[id] || {};
      c[f] = f === 'width' ? Number(e.target.value) || null : e.target.value;
      App.saveOpts(); cache.clear(); App.liveSets.forEach(s => s.changed()); App.emit();
    });
    document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-wconfirm]'); if (!b) return; e.preventDefault(); const r = b.getBoundingClientRect(); App.waterConfirm(b.dataset.wconfirm, r.left, r.bottom + 4); });
  // 상수원보호구역 명칭 확인 창: 확인한 이름을 팀 명칭표에 저장 (도면 표시용 글자 바꾸기와는 별개)
  App.waterConfirm = (wuid, x, y) => {
    const info = App.waterInfo[wuid] || {};
    let box = document.getElementById('wcPop');
    if (!box) { box = document.createElement('div'); box.id = 'wcPop'; box.className = 'prop-pop wc-pop'; document.body.appendChild(box); }
    const q = encodeURIComponent([info.sigg, '상수원보호구역', info.remark].filter(Boolean).join(' '));
    const esc2 = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.innerHTML = '<div class="pp-h"><b>상수원보호구역 명칭 확인</b><button type="button" class="pp-x" data-wc="x">×</button></div>' +
      '<div class="wc-info"><div><span>시군구</span>' + esc2(info.sigg || '-') + '</div>' + (info.gosi ? '<div><span>고시번호</span>' + esc2(info.gosi) + '</div>' : '') + (info.remark ? '<div><span>원자료 비고</span>' + esc2(info.remark) + ' <small>(이름이 아닐 수 있음)</small></div>' : '') + '</div>' +
      '<div class="wc-links"><a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/search?q=' + q + '">인터넷에서 찾기</a>' + (info.gosi ? '<a class="btn small" target="_blank" rel="noopener" href="https://www.eum.go.kr/web/gs/gv/gvGosiList.jsp" title="고시번호 ' + esc2(info.gosi) + ' 로 검색">토지이음 고시정보</a>' : '') + '</div>' +
      '<label class="field"><span>확인한 명칭</span><input type="text" data-wc="name" placeholder="예: 신흥 (뒤에 상수원보호구역은 자동)"></label>' +
      '<label class="check"><input type="checkbox" data-wc="conn" checked> 붙어 있는 미확인 조각에도 같이 적용</label>' +
      '<div class="row"><button type="button" class="btn primary small" data-wc="save">팀 명칭표에 저장</button></div>' +
      '<ul class="bullets"><li>팀 전체에 저장되어 다음부터 모든 팀원 화면에 이 명칭이 나옵니다</li><li>도면에서만 다르게 쓰려면 지금처럼 명칭을 두 번 눌러 글자를 바꾸세요</li></ul><div class="wc-msg"></div>';
    box.hidden = false; box.style.left = Math.max(8, Math.min(x, innerWidth - 340)) + 'px'; box.style.top = Math.max(8, Math.min(y, innerHeight - 380)) + 'px';
    box.querySelector('[data-wc=name]').focus();
    box.onclick = async ev => {
      const t = ev.target.closest('[data-wc]'); if (!t) return;
      if (t.dataset.wc === 'x') { box.hidden = true; return; }
      if (t.dataset.wc !== 'save') return;
      const nm = box.querySelector('[data-wc=name]').value.trim(), msgEl = box.querySelector('.wc-msg');
      if (!nm) { msgEl.textContent = '명칭을 넣으세요'; return; }
      let uids = [wuid];
      if (box.querySelector('[data-wc=conn]').checked) {   // 같은 시군구의 미확인 조각 중 서로 붙어 있는 것 (5m 이내)
        const fs = App.src.prot.getFeatures().filter(f => f.get('kind') === 'water' && f.get('name') === App.WATER_UNK && f.get('g5') && (App.waterInfo[f.get('wuid')] || {}).sigg === info.sigg);
        let frontier = fs.filter(f => f.get('wuid') === wuid), seen = new Set(frontier);
        while (frontier.length) { const nx = []; frontier.forEach(a => fs.forEach(b => { if (seen.has(b)) return; try { if (a.get('g5').distance(b.get('g5')) < 5) { seen.add(b); nx.push(b); } } catch (e2) {} })); frontier = nx; }
        seen.forEach(f => { if (!uids.includes(f.get('wuid'))) uids.push(f.get('wuid')); });
      }
      t.disabled = true; msgEl.textContent = '저장 중...';
      try {
        await App.saveWaterName(uids, nm);
        const full = /보호구역$/.test(nm) ? nm : nm + ' 상수원보호구역';
        App.src.prot.getFeatures().forEach(f => { if (f.get('kind') === 'water' && uids.includes(f.get('wuid'))) f.set('name', full); });
        const keep = [];
        rows.forEach(r => { if (r.kind === 'water' && (r.wuids || [r.wuid]).some(w => uids.includes(w))) { r.name = full; r.key = 'water|' + full; } const m = keep.find(k => k.kind === 'water' && r.kind === 'water' && k.name === r.name && r.name !== App.WATER_UNK); if (m) { if (r.dist < m.dist) { m.dist = r.dist; m.np = r.np; } m.over += r.over; (r.wuids || []).forEach(w => { if (!m.wuids.includes(w)) m.wuids.push(w); }); } else keep.push(r); });
        rows = keep; rows.sort((a, b) => a.dist - b.dist);
        syncArrows(); renderTable(); try { mirror(); } catch (e3) {} App.liveSets.forEach(s => s.changed()); App.layout && App.layout.redraw && App.layout.redraw();
        msgEl.textContent = '저장했습니다 (' + uids.length + '개 구역)'; setTimeout(() => { box.hidden = true; }, 900);
      } catch (e2) { msgEl.textContent = e2.message; t.disabled = false; }
    };
  };
  $('#protTable').addEventListener('change', e => {
      if (e.target.dataset.show) { App.opts.protShow[e.target.dataset.show] = e.target.checked; App.saveOpts(); mirror(); App.liveSets.forEach(s => s.changed()); App.emit(); return; }
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
