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

  let layer = null, rows = [], nameRows = [], lastQuery = null;
  const opt = () => (App.opts.eia = App.opts.eia || { radius: 3, years: 5, kinds: { eia: true, small: true, strat: true } });

  function ensureLayer() {
    if (layer || !App.workMap) return;
    layer = new ol.layer.Vector({ source: new ol.source.Vector(), zIndex: 60, visible: false, style: styleOf });
    App.workMap.addLayer(layer);
  }
  function styleOf(f, res) {
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
    const cql = `BBOX(geom,${b.join(',')},'EPSG:3857') AND (${yrs.map(y => `mgtno LIKE '__${y}%'`).join(' OR ')})`;
    const u = `${WFS}?SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature&typeName=EIASS:ICT_BA00&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=3000` +
      '&propertyName=mgtno,eia_gb_cd,biz_nm,clss,sp_sd_nm,sp_sgg_nm,sp_emd_nm,sp_etc_txt,spape_area,geom&CQL_FILTER=' + encodeURIComponent(cql);
    msg.textContent = '환경영향평가 지리정보서비스에서 사업 위치를 받는 중...';
    const j = await fetchJson(u);
    const rd = new jsts.io.GeoJSONReader(), fmt = new ol.format.GeoJSON();
    const by = new Map();
    for (const f of j.features || []) {
      if (!f.geometry) continue;
      const p = f.properties || {};
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
    return [...x.querySelectorAll('item')].map(it => Object.fromEntries([...it.children].map(c => [c.tagName, c.textContent.trim()])));
  }
  async function runByName(words, msg) {
    const yrs = new Set(yearsList().map(String)), out = new Map(), want = opt().kinds;
    const add = (code, kind, name, dt, organ) => { if (!code || out.has(code)) return; const y = String(dt || '').slice(0, 4) || String(code).slice(2, 6); if (!yrs.has(y)) return; out.set(code, { code, kind, name, year: y, organ: organ || '' }); };
    for (const w of words) {
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
      drawMap(site, radius);
      // 이름 검색어: 찾은 사업의 시군구 + 직접 입력
      const auto = [...new Set(rows.map(r => r.sgg).filter(Boolean))];
      const inp = $('#eiaWords'); if (!inp.value.trim() && auto.length) inp.value = auto.join(', ');
      renderSpatial();
      const words = inp.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean).map(s => s.length > 2 ? s.replace(/(특별자치시|특별자치도|광역시|특별시|시|군|구)$/, '') : s).filter((s, i, a) => s && a.indexOf(s) === i);
      nameRows = []; $('#eiaNameNote').textContent = '';
      if (words.length && $('#eiaUseName').checked) {
        try { nameRows = await runByName(words, msg); }
        catch (e) { $('#eiaNameNote').innerHTML = e.notReg ? '공공데이터포털에서 <b>환경영향평가 협의 현황정보(15142987)</b>, <b>사전/전략/소규모협의현황정보(15142990)</b> 활용신청이 필요합니다. 신청하면 바로 쓸 수 있습니다 (자동 승인).' : '이름 검색 실패: ' + esc(e.message); }
      }
      renderName();
      msg.textContent = `반경 ${o.radius}km 안 ${rows.length}건 (최근 ${o.years}년, 위치 기준)` + (nameRows.length ? ` · 사업명 검색 ${nameRows.length}건` : '');
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
  function renderName() {
    const want = opt().kinds, codes = new Set(rows.map(r => r.code));
    const list = nameRows.filter(r => want[r.kind] !== false && !codes.has(r.code));
    const d = $('#eiaNameBox'); d.hidden = !list.length && !$('#eiaNameNote').textContent;
    $('#eiaNameCnt').textContent = list.length ? `(${list.length}건)` : '';
    $('#eiaNameTable').innerHTML = list.length ? '<thead><tr><th>구분</th><th>사업명</th><th>연도</th></tr></thead><tbody>' + list.map(r => `<tr><td><span class="eia-k" style="--c:${KIND[r.kind].color}">${r.kind === 'eia' ? '환경' : r.kind === 'small' ? '소규모' : '전략'}</span></td><td class="eia-nm"><a href="${App.eiassLink(r.code)}" target="_blank" rel="noopener">${esc(r.name)}</a></td><td>${esc(r.year)}</td></tr>`).join('') + '</tbody>' : '';
  }

  function exportCsv() {
    const want = opt().kinds;
    const L = [['번호', '구분', '사업코드', '사업명', '연도', '소재지', '최근접 거리(km)', '비고', 'EIASS 링크']];
    rows.filter(r => want[r.kind] !== false).forEach(r => L.push([r.no, KIND[r.kind].name, r.code, r.name, r.year, r.loc, r.dist <= 0.5 ? 0 : (r.dist / 1000).toFixed(r.dist < 1000 ? 2 : 1), r.approx ? '위치 대략(법정동)' : '', App.eiassLink(r.code)]));
    const codes = new Set(rows.map(r => r.code));
    nameRows.filter(r => want[r.kind] !== false && !codes.has(r.code)).forEach(r => L.push(['', KIND[r.kind].name, r.code, r.name, r.year, '', '', '사업명 검색 (위치 미확인)', App.eiassLink(r.code)]));
    const csv = '\ufeff' + L.map(r => r.map(v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = ((App.opts.projName || $('#projName')?.value || '사업') + '_주변평가사업.csv').replace(/[\\/:*?"<>|]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function hl(code) { if (!layer) return; layer.getSource().getFeatures().forEach(f => f.set('hl', f.get('code') === code)); }
  function zoomTo(code) {
    if (!layer) return; const fs = layer.getSource().getFeatures().filter(f => f.get('code') === code); if (!fs.length) return;
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
