/* 국토환경성평가지도 탭: ECVAM 오픈API(WMS 타일)를 지도에 표시하고, 사업지구 안의 등급별(1~5등급) 면적을
 * 타일 픽셀 색으로 집계한다. 타일은 Cloudflare 중계 서버를 거쳐 받아 캔버스로 읽는다. app.js 다음에 로드. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const PROXY = 'https://ecozm-proxy.seungw002799.workers.dev/?url=';
  const DEFAULT_KEY = 'CN9E-RM9Q-ITDJ-1ID6';   // 2026-11-11 승인, 등록 URL https://seungw002799-max.github.io
  const LAYERS = [
    { id: 'ecvam', label: '국토환경성평가지도 (종합)' },
    { id: 'nem_law', label: '법제적 평가결과' },
    { id: 'nem_eco', label: '환경·생태적 평가결과' },
  ];
  // 등급 색 (ECVAM 범례)
  const GRADES = [
    { key: '1', label: '1등급', rgb: [51, 102, 0] },
    { key: '2', label: '2등급', rgb: [153, 204, 0] },
    { key: '3', label: '3등급', rgb: [204, 204, 0] },
    { key: '4', label: '4등급', rgb: [204, 153, 0] },
    { key: '5', label: '5등급', rgb: [204, 0, 0] },
  ];
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  App.ECVAM_GRADES = GRADES.map(g => ({ key: g.key, label: g.label, color: hex(g.rgb) }));
  const R = 20037508.342789244;
  const tileBBox = (z, x, y) => { const s = 2 * R / 2 ** z; return [-R + x * s, R - (y + 1) * s, -R + (x + 1) * s, R - y * s]; };
  const key = () => (App.cfg && App.cfg.ecvamKey) || DEFAULT_KEY;
  const layerId = () => App.opts.ecvamLayer || 'ecvam';
  function wmsUrl(lid, b) {
    return 'https://ecvam.neins.go.kr/apicall.do?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true' +
      `&LAYERS=${lid}&APIKEY=${key()}&DOMAIN=${encodeURIComponent(location.origin)}&SRS=EPSG%3A900913&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&STYLES=&BBOX=${b.join(',')}`;
  }
  const tileUrl = (lid, z, x, y) => PROXY + encodeURIComponent(wmsUrl(lid, tileBBox(z, x, y)));

  // 지도 레이어 소스 (app.js 의 createLayerSet 가 사용)
  const srcCache = {};
  App.ecvamSource = function () {
    const lid = layerId();
    if (!srcCache[lid]) {
      srcCache[lid] = new ol.source.XYZ({
        crossOrigin: 'anonymous', maxZoom: 19, minZoom: 6,
        tileUrlFunction: c => tileUrl(lid, c[0], c[1], c[2]),
      });
      srcCache[lid].__lid = lid;
    }
    return srcCache[lid];
  };

  // ------------------------------------------------------------ 등급별 면적 (픽셀 집계)
  let result = null;
  App.ecvamResult = () => result;
  App.setEcvamResult = r => { result = r || null; try { render(); } catch (e) { /* 무시 */ } };
  function nearestGrade(r, g, b) {
    let best = null, bd = 1e9;
    GRADES.forEach(G => { const d = (G.rgb[0] - r) ** 2 + (G.rgb[1] - g) ** 2 + (G.rgb[2] - b) ** 2; if (d < bd) { bd = d; best = G.key; } });
    return bd < 2500 ? best : null;   // 안티앨리어싱 등 애매한 색은 제외
  }
  function loadImg1(url) {
    return new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; const tm = setTimeout(() => no(new Error('시간 초과')), 25000); i.onload = () => { clearTimeout(tm); ok(i); }; i.onerror = () => { clearTimeout(tm); no(new Error('타일 실패')); }; i.src = url; });
  }
  async function loadImg(url) {   // 3번까지 재시도
    for (let a = 0; a < 3; a++) { try { return await loadImg1(url + (a ? '&_r=' + a : '')); } catch (e) { if (a === 2) throw e; } }
  }

  async function calc() {
    const msg = $('#ecvamMsg'), btn = $('#btnEcvam');
    const sites = App.sites.filter(s => s.geometry);
    if (!sites.length) { App.toast && App.toast('먼저 도면을 추가하세요.', 'warn'); return; }
    btn.disabled = true; msg.hidden = false; msg.textContent = '타일 준비 중...';
    try {
      const gj = new ol.format.GeoJSON();
      const lid = layerId();
      const cats = {};
      sites.forEach(s => { (cats[s.category] = cats[s.category] || []).push(s); });
      const rows = [];
      let used = 0, failedAll = 0;
      for (const [cat, list] of Object.entries(cats)) {
        // 구분별 합친 도형 (5186) -> 정확한 면적, 3857 도형 -> 픽셀 마스크
        const rd = new jsts.io.GeoJSONReader();
        let u = rd.read(list[0].geometry); for (let i = 1; i < list.length; i++) u = u.union(rd.read(list[i].geometry));
        const exact = u.getArea();
        const g3857 = gj.readGeometry(new jsts.io.GeoJSONWriter().write(u), { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' });
        const ext = g3857.getExtent();
        // 줌: 타일 수 200장 이하에서 가장 세밀하게 (최대 18)
        let z = 17;
        const count = zz => { const s = 2 * R / 2 ** zz; return (Math.floor((ext[2] + R) / s) - Math.floor((ext[0] + R) / s) + 1) * (Math.floor((R - ext[1]) / s) - Math.floor((R - ext[3]) / s) + 1); };
        while (z > 8 && count(z) > 120) z--;
        const s = 2 * R / 2 ** z;
        const x0 = Math.floor((ext[0] + R) / s), x1 = Math.floor((ext[2] + R) / s), y0 = Math.floor((R - ext[3]) / s), y1 = Math.floor((R - ext[1]) / s);
        const tiles = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
        const cnt = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }; let none = 0, inside = 0;
        let failed = 0;
        const polys = g3857.getType() === 'MultiPolygon' ? g3857.getCoordinates() : [g3857.getCoordinates()];
        let done = 0;
        const work = async ([x, y]) => {
          const cv = document.createElement('canvas'); cv.width = cv.height = 256; const ctx = cv.getContext('2d', { willReadFrequently: true });
          const mk = document.createElement('canvas'); mk.width = mk.height = 256; const mctx = mk.getContext('2d', { willReadFrequently: true });
          const b = tileBBox(z, x, y), px = (b[2] - b[0]) / 256;
          // 마스크
          mctx.clearRect(0, 0, 256, 256); mctx.fillStyle = '#000'; mctx.beginPath();
          polys.forEach(rings => rings.forEach(ring => ring.forEach((c, i) => { const X = (c[0] - b[0]) / px, Y = (b[3] - c[1]) / px; i ? mctx.lineTo(X, Y) : mctx.moveTo(X, Y); })));
          mctx.fill('evenodd');
          const m = mctx.getImageData(0, 0, 256, 256).data;
          let any = false; for (let i = 3; i < m.length; i += 4) if (m[i] > 127) { any = true; break; }
          if (!any) return;
          let img; try { img = await loadImg(tileUrl(lid, z, x, y)); } catch (e) { img = null; failed++; }
          ctx.clearRect(0, 0, 256, 256); if (img) ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, 256, 256).data;
          for (let i = 0; i < d.length; i += 4) {
            if (m[i + 3] <= 127) continue;
            inside++;
            const k = d[i + 3] > 127 ? nearestGrade(d[i], d[i + 1], d[i + 2]) : null;
            if (k) cnt[k]++; else none++;
          }
        };
        // 6장씩 동시에
        let qi = 0;
        await Promise.all(Array.from({ length: 6 }, async () => { while (qi < tiles.length) { const t = tiles[qi++]; await work(t); done++; msg.textContent = `${cat}: 타일 ${done}/${tiles.length}`; } }));
        failedAll += failed;
        used += tiles.length;
        // 픽셀 수 비율 x 정확한 면적
        const areas = {}; GRADES.forEach(G => { areas[G.key] = inside ? exact * cnt[G.key] / inside : 0; });
        rows.push({ category: cat, total: exact, areas, noData: inside ? exact * none / inside : 0, zoom: z, px: Math.round(s / 256 * Math.cos(ol.proj.toLonLat(ol.extent.getCenter(ext))[1] * Math.PI / 180) * 100) / 100 });
      }
      const order = (App.CATS || []).concat(Object.keys(cats));
      rows.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
      result = { rows, layer: lid, layerLabel: (LAYERS.find(l => l.id === lid) || {}).label };
      msg.textContent = `완료: ${result.layerLabel} · 타일 ${used}장 · 해상도 약 ${rows.map(r => r.px).join('/')}m/픽셀` + (failedAll ? ` · 받지 못한 타일 ${failedAll}장(자료 없음으로 집계, 다시 계산해 보세요)` : '');
    } catch (e) {
      msg.textContent = '계산 실패: ' + e.message;
    } finally {
      btn.disabled = false; render(); App.emit();
    }
  }

  const fmtA = v => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function render() {
    const t = $('#ecvamTable');
    if (!result) { t.hidden = true; return; }
    t.hidden = false;
    let h = '<tr><th>등급</th><th>면적(㎡)</th><th>비율(%)</th></tr>';
    result.rows.forEach(r => {
      h += `<tr class="cat-head"><td colspan="3">${r.category}</td></tr>`;
      GRADES.forEach(G => { const v = r.areas[G.key]; h += `<tr><td class="cat"><span class="sw" style="background:${hex(G.rgb)}"></span>${G.label}</td><td>${fmtA(v)}</td><td>${fmtA(r.total ? v / r.total * 100 : 0)}</td></tr>`; });
      if (r.noData > 0.5) h += `<tr><td class="cat">자료 없음</td><td>${fmtA(r.noData)}</td><td>${fmtA(r.noData / r.total * 100)}</td></tr>`;
      h += `<tr class="sum"><td class="cat">계</td><td>${fmtA(r.total)}</td><td>100.00</td></tr>`;
    });
    t.innerHTML = h;
  }

  function build() {
    $('#ecvamLayerSel').innerHTML = LAYERS.map(l => `<option value="${l.id}">${l.label}</option>`).join('');
    $('#ecvamLayerSel').value = layerId();
    $('#ecvamLayerSel').addEventListener('change', e => { App.opts.ecvamLayer = e.target.value; App.saveOpts(); result = null; render(); App.liveSets.forEach(s => { s.refresh(); s.changed(); }); App.emit(); });
    $('#ecvamLegend').innerHTML = GRADES.map(G => `<span class="lg"><span class="sw" style="background:${hex(G.rgb)}"></span>${G.label}</span>`).join('');
    $('#btnEcvam').addEventListener('click', calc);
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
