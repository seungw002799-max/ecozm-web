/* 주변 평가사업: 사업지구 반경 안의 환경영향평가·소규모환경영향평가 사업 (EIASS)
   1) 위치 기준: 환경영향평가 지리정보서비스(EIAGIS) 사업지 레이어 EIASS:ICT_BA00 (사업 경계 도형) -> 실제 거리 계산
   2) 이름 기준(보조): 공공데이터포털 EIASS 협의현황 API (전략·소규모·환경영향평가) -> 사업명에 시군구 이름이 들어간 사업, 거리 없음 */
(function () {
  const PROXY = 'https://ecozm-proxy.seungw002799.workers.dev/?url=';
  const WFS = 'https://eiagissv.eiass.go.kr/EIASS/wfs';
  const API = 'https://apis.data.go.kr/1480523/';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KIND = { eia: { name: '환경영향평가', color: '#1565C0' }, small: { name: '소규모환경영향평가', color: '#EF6C00' }, strat: { name: '전략환경영향평가', color: '#6A1B9A' } };
  const isEiaCode = c => /^[A-Z]{2}\d{4}[A-Z]\d{3}$/.test(c);
  App.eiassLink = c => isEiaCode(c) ? 'https://www.eiass.go.kr/biz/base/info/eiaInfo.do?EIA_CD=' + encodeURIComponent(c) : 'https://www.eiass.go.kr/biz/base/info/perInfo.do?PER_CD=' + encodeURIComponent(c);
  const fmtD = m => m <= 0.5 ? '중첩' : (App.fmtDist ? App.fmtDist(m) : (m / 1000).toFixed(2) + 'km');

  let layer = null, rows = [], nameRows = [], nameOut = { far: 0, other: 0, none: [] }, lastQuery = null;
  const opt = () => (App.opts.eia = App.opts.eia || { radius: 3, years: 5, kinds: { eia: true, small: true, strat: true } });

  function ensureLayer() {
    if (layer || !App.workMap) return;
    layer = new ol.layer.Vector({ source: new ol.source.Vector(), zIndex: 60, visible: false, style: styleOf });
    App.workMap.addLayer(layer);
  }
  function styleOf(f, res) {
    if (f.get('ncode')) { const k = KIND[f.get('kind')] || KIND.eia, on = f.get('hl'); if (f.get('how') === '지번') return new ol.style.Style({ image: new ol.style.RegularShape({ points: 3, radius: on ? 10 : 7, fill: new ol.style.Fill({ color: k.color }), stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 }) }) }); return on ? new ol.style.Style({ stroke: new ol.style.Stroke({ color: k.color, width: 2.5, lineDash: [4, 4] }), fill: new ol.style.Fill({ color: k.color + '18' }) }) : null; }
    if (f.get('ring')) return new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#111', width: 1.6, lineDash: [8, 5] }) });
    const k = KIND[f.get('kind')] || KIND.eia, on = f.get('hl');
    const st = [new ol.style.Style({ fill: new ol.style.Fill({ color: k.color + (on ? '55' : '26') }), stroke: new ol.style.Stroke({ color: k.color, width: on ? 3 : 1.6 }) })];
    if (f.get('first')) st.push(new ol.style.Style({ geometry: g => { const gg = g.getGeometry(); return gg.getType() === 'MultiPolygon' ? gg.getInteriorPoints() : gg.getType() === 'Polygon' ? gg.getInteriorPoint() : null; },
      text: new ol.style.Text({ text: String(f.get('no')), font: 'bold 12px "EcoFont","Malgun Gothic",sans-serif', fill: new ol.style.Fill({ color: '#fff' }), backgroundFill: new ol.style.Fill({ color: k.color }), padding: [1, 4, 0, 4] }) }));
    return st;
  }
  App.eiaShow = on => { ensureLayer(); if (layer) layer.setVisible(!!on); };

  // ---------------------------------------------------------------- 1) 위치 기준
  function siteGeom() {
    const rd = new jsts.io.GeoJSONReader();
    const gs = App.sites.filter(s => s.geometry).map(s => rd.read(s.geometry));
    if (!gs.length) return null;
    let g = gs[0]; for (let i = 1; i < gs.length; i++) g = g.union(gs[i]);
    return g;
  }
  function yearsList() { const n = Math.max(1, Math.min(20, Number(opt().years) || 5)), y = new Date().getFullYear(); return Array.from({ length: n }, (_, i) => y - i); }

  async function fetchJson(u, ms = 45000) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms);
    try { const r = await fetch(PROXY + encodeURIComponent(u), { signal: ac.signal }); const t = await r.text(); if (!r.ok) throw new Error('HTTP ' + r.status); try { return JSON.parse(t); } catch (e) { throw new Error('서버 응답 오류'); } }
    catch (e) { throw new Error(e.name === 'AbortError' ? '서버가 응답하지 않습니다 (시간 초과)' : e.message); }
    finally { clearTimeout(tm); }
  }

  async function runSpatial(site, radius, msg) {
    const env = site.getEnvelopeInternal();
    const c = [[env.getMinX() - radius, env.getMinY() - radius], [env.getMaxX() + radius, env.getMinY() - radius], [env.getMinX() - radius, env.getMaxY() + radius], [env.getMaxX() + radius, env.getMaxY() + radius]].map(p => proj4('EPSG:5186', 'EPSG:3857', p));
    const b = [Math.min(...c.map(p => p[0])), Math.min(...c.map(p => p[1])), Math.max(...c.map(p => p[0])), Math.max(...c.map(p => p[1]))].map(v => Math.round(v));
    const yrs = yearsList();
    const cql = `BBOX(geom,${b.join(',')},'EPSG:3857')`;   // 연도 조건을 같이 넣으면 서버가 응답하지 않아 연도는 받은 뒤 거름
    const ySet = new Set(yrs.map(String));
    const u = `${WFS}?SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature&typeName=EIASS:ICT_BA00&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=5000` +
      '&propertyName=mgtno,eia_gb_cd,biz_nm,clss,sp_sd_nm,sp_sgg_nm,sp_emd_nm,sp_etc_txt,spape_area,geom&CQL_FILTER=' + encodeURIComponent(cql);
    msg.textContent = '환경영향평가 지리정보서비스에서 사업 위치를 받는 중...';
    const j = await fetchJson(u);
    const rd = new jsts.io.GeoJSONReader(), fmt = new ol.format.GeoJSON();
    const by = new Map();
    for (const f of j.features || []) {
      if (!f.geometry) continue;
      const p = f.properties || {};
      if (!ySet.has(String(p.mgtno || '').slice(2, 6))) continue;
      let g5186;
      try { g5186 = JSON.parse(JSON.stringify(f.geometry)); const tf = a => typeof a[0] === 'number' ? proj4('EPSG:4326', 'EPSG:5186', a) : a.map(tf); g5186.coordinates = tf(g5186.coordinates); } catch (e) { continue; }
      let d; try { const jg = rd.read(g5186); d = site.distance(jg.isValid() ? jg : jg.buffer(0)); } catch (e) { continue; }
      if (d > radius) continue;
      const code = p.mgtno, kind = p.eia_gb_cd === '1' || isEiaCode(code) ? 'eia' : 'small';
      const r = by.get(code) || { code, kind, name: p.biz_nm, year: Number(String(code).slice(2, 6)) || '', loc: [p.sp_sd_nm, p.sp_sgg_nm, p.sp_emd_nm].filter(Boolean).join(' '), sgg: p.sp_sgg_nm || '', approx: false, dist: Infinity, geoms: [] };
      r.dist = Math.min(r.dist, d); if (p.clss && p.clss !== '정좌표') r.approx = true;
      r.geoms.push(fmt.readGeometry(f.geometry, { dataProjection: 'EPSG:4326', featureProjection: App.workMap.getView().getProjection() }));
      by.set(code, r);
    }
    return [...by.values()].sort((a, b) => a.dist - b.dist);
  }

  // ---------------------------------------------------------------- 2) 이름 기준 (공공데이터포털)
  function dataKey() { try { return (App.cfg && (App.cfg.dataKey || App.cfg.serviceKey)) || (typeof window.dataKey === 'function' ? window.dataKey() : '') || localStorage.getItem('ecoDataKey') || ''; } catch (e) { return ''; } }
  async function apiList(path, params) {
    const k = App.dataKey ? App.dataKey() : dataKey();
    if (!k) throw new Error('공공데이터포털 인증키가 없습니다 (도면 탭 1. 설정)');
    const q = Object.entries(params).map(([a, v]) => a + '=' + encodeURIComponent(v)).join('&');
    const r = await fetch(`${API}${path}?serviceKey=${k}&${q}`);
    const t = await r.text();
    if (/SERVICE_KEY_IS_NOT_REGISTERED|등록되지 않은/.test(t)) { const e = new Error('NOTREG'); e.notReg = true; throw e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const x = new DOMParser().parseFromString(t, 'text/xml');
    const items = [...x.querySelectorAll('item')].map(it => Object.fromEntries([...it.children].map(c => [c.tagName, c.textContent.trim()])));
    const tc = x.querySelector('totalCount'), total = tc ? Number(tc.textContent) || 0 : 0;
    if (params.pageNo < 4 && total > params.pageNo * params.numOfRows) { const more = await apiList(path, Object.assign({}, params, { pageNo: params.pageNo + 1 })); return items.concat(more); }
    return items;
  }
  async function runByName(sgs, msg) {
    const words = sgs.map(s => s.stem);
    const yrs = new Set(yearsList().map(String)), out = new Map(), want = opt().kinds;
    // 다른 지역의 비슷한 이름 빼기: '대구미천'(앞에 한글), '구미리'(리·동), '청주시 … 구미리'(앞에 다른 시·군 이름)
    const okName = (name, w) => { const s = String(name || ''); let i = s.indexOf(w); while (i >= 0) { const pre = s.slice(0, i), nx = s.charAt(i + w.length); const badPre = /[가-힣]$/.test(pre), badNx = /^[리동읍면]$/.test(nx) && !/^(시|군|구)$/.test(nx), otherCity = pre.split(/[\s()]+/).some(t => t.length >= 3 && /[시군]$/.test(t)); if (!badPre && !badNx && !otherCity) return true; i = s.indexOf(w, i + 1); } return false; };
    let curW = '', curSg = null;
    const add = (code, kind, name, dt, organ) => { if (!code || out.has(code) || (curW && !okName(name, curW))) return; const cy = String(code).slice(2, 6), y = /^(19|20)\d\d$/.test(cy) ? cy : String(dt || '').slice(0, 4); if (!yrs.has(y)) return; out.set(code, { code, kind, name, year: y, organ: organ || '', sg: curSg }); };
    for (const w of words) {
      curW = w; curSg = sgs.find(s => s.stem === w);
      msg.textContent = `사업명에 "${w}"이(가) 들어간 사업을 찾는 중...`;
      const jobs = [];
      if (want.strat !== false) jobs.push(apiList('BeffatStrtgySmallScaleDscssSttusInfoInqireService/getBsnsStrtgySmallScaleDscssListInfoInqire', { pageNo: 1, numOfRows: 300, pressGubn: 'S', searchText: w }).then(a => a.forEach(i => add(i.perCd, 'strat', i.bizNm, i.applyDt))));
      if (want.small !== false) jobs.push(apiList('BeffatStrtgySmallScaleDscssSttusInfoInqireService/getBsnsStrtgySmallScaleDscssListInfoInqire', { pageNo: 1, numOfRows: 300, pressGubn: 'M', searchText: w }).then(a => a.forEach(i => add(i.perCd, 'small', i.bizNm, i.applyDt))));
      if (want.eia !== false) jobs.push(apiList('EnvrnAffcEvlDscssSttusInfoInqireService/getDscssBsnsListInfoInqire', { pageNo: 1, numOfRows: 300, searchText: w }).then(a => a.forEach(i => add(i.eiaCd, 'eia', i.bizNm, i.stepChangeDt, i.ccilOrganNm))));
      const rs = await Promise.allSettled(jobs);
      const nr = rs.find(r => r.status === 'rejected' && r.reason && r.reason.notReg);
      if (nr) throw nr.reason;
    }
    return [...out.values()].sort((a, b) => String(b.year).localeCompare(String(a.year)));
  }

  // ---------------------------------------------------------------- 3) 사업명에서 위치 찾기 (브이월드)
  const VW = () => 'key=' + App.cfg.vworldKey + '&domain=' + encodeURIComponent(location.origin);
  const gcache = new Map();
  async function vwSearch(type, cat, q) {
    const u = 'https://api.vworld.kr/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=10&page=1&format=json&type=' + type + (cat ? '&category=' + cat : '') + '&query=' + encodeURIComponent(q) + '&' + VW();
    const j = await App.jsonp(u); return (j.response && j.response.result && j.response.result.items) || [];
  }
  async function vwData(data, filter, size = 50) {
    const u = 'https://api.vworld.kr/req/data?service=data&request=GetFeature&data=' + data + '&format=json&size=' + size + '&page=1&geometry=true&attribute=true&crs=EPSG:4326&attrFilter=' + encodeURIComponent(filter) + '&' + VW();
    const j = await App.jsonp(u); return (j.response && j.response.result && j.response.result.featureCollection && j.response.result.featureCollection.features) || [];
  }
  const to5186 = g => { const c = JSON.parse(JSON.stringify(g)); const tf = a => typeof a[0] === 'number' ? proj4('EPSG:4326', 'EPSG:5186', a) : a.map(tf); c.coordinates = tf(c.coordinates); return new jsts.io.GeoJSONReader().read(c); };
  const ptGeom = (x, y) => { const p = proj4('EPSG:4326', 'EPSG:5186', [x, y]); return new jsts.geom.GeometryFactory().createPoint(new jsts.geom.Coordinate(p[0], p[1])); };
  // 사업명 -> { 시군, 읍면동, 리, 번지 }
  function parseName(name, sg) {
    const tk = String(name).replace(/[()\[\]{}·,]/g, ' ').split(/\s+/).filter(Boolean);
    let city = null, emd = null, ri = null, num = null;
    for (let i = 0; i < tk.length; i++) {
      const t = tk[i];
      if (!city && /^[가-힣]{2,5}[시군]$/.test(t)) { city = t; continue; }
      if (!emd && /^[가-힣]{1,4}[읍면]$/.test(t)) { emd = t; continue; }
      if (!emd && /^[가-힣]{1,5}동\d?가?$/.test(t) && (city || /^산?\d/.test(tk[i + 1] || ''))) { emd = t; continue; }
      if (emd && !ri && /^[가-힣]{1,4}리$/.test(t)) { ri = t; continue; }
      if ((emd || ri) && !num && /^산?\d+(-\d+)?(번지)?/.test(t)) { num = t.match(/^산?\d+(-\d+)?/)[0]; break; }
      if (emd && !/^[가-힣]{1,4}리$/.test(t)) break;
    }
    if (city && sg && city !== sg.name && city.replace(/[시군]$/, '') !== sg.stem) return { other: city };   // 다른 시군 사업
    return { emd, ri, num };
  }
  async function locate(r, sg, site) {
    const key = r.code; if (gcache.has(key)) return gcache.get(key);
    const p = parseName(r.name, sg); let res = { how: 'none' };
    try {
      if (p.other) res = { how: 'other', note: p.other };
      else if (p.emd && p.num) {   // 지번
        const q = [sg.full, p.emd, p.ri, p.num].filter(Boolean).join(' ');
        const it = (await vwSearch('address', 'parcel', q))[0];
        if (it && it.point) res = { how: '지번', g: ptGeom(+it.point.x, +it.point.y), pt: [+it.point.x, +it.point.y] };
      }
      if (res.how === 'none' && p.emd && p.ri) {   // 리 경계
        const fs = (await vwData('LT_C_ADRI_INFO', 'li_kor_nm:=:' + p.ri)).filter(f => { const n = (f.properties || {}).full_nm || ''; return n.includes(sg.name) && n.includes(p.emd); });
        if (fs[0]) res = { how: '리', g: to5186(fs[0].geometry), gj: fs[0].geometry };
      }
      if (res.how === 'none' && p.emd) {   // 읍면동 경계
        const it = (await vwSearch('district', 'L4', sg.full + ' ' + p.emd))[0];
        if (it && it.id) { const fs = await vwData('LT_C_ADEMD_INFO', 'emd_cd:=:' + it.id, 1); if (fs[0]) res = { how: '읍면동', g: to5186(fs[0].geometry), gj: fs[0].geometry }; }
      }
    } catch (e) { res = { how: 'none' }; }
    if (res.g) { try { res.dist = site.distance(res.g); } catch (e) { res.dist = Infinity; } }
    gcache.set(key, res); return res;
  }
  // 반경과 겹치는 시군구 (사업명 검색어)
  async function siggsNear(site, radius) {
    const env = site.getEnvelopeInternal();
    const c = [[env.getMinX() - radius, env.getMinY() - radius], [env.getMaxX() + radius, env.getMaxY() + radius]].map(p => proj4('EPSG:5186', 'EPSG:4326', p));
    const u = 'https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LT_C_ADSIGG_INFO&format=json&size=30&page=1&geometry=true&attribute=true&crs=EPSG:4326&geomFilter=' + encodeURIComponent('BOX(' + c[0][0] + ',' + c[0][1] + ',' + c[1][0] + ',' + c[1][1] + ')') + '&' + VW();
    const j = await App.jsonp(u), fs = (j.response && j.response.result && j.response.result.featureCollection && j.response.result.featureCollection.features) || [];
    const buf = site.buffer(radius, 12), out = [];
    for (const f of fs) { const p = f.properties || {}; let hit = true; try { hit = to5186(f.geometry).intersects(buf); } catch (e) {} if (hit) out.push({ name: p.sig_kor_nm, full: p.full_nm || p.sig_kor_nm, stem: String(p.sig_kor_nm).replace(/(시|군|구)$/, '') }); }
    // 일반구가 있는 시 (예: 청주시 상당구): 시 이름으로 묶음
    const seen = new Set(); return out.map(s => { const m = s.full.split(' '); if (m.length >= 3) { s.name = m[1]; s.stem = m[1].replace(/(시|군)$/, ''); s.full = m[0] + ' ' + m[1]; } return s; }).filter(s => !seen.has(s.full) && seen.add(s.full));
  }

  // ---------------------------------------------------------------- 실행
  async function run() {
    const msg = $('#eiaMsg'), btn = $('#btnEiaRun');
    const site = siteGeom();
    if (!site) { App.toast && App.toast('먼저 도면 탭에서 사업지구 도면을 올리세요'); return; }
    const o = opt();
    o.radius = Math.max(0.1, Math.min(5, Number($('#eiaRadius').value) || 3)); $('#eiaRadius').value = o.radius;
    o.years = Math.max(1, Math.min(20, Number($('#eiaYears').value) || 5));
    ['eia', 'small', 'strat'].forEach(k => { o.kinds[k] = $('#eiaK_' + k).checked; });
    App.saveOpts && App.saveOpts();
    const radius = o.radius * 1000;
    btn.disabled = true; msg.hidden = false; msg.className = 'progress';
    try {
      rows = await runSpatial(site, radius, msg);
      lastQuery = { radius, site };
      drawMap(site, radius); renderSpatial();
      // 사업명 검색: 반경과 겹치는 시군구 이름으로 찾고, 사업명의 주소(지번·리·읍면동)로 위치를 잡아 반경 안만 남김
      nameRows = []; nameOut = { far: 0, other: 0, none: [] }; $('#eiaNameNote').textContent = '';
      if ($('#eiaUseName').checked) {
        try {
          msg.textContent = '반경과 겹치는 시군구를 찾는 중...';
          let sgs = await siggsNear(site, radius);
          const extra = $('#eiaWords').value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
          extra.forEach(w => { const nm = w, stem = w.length > 2 ? w.replace(/(시|군|구)$/, '') : w; if (!sgs.some(s => s.stem === stem)) sgs.push({ name: nm, full: nm, stem }); });
          $('#eiaWords').placeholder = '자동: ' + sgs.map(s => s.name).join(', ');
          const found = await runByName(sgs, msg);
          let done = 0; const pool = found.slice(), out = [];
          await Promise.all(Array.from({ length: 4 }, async () => { while (pool.length) { const r = pool.shift(); const L = await locate(r, r.sg, site); done++; msg.textContent = '사업명에서 위치를 찾는 중... ' + done + '/' + found.length; r.loc = L; out.push(r); } }));
          out.forEach(r => { const L = r.loc; if (L.how === 'other') nameOut.other++; else if (!L.g) nameOut.none.push(r); else if (L.dist > radius) nameOut.far++; else nameRows.push(r); });
          nameRows.sort((a, b) => a.loc.dist - b.loc.dist);
          drawNamePts();
        } catch (e) { $('#eiaNameNote').innerHTML = e.notReg ? '공공데이터포털에서 <b>환경영향평가 협의 현황정보(15142987)</b>, <b>사전/전략/소규모협의현황정보(15142990)</b> 활용신청이 필요합니다.' : '사업명 검색 실패: ' + esc(e.message); }
      }
      renderName();
      msg.textContent = `반경 ${o.radius}km 안 ${rows.length}건 (최근 ${o.years}년, 위치 기준)` + ($('#eiaUseName').checked ? ` · 사업명 주소 기준 반경 안 ${nameRows.length}건` : '');
    } catch (e) { msg.className = 'progress err'; msg.textContent = '조회 실패: ' + e.message; }
    finally { btn.disabled = false; }
  }

  function drawMap(site, radius) {
    ensureLayer(); if (!layer) return;
    const src = layer.getSource(); src.clear();
    const fmt = new ol.format.GeoJSON(), proj = App.workMap.getView().getProjection();
    try { const ring = fmt.readGeometry(new jsts.io.GeoJSONWriter().write(site.buffer(radius, 24)), { dataProjection: 'EPSG:5186', featureProjection: proj }); src.addFeature(new ol.Feature({ geometry: ring, ring: true })); } catch (e) {}
    const want = opt().kinds;
    rows.forEach((r, i) => { r.no = i + 1; r.geoms.forEach((g, j) => src.addFeature(new ol.Feature({ geometry: g, kind: r.kind, code: r.code, no: r.no, first: j === 0, hide: want[r.kind] === false }))); });
    src.getFeatures().forEach(f => { if (f.get('hide')) src.removeFeature(f); });
    if (nameRows.length) drawNamePts();
    layer.setVisible(App.curTab === 'eia');
    const ext = src.getExtent(); if (ext && isFinite(ext[0])) App.workMap.getView().fit(ext, { padding: [40, 40, 40, 40], duration: 300 });
  }

  function renderSpatial() {
    const want = opt().kinds, list = rows.filter(r => want[r.kind] !== false);
    const box = $('#eiaResult'); box.hidden = false;
    const cnt = k => list.filter(r => r.kind === k).length;
    $('#eiaSum').innerHTML = `<span class="eia-chip" style="--c:${KIND.eia.color}">환경영향평가 ${cnt('eia')}</span><span class="eia-chip" style="--c:${KIND.small.color}">소규모 ${cnt('small')}</span>`;
    $('#eiaTable').innerHTML = '<thead><tr><th>번호</th><th>구분</th><th>사업명</th><th>연도</th><th>소재지</th><th>거리</th></tr></thead><tbody>' +
      (list.length ? list.map(r => `<tr data-code="${esc(r.code)}"><td>${r.no}</td><td><span class="eia-k" style="--c:${KIND[r.kind].color}">${r.kind === 'eia' ? '환경' : '소규모'}</span></td>` +
        `<td class="eia-nm"><a href="${App.eiassLink(r.code)}" target="_blank" rel="noopener" title="EIASS에서 열기 (${esc(r.code)})">${esc(r.name)}</a>${r.approx ? ' <span class="eia-ap" title="경계가 아니라 법정동 위치로 등록된 사업이라 거리가 대략입니다">위치 대략</span>' : ''}</td>` +
        `<td>${r.year}</td><td class="eia-loc">${esc(r.loc)}</td><td class="num">${fmtD(r.dist)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">반경 안에 위치가 등록된 사업이 없습니다</td></tr>') + '</tbody>';
  }
  const HOW = { '지번': '지번', '리': '리 범위', '읍면동': '읍면동 범위' };
  function renderName() {
    const want = opt().kinds, codes = new Set(rows.map(r => r.code));
    const list = nameRows.filter(r => want[r.kind] !== false && !codes.has(r.code));
    const none = nameOut.none.filter(r => want[r.kind] !== false && !codes.has(r.code));
    const d = $('#eiaNameBox'); d.hidden = !list.length && !none.length && !$('#eiaNameNote').textContent;
    $('#eiaNameCnt').textContent = list.length ? '(' + list.length + '건)' : '(0건)';
    const kn = k => k === 'eia' ? '환경' : k === 'small' ? '소규모' : '전략';
    const dTxt = r => r.loc.how === '지번' ? fmtD(r.loc.dist) : (r.loc.dist <= 0.5 ? '범위가 겹침' : fmtD(r.loc.dist) + ' (경계까지)');
    $('#eiaNameTable').innerHTML = (list.length ? '<thead><tr><th>구분</th><th>사업명</th><th>연도</th><th>위치 근거</th><th>거리</th></tr></thead><tbody>' + list.map(r => '<tr data-ncode="' + esc(r.code) + '"><td><span class="eia-k" style="--c:' + KIND[r.kind].color + '">' + kn(r.kind) + '</span></td><td class="eia-nm"><a href="' + App.eiassLink(r.code) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.year) + '</td><td class="eia-loc">' + HOW[r.loc.how] + '</td><td class="num">' + dTxt(r) + '</td></tr>').join('') + '</tbody>' : '<tbody><tr><td class="empty">사업명 주소로 보면 반경 안에 있는 사업이 없습니다</td></tr></tbody>');
    $('#eiaNameMore').innerHTML = '<div class="eia-note2">반경 밖으로 확인되어 뺀 사업 ' + nameOut.far + '건, 다른 시군 사업 ' + nameOut.other + '건</div>' +
      (none.length ? '<details><summary>사업명에 주소가 없어 위치를 못 찾은 사업 ' + none.length + '건 (직접 확인)</summary><table class="eia-tbl"><tbody>' + none.map(r => '<tr><td><span class="eia-k" style="--c:' + KIND[r.kind].color + '">' + kn(r.kind) + '</span></td><td class="eia-nm"><a href="' + App.eiassLink(r.code) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a></td><td>' + esc(r.year) + '</td></tr>').join('') + '</tbody></table></details>' : '');
  }
  function drawNamePts() {
    ensureLayer(); if (!layer) return;
    const src = layer.getSource(), fmt = new ol.format.GeoJSON(), proj = App.workMap.getView().getProjection();
    src.getFeatures().filter(f => f.get('ncode')).forEach(f => src.removeFeature(f));
    nameRows.forEach(r => { const L = r.loc; let g = null;
      try { g = L.pt ? new ol.geom.Point(ol.proj.fromLonLat(L.pt, proj)) : fmt.readGeometry(L.gj, { dataProjection: 'EPSG:4326', featureProjection: proj }); } catch (e) {}
      if (g) src.addFeature(new ol.Feature({ geometry: g, kind: r.kind, ncode: r.code, how: L.how })); });
  }

  function exportCsv() {
    const want = opt().kinds;
    const L = [['번호', '구분', '사업코드', '사업명', '연도', '소재지', '최근접 거리(km)', '비고', 'EIASS 링크']];
    rows.filter(r => want[r.kind] !== false).forEach(r => L.push([r.no, KIND[r.kind].name, r.code, r.name, r.year, r.loc, r.dist <= 0.5 ? 0 : (r.dist / 1000).toFixed(r.dist < 1000 ? 2 : 1), r.approx ? '위치 대략(법정동)' : '', App.eiassLink(r.code)]));
    const codes = new Set(rows.map(r => r.code));
    nameRows.filter(r => want[r.kind] !== false && !codes.has(r.code)).forEach(r => L.push(['', KIND[r.kind].name, r.code, r.name, r.year, '', r.loc.dist <= 0.5 ? 0 : (r.loc.dist / 1000).toFixed(r.loc.dist < 1000 ? 2 : 1), '사업명 주소 기준 (' + HOW[r.loc.how] + ')', App.eiassLink(r.code)]));
    nameOut.none.filter(r => want[r.kind] !== false && !codes.has(r.code)).forEach(r => L.push(['', KIND[r.kind].name, r.code, r.name, r.year, '', '', '위치 못 찾음 (직접 확인)', App.eiassLink(r.code)]));
    const csv = '\ufeff' + L.map(r => r.map(v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = ((App.opts.projName || $('#projName')?.value || '사업') + '_주변평가사업.csv').replace(/[\\/:*?"<>|]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function hl(code) { if (!layer) return; layer.getSource().getFeatures().forEach(f => f.set('hl', !!code && (f.get('code') === code || f.get('ncode') === code))); }
  function zoomTo(code) {
    if (!layer) return; const fs = layer.getSource().getFeatures().filter(f => f.get('code') === code || f.get('ncode') === code); if (!fs.length) return;
    const e = ol.extent.createEmpty(); fs.forEach(f => ol.extent.extend(e, f.getGeometry().getExtent()));
    App.workMap.getView().fit(e, { padding: [80, 80, 80, 80], maxZoom: 16, duration: 300 }); hl(code);
  }

  function init() {
    const o = opt();
    $('#eiaRadius').value = o.radius; $('#eiaYears').value = o.years;
    ['eia', 'small', 'strat'].forEach(k => { $('#eiaK_' + k).checked = o.kinds[k] !== false; $('#eiaK_' + k).addEventListener('change', () => { o.kinds[k] = $('#eiaK_' + k).checked; App.saveOpts && App.saveOpts(); if (lastQuery) { drawMap(lastQuery.site, lastQuery.radius); renderSpatial(); renderName(); } }); });
    $('#btnEiaRun').addEventListener('click', run);
    $('#btnEiaCsv').addEventListener('click', exportCsv);
    $('#eiaTable').addEventListener('click', e => { if (e.target.closest('a')) return; const tr = e.target.closest('tr[data-code]'); if (tr) zoomTo(tr.dataset.code); });
    $('#eiaTable').addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-code]'); hl(tr ? tr.dataset.code : null); });
    $('#eiaNameTable').addEventListener('click', e => { if (e.target.closest('a')) return; const tr = e.target.closest('tr[data-ncode]'); if (tr) zoomTo(tr.dataset.ncode); });
    $('#eiaNameTable').addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-ncode]'); hl(tr ? tr.dataset.ncode : null); });
    ensureLayer();
    // 지도에서 사업 도형을 누르면 목록의 그 줄로
    App.workMap && App.workMap.on('singleclick', ev => {
      if (App.curTab !== 'eia' || !layer) return;
      let code = null; App.workMap.forEachFeatureAtPixel(ev.pixel, f => { if (!code && f.get('code')) code = f.get('code'); }, { layerFilter: l => l === layer });
      if (!code) return; hl(code); const tr = document.querySelector(`#eiaTable tr[data-code="${CSS.escape(code)}"]`); if (tr) { tr.scrollIntoView({ block: 'center' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1200); }
    });
  }
  const oi = App.init; App.init = async function () { const r = await oi.apply(this, arguments); try { init(); } catch (e) { console.error(e); } return r; };
})();
