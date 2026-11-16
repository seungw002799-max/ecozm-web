/* 초기 입지 검토: 도면 없이 지도에 점을 찍거나 주소를 검색해, 반경 안의 레이어(레이어 모음 선택 항목)를 조회
 * 반경 원(예: 1·3·5km)을 지도와 도면 출력에 함께 표시. prot.js 다음에 로드. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  let pt = null;          // EPSG:3857
  let region = null;      // 시군구·시도 선택 시 { name, g5 (jsts EPSG:5186), gj (GeoJSON 5186) }
  const rd = new jsts.io.GeoJSONReader(), wr = new jsts.io.GeoJSONWriter(), f3857 = new ol.format.GeoJSON();
  const g3857 = g => f3857.readGeometry(wr.write(g), { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
  // 시군구 경계 등을 불러올 범위 (admin2.js)
  App.pickBox = () => { if (App.curTab !== 'pick') return null; const r = Math.max(...radii(), 1) * 1000; if (region) { const e = region.g5.getEnvelopeInternal(); return [e.getMinX() - r, e.getMinY() - r, e.getMaxX() + r, e.getMaxY() + r]; } if (!pt) return null; const p = proj4('EPSG:4326', 'EPSG:5186', ol.proj.toLonLat(pt)); return [p[0] - r, p[1] - r, p[0] + r, p[1] + r]; };
  let picking = false;

  const radii = () => String(($('#pickRadii') || {}).value || '1,3,5').split(/[,\s]+/).map(Number).filter(v => v > 0).sort((a, b) => a - b).slice(0, 6);
  const fmtR = km => km < 1 ? Math.round(km * 1000) + 'm' : (Math.round(km * 10) / 10) + 'km';

  // 지도 그림: 반경 원(검은 선 + 흰 테두리) + 원 위 거리 상자 + 검토 지점 표시
  App.pickStyle = function (f, s) {
    if (f.get('pk') === 'mask') return App.theme === 'prot' ? new ol.style.Style({ fill: new ol.style.Fill({ color: `rgba(255,255,255,${App.opts.pickMaskA == null ? 0.55 : Number(App.opts.pickMaskA)})` }) }) : null;
    if (f.get('pk') === 'region') return App.theme === 'prot' ? [new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#fff', width: 4.5 * s }) }), new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#E91E63', width: 2.2 * s }) })] : null;   // 고른 행정구역 경계는 항상
    if (App.theme !== 'prot') return null;
    if (f.get('src') === 'prot' ? App.opts.protRingShow === false : App.opts.pickShow === false) return null;   // 레이어 모음 검토 반경 / 초기 입지 검토 반경
    const k = f.get('pk');
    if (f.get('src') !== 'prot' && k === 'ring' && (App.opts.pickHide || {})[f.get('km')]) return null;   // 반경별 끄기
    if (k === 'pt') return new ol.style.Style({ image: new ol.style.RegularShape({ points: 4, radius: 9 * s, radius2: 0, angle: Math.PI / 4, stroke: new ol.style.Stroke({ color: '#E91E63', width: 3 * s }) }) });
    const g = f.getGeometry(), ex = g.getExtent();
    const top = [(ex[0] + ex[2]) / 2 - (ex[2] - ex[0]) * 0.18, ex[1] + (ex[3] - ex[1]) * 0.948];
    return [
      new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#fff', width: 4 * s }) }),
      new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#111', width: 1.8 * s }) }),
      new ol.style.Style({ geometry: new ol.geom.Point(top), text: new ol.style.Text({ text: f.get('label'), font: `bold ${Math.round(12 * s)}px "EcoFont","Malgun Gothic",sans-serif`,
        fill: new ol.style.Fill({ color: '#111' }), backgroundFill: new ol.style.Fill({ color: '#fff' }), backgroundStroke: new ol.style.Stroke({ color: '#111', width: 1.2 * s }), padding: [2 * s, 4 * s, 1 * s, 4 * s] }) }),
    ];
  };

  function draw() {
    App.src.pick.getFeatures().filter(f => f.get('src') !== 'prot').forEach(f => App.src.pick.removeFeature(f));
    renderRingChecks();
    // 선택 범위 밖을 흰색 반투명으로 덮어 선택 범위가 잘 보이게 (행정구역: 경계 밖 / 지점: 가장 큰 반경 밖)
    if (App.opts.pickMask !== false && (region || pt)) {
      try {
        const inner = region ? region.g5 : (p5 => new jsts.geom.GeometryFactory().createPoint(new jsts.geom.Coordinate(p5[0], p5[1])).buffer(Math.max(...radii(), 1) * 1000, 32))(proj4('EPSG:4326', 'EPSG:5186', ol.proj.toLonLat(pt)));
        const e = inner.getEnvelopeInternal(), m = 300000, gf = new jsts.geom.GeometryFactory();
        const big = gf.toGeometry(new jsts.geom.Envelope(e.getMinX() - m, e.getMaxX() + m, e.getMinY() - m, e.getMaxY() + m));
        const fm = new ol.Feature(g3857(big.difference(inner))); fm.set('pk', 'mask'); App.src.pick.addFeature(fm);
      } catch (err) { /* 덮개 생략 */ }
    }
    if (region) {
      const fr = new ol.Feature(g3857(region.g5)); fr.set('pk', 'region'); App.src.pick.addFeature(fr);
      radii().forEach(km => { let b; try { b = region.g5.buffer(km * 1000, 16); } catch (e) { return; } const f = new ol.Feature(g3857(b)); f.set('pk', 'ring'); f.set('km', String(km)); f.set('label', fmtR(km)); App.src.pick.addFeature(f); });
    } else if (pt) {
      const lonlat = ol.proj.toLonLat(pt);
      const f0 = new ol.Feature(new ol.geom.Point(pt)); f0.set('pk', 'pt'); App.src.pick.addFeature(f0);
      radii().forEach(km => {
        const c = ol.geom.Polygon.circular(lonlat, km * 1000, 128).transform('EPSG:4326', 'EPSG:3857');
        const f = new ol.Feature(c); f.set('pk', 'ring'); f.set('km', String(km)); f.set('label', fmtR(km)); App.src.pick.addFeature(f);
      });
    }
    if (App.loadAdmin && App.opts.adm) App.loadAdmin();
    App.liveSets.forEach(s => s.changed && s.changed()); App.emit();
  }
  // 반경별 표시 체크 (1km, 3km ...)
  function renderRingChecks() {
    const box = $('#pickRingChecks'); if (!box) return; const hide = App.opts.pickHide || {};
    box.innerHTML = radii().map(km => `<label class="check"><input type="checkbox" data-pkm="${km}" ${hide[String(km)] ? '' : 'checked'}> ${fmtR(km)}</label>`).join('');
  }
  async function pickRegion(it) {
    const out = $('#pickResults');
    try {
      const u = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=${it.data}&key=${App.cfg.vworldKey}&domain=${encodeURIComponent(location.origin)}&format=json&size=5&page=1&geometry=true&attribute=true&crs=EPSG:4326&attrFilter=${encodeURIComponent(it.codeAttr + ':=:' + it.code)}`;
      const j = await App.jsonp(u), f = j.response && j.response.result && j.response.result.featureCollection.features[0];
      if (!f) throw new Error('경계를 받지 못했습니다');
      const tr = c => (typeof c[0] === 'number' ? proj4('EPSG:4326', 'EPSG:5186', [c[0], c[1]]) : c.map(tr));
      let g = rd.read({ type: f.geometry.type, coordinates: tr(f.geometry.coordinates) });
      g = jsts.simplify.DouglasPeuckerSimplifier.simplify(g, 10); if (!g.isValid()) g = g.buffer(0);   // 10m 단위로 단순화 (조회 속도)
      region = { name: it.title, g5: g, gj: wr.write(g) }; pt = null;
      const e = g.getEnvelopeInternal();
      $('#pickCoord').innerHTML = `<b>${it.title}</b> 전체<br><small>행정구역 경계 기준 (반경은 경계에서 바깥으로)</small>`;
      draw(); out.hidden = true;
      App.workMap.getView().fit(g3857(g.buffer(Math.max(...radii(), 1) * 1000)).getExtent(), { duration: 300, padding: [30, 30, 30, 30] });
    } catch (e) { App.toast(e.message, 'warn'); }
  }
  function setPoint(p, zoom) {
    pt = p; region = null;
    const ll = ol.proj.toLonLat(p), p5 = proj4('EPSG:4326', 'EPSG:5186', ll);
    $('#pickCoord').innerHTML = `위도 ${ll[1].toFixed(5)} · 경도 ${ll[0].toFixed(5)}<br><small>EPSG:5186 X ${p5[0].toFixed(1)} · Y ${p5[1].toFixed(1)}</small>`;
    draw();
    if (zoom) { const r = Math.max(...radii(), 1) * 1000; App.workMap.getView().fit(ol.extent.buffer(ol.extent.boundingExtent([p]), r * 1.25 / Math.cos(ll[1] * Math.PI / 180)), { duration: 300 }); }
  }
  function togglePick(on) {
    picking = on == null ? !picking : on;
    $('#btnPickPoint').classList.toggle('on', picking);
    $('#btnPickPoint').textContent = picking ? '지도를 누르세요 (취소)' : '지도에서 위치 찍기';
    App.workMap.getTargetElement().style.cursor = picking ? 'crosshair' : '';
  }

  // 주소·지번 검색 (브이월드 검색 API)
  async function search() {
    const q = ($('#pickQuery').value || '').trim(); if (!q) return;
    const out = $('#pickResults'); out.hidden = false; out.innerHTML = '<div class="hint">검색 중...</div>';
    const items = [];
    // 시도·시군구 이름 (예: 대구광역시, 화천군, 고창군)
    const qn = q.replace(/\s+/g, '');
    if (qn.length >= 2 && !/\d/.test(qn)) {
      for (const [data, nm, cd, full] of [['LT_C_ADSIDO_INFO', 'ctp_kor_nm', 'ctprvn_cd', null], ['LT_C_ADSIGG_INFO', 'sig_kor_nm', 'sig_cd', 'full_nm']]) {
        try {
          const u = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=${data}&key=${App.cfg.vworldKey}&domain=${encodeURIComponent(location.origin)}&format=json&size=10&page=1&geometry=false&attribute=true&attrFilter=${encodeURIComponent(nm + ':like:' + qn.replace(/(시|군|구|도)$/, ''))}`;
          const j = await App.jsonp(u);
          ((j.response && j.response.result && j.response.result.featureCollection.features) || []).forEach(f => { const p = f.properties || {}; items.push({ region: true, data, codeAttr: cd, code: p[cd], title: p[nm], sub: (full ? p[full] : p[nm]) + ' · 행정구역 전체' }); });
        } catch (e) { /* 다음 */ }
      }
    }
    for (const [type, cat] of [['address', 'parcel'], ['address', 'road'], ['place', '']]) {
      const u = 'https://api.vworld.kr/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=5&page=1&format=json' +
        `&type=${type}${cat ? '&category=' + cat : ''}&query=${encodeURIComponent(q)}&key=${App.cfg.vworldKey}&domain=${encodeURIComponent(location.origin)}`;
      try {
        const j = await App.jsonp(u);
        ((j.response && j.response.result && j.response.result.items) || []).forEach(it => {
          const p = it.point || {}; const title = it.title || (it.address && (it.address.parcel || it.address.road)) || '';
          if (p.x && p.y) items.push({ title, sub: it.address ? (it.address.road || it.address.parcel || '') : (it.category || ''), x: +p.x, y: +p.y });
        });
      } catch (e) { /* 다음 방식 시도 */ }
      if (items.filter(x => !x.region).length >= 5) break;
    }
    if (!items.length) { out.innerHTML = '<div class="hint">검색 결과가 없습니다. 지번(예: 구미시 선산읍 이문리 100)이나 도로명으로 입력해 보세요.</div>'; return; }
    out.innerHTML = items.slice(0, 8).map((it, i) => `<button type="button" class="pick-item${it.region ? ' region' : ''}" data-i="${i}"><b>${it.region ? '▣ ' : ''}${it.title}</b>${it.sub && it.sub !== it.title ? `<small>${it.sub}</small>` : ''}</button>`).join('');
    out.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[+b.dataset.i]; if (it.region) { pickRegion(it); return; } setPoint(ol.proj.fromLonLat([it.x, it.y]), true); out.hidden = true; };
  }

  async function runCheck() {
    if (!pt && !region) { App.toast && App.toast('먼저 검토 위치를 정하세요.', 'warn'); return; }
    if (App.theme !== 'prot') App.setTheme('prot');
    const p5 = region ? null : proj4('EPSG:4326', 'EPSG:5186', ol.proj.toLonLat(pt));
    await App.protRunAt(p5, Math.max(...radii()), { geom: region ? region.gj : null, bbox: region ? (e => [e.getMinX(), e.getMinY(), e.getMaxX(), e.getMaxY()])(region.g5.getEnvelopeInternal()) : null, btn: $('#btnPickRun'), msg: $('#pickMsg'), onlyChosen: !!($('#pickOnlyChosen') || {}).checked });
  }

  function build() {
    App.workMap.on('singleclick', e => { if (!picking) return; togglePick(false); setPoint(e.coordinate, false); });
    $('#btnPickPoint').addEventListener('click', () => togglePick());
    $('#btnPickSearch').addEventListener('click', search);
    $('#pickQuery').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    $('#pickRadii').addEventListener('change', draw);
    $('#btnPickRun').addEventListener('click', runCheck);
    $('#btnPickClear').addEventListener('click', () => { pt = null; region = null; draw(); $('#pickCoord').textContent = '위치를 정하지 않았습니다'; });
    $('#pickShow').addEventListener('change', e => { App.opts.pickShow = e.target.checked; const p2 = $('#pickShow2'); if (p2) p2.checked = e.target.checked; App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); App.emit(); });
    $('#btnPickLayers').addEventListener('click', () => App.switchTab('prot'));
    $('#pickRingChecks').addEventListener('change', e => { const k = e.target.dataset.pkm; if (!k) return; App.opts.pickHide = App.opts.pickHide || {}; if (e.target.checked) delete App.opts.pickHide[k]; else App.opts.pickHide[k] = true; App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); App.emit(); });
    $('#pickMask').checked = App.opts.pickMask !== false; $('#pickMaskA').value = Math.round((App.opts.pickMaskA == null ? 0.55 : App.opts.pickMaskA) * 100);
    $('#pickMask').addEventListener('change', e => { App.opts.pickMask = e.target.checked; App.saveOpts(); draw(); });
    $('#pickMaskA').addEventListener('input', e => { App.opts.pickMaskA = Math.max(0, Math.min(95, Number(e.target.value) || 0)) / 100; App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); });
    $('#pickShow2').checked = App.opts.pickShow !== false; $('#pickShow').checked = App.opts.pickShow !== false;   // 두 체크 상태를 저장값과 맞춤
    $('#pickShow2').addEventListener('change', e => { App.opts.pickShow = e.target.checked; $('#pickShow').checked = e.target.checked; App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); App.emit(); });
    renderRingChecks();
    $('#pickTable').addEventListener('change', e => {
      if (e.target.dataset.show) { App.opts.protShow[e.target.dataset.show] = e.target.checked; App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); App.emit(); return; }
      const k = e.target.dataset.arrow; if (k && App.protSetArrow) { App.protSetArrow(k, e.target.checked); const a = $('#protTable'), b = $('#pickTable'); if (a && b) b.innerHTML = a.innerHTML; } });
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
