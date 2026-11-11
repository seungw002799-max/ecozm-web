/* 보호구역 검토: 사업지구 주변의 보호구역(현재: 겨울철 조류 동시센서스 조사지역)을 API 로 받아
 * 지도에 표시하고, 구역별 중첩 여부·최단거리를 표로 보여준다. app.js 다음, app2.js 앞에 로드. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);

  // 레이어 목록 (나중에 브이월드 자연공원·상수원보호구역 등을 같은 형식으로 추가)
  const PROT = [
    {
      id: 'winter_bird', label: '겨울철 조류 동시센서스 조사지역', short: '조류 조사지역',
      src: 'eiagis', typename: 'WINTER_BIRD', nameField: 'name',
      color: '#7B3FA0', note: 'EIAGIS(환경영향평가 지리정보서비스), 국립생물자원관 2014년 자료',
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
  App.protStyle = function (f, s) {
    const p = BY_ID[f.get('kind')]; if (!p) return null;
    const show = (App.opts.protShow || {})[p.id] !== false;
    if (!show) return null;
    const label = App.opts.protLabel !== false ? (f.get('name') || '') : '';
    const key = p.id + '|' + s.toFixed(3) + '|' + label;
    let st = cache.get(key);
    if (!st) {
      st = new ol.style.Style({
        fill: new ol.style.Fill({ color: hexA(p.color, 0.18) }),
        stroke: new ol.style.Stroke({ color: p.color, width: Math.max(0.8, 2 * s), lineDash: [6 * s, 4 * s] }),
        text: label ? new ol.style.Text({
          text: label, font: `bold ${Math.round(12 * s)}px "EcoFont","Malgun Gothic",sans-serif`,
          fill: new ol.style.Fill({ color: p.color }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 * s }), overflow: true,
        }) : undefined,
      });
      if (cache.size > 500) cache.clear();
      cache.set(key, st);
    }
    return st;
  };

  // ------------------------------------------------------------ 자료 받기
  // EIAGIS WFS 직접 요청 -> 막히면 사이트에 포함된 사본(같은 자료)을 사용
  const localCache = {};
  async function fetchEiagis(p, bbox4326) {
    const u = 'https://eiagissv.eiass.go.kr/EIASS/wfs?SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature' +
      `&TYPENAME=${p.typename}&outputFormat=application/json&SRSNAME=EPSG:4326&BBOX=${bbox4326.join(',')}`;
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(u, { signal: ac.signal });
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
    rows = [];
    try {
      // 사업지구 합치기 (EPSG:5186)
      const rd = new jsts.io.GeoJSONReader();
      const siteGeoms = App.sites.filter(s => s.geometry).map(s => rd.read(s.geometry));
      let site = siteGeoms[0];
      for (let i = 1; i < siteGeoms.length; i++) site = site.union(siteGeoms[i]);
      const fmt3857 = new ol.format.GeoJSON();
      const srcs = [];
      for (const p of chosen) {
        const fc = await fetchEiagis(p, q.b4326);
        srcs.push(p.short + ': ' + (fc._src || ''));
        (fc.features || []).forEach((f, i) => {
          if (!f.geometry) return;
          // 4326 -> 5186 (Z 제거)
          const tf = c => (typeof c[0] === 'number') ? proj4('EPSG:4326', 'EPSG:5186', [c[0], c[1]]) : c.map(tf);
          const g5 = { type: f.geometry.type, coordinates: tf(f.geometry.coordinates) };
          let jg; try { jg = rd.read(g5); if (!jg.isValid()) jg = jg.buffer(0); } catch (e) { return; }
          const dist = jg.distance(site);
          if (dist > radius) return;                         // 반경 밖은 제외
          let over = 0; try { over = dist === 0 ? jg.intersection(site).getArea() : 0; } catch (e) { over = 0; }
          const name = (f.properties || {})[p.nameField] || `(이름 없음 ${i + 1})`;
          rows.push({ kind: p.id, kindLabel: p.short, name, dist, over, area: jg.getArea() });
          const of = fmt3857.readFeature({ type: 'Feature', geometry: g5, properties: {} }, { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
          of.set('kind', p.id); of.set('name', name);
          App.src.prot.addFeature(of);
        });
      }
      rows.sort((a, b) => a.dist - b.dist);
      msg.textContent = (rows.length ? `완료: 반경 ${fmt(radius / 1000)}km 안에 ${rows.length}곳 (사업지구 경계 기준 최근접 거리)` : `반경 ${fmt(radius / 1000)}km 안에 해당 보호구역이 없습니다.`) + ` · 자료: ${srcs.join(', ')}`;
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
    t.innerHTML = '<tr><th>명칭</th><th>최근접 거리(km)</th><th>중첩(㎡)</th></tr>' + rows.map(r =>
      `<tr><td style="text-align:left" title="${r.kindLabel}">${r.name}</td><td>${(r.dist / 1000).toFixed(1)}</td>` +
      `<td>${r.over > 0 ? `<b class="ok-blue">${fmt(r.over)}</b>` : '-'}</td></tr>`).join('');
  }
  App.protRows = () => rows;

  // ------------------------------------------------------------ UI
  function build() {
    App.opts.protOn = App.opts.protOn || {};
    App.opts.protShow = App.opts.protShow || {};
    $('#protList').innerHTML = PROT.map(p => `
      <label class="prot-item"><input type="checkbox" data-prot="${p.id}" ${App.opts.protOn[p.id] !== false ? 'checked' : ''}>
        <span class="swatch" style="border-color:${p.color};background:${hexA(p.color, 0.18)}"></span>
        <span><b>${p.label}</b><br><small>${p.note}</small></span></label>`).join('');
    $('#protRadius').value = App.opts.protRadius || 5;
    $('#protLabelChk').checked = App.opts.protLabel !== false;
    $('#protList').addEventListener('change', e => {
      const id = e.target.dataset.prot; if (!id) return;
      App.opts.protOn[id] = e.target.checked; App.opts.protShow[id] = e.target.checked; App.saveOpts();
      App.liveSets.forEach(s => s.changed()); App.emit();
    });
    $('#protLabelChk').addEventListener('change', e => { App.opts.protLabel = e.target.checked; App.saveOpts(); cache.clear(); App.liveSets.forEach(s => s.changed()); App.emit(); });
    $('#btnProt').addEventListener('click', run);
  }
  // 범례용: 지도에 실제로 표시된 보호구역 종류
  App.protLegend = () => PROT.filter(p => (App.opts.protShow || {})[p.id] !== false && App.src.prot.getFeatures().some(f => f.get('kind') === p.id));

  // App.init(설정 불러오기) 이후에 UI 구성
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
