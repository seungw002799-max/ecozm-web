/* 초기 입지 검토: 도면 없이 지도에 점을 찍거나 주소를 검색해, 반경 안의 레이어(레이어 모음 선택 항목)를 조회
 * 반경 원(예: 1·3·5km)을 지도와 도면 출력에 함께 표시. prot.js 다음에 로드. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  let pt = null;          // EPSG:3857
  let picking = false;

  const radii = () => String(($('#pickRadii') || {}).value || '1,3,5').split(/[,\s]+/).map(Number).filter(v => v > 0).sort((a, b) => a - b).slice(0, 6);
  const fmtR = km => km < 1 ? Math.round(km * 1000) + 'm' : (Math.round(km * 10) / 10) + 'km';

  // 지도 그림: 반경 원(검은 선 + 흰 테두리) + 원 위 거리 상자 + 검토 지점 표시
  App.pickStyle = function (f, s) {
    if (App.theme !== 'prot' || App.opts.pickShow === false) return null;
    const k = f.get('pk');
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
    App.src.pick.clear();
    if (!pt) return;
    const lonlat = ol.proj.toLonLat(pt);
    const f0 = new ol.Feature(new ol.geom.Point(pt)); f0.set('pk', 'pt'); App.src.pick.addFeature(f0);
    radii().forEach(km => {
      // 실제 거리 원 (측지) → 웹 지도 좌표
      const c = ol.geom.Polygon.circular(lonlat, km * 1000, 128).transform('EPSG:4326', 'EPSG:3857');
      const f = new ol.Feature(c); f.set('pk', 'ring'); f.set('label', fmtR(km)); App.src.pick.addFeature(f);
    });
    App.liveSets.forEach(s => s.changed && s.changed()); App.emit();
  }
  function setPoint(p, zoom) {
    pt = p;
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
      if (items.length >= 5) break;
    }
    if (!items.length) { out.innerHTML = '<div class="hint">검색 결과가 없습니다. 지번(예: 구미시 선산읍 이문리 100)이나 도로명으로 입력해 보세요.</div>'; return; }
    out.innerHTML = items.slice(0, 8).map((it, i) => `<button type="button" class="pick-item" data-i="${i}"><b>${it.title}</b>${it.sub && it.sub !== it.title ? `<small>${it.sub}</small>` : ''}</button>`).join('');
    out.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[+b.dataset.i]; setPoint(ol.proj.fromLonLat([it.x, it.y]), true); out.hidden = true; };
  }

  async function runCheck() {
    if (!pt) { App.toast && App.toast('먼저 검토 위치를 정하세요.', 'warn'); return; }
    if (App.theme !== 'prot') App.setTheme('prot');
    const p5 = proj4('EPSG:4326', 'EPSG:5186', ol.proj.toLonLat(pt));
    await App.protRunAt(p5, Math.max(...radii()), { btn: $('#btnPickRun'), msg: $('#pickMsg') });
  }

  function build() {
    App.workMap.on('singleclick', e => { if (!picking) return; togglePick(false); setPoint(e.coordinate, false); });
    $('#btnPickPoint').addEventListener('click', () => togglePick());
    $('#btnPickSearch').addEventListener('click', search);
    $('#pickQuery').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    $('#pickRadii').addEventListener('change', draw);
    $('#btnPickRun').addEventListener('click', runCheck);
    $('#btnPickClear').addEventListener('click', () => { pt = null; draw(); $('#pickCoord').textContent = '위치를 정하지 않았습니다'; });
    $('#pickShow').addEventListener('change', e => { App.opts.pickShow = e.target.checked; App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); App.emit(); });
    $('#btnPickLayers').addEventListener('click', () => App.switchTab('prot'));
    $('#pickTable').addEventListener('change', e => { const k = e.target.dataset.arrow; if (k && App.protSetArrow) { App.protSetArrow(k, e.target.checked); const a = $('#protTable'), b = $('#pickTable'); if (a && b) b.innerHTML = a.innerHTML; } });
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
