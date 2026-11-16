/* 유하방향 화살표: 출력 미리보기에서 직접 놓고, 끌어 옮기고, 회전·크기 조절 (자동 판단 없음, 확인한 방향만).
 * 도면 주제(대상지역 설정도·측정지점 위치도·생태자연도 등)마다 따로 저장. 위치는 지도 좌표라 지도를 옮겨도 하천 위에 그대로. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const list = () => { const o = App.opts.flow = App.opts.flow || {}; return (o[App.theme] = o[App.theme] || []); };
  let selIdx = null;
  const save = () => { App.saveOpts(); sync(); App.liveSets.forEach(s => s.changed && s.changed()); };

  // 지도 그림: 물결 모양 화살표 (파랑 + 흰 테두리). 0도 = 오른쪽(동쪽), 시계 방향으로 회전
  const IC = new Map();
  function icon(color, sel, s) {
    const key = color + (sel ? 1 : 0) + s.toFixed(3);
    let ic = IC.get(key); if (ic) return ic;
    const K = 2 * s, W = 56 * K, H = 22 * K, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), mid = H / 2, amp = 3.2 * K, x0 = 4 * K, x1 = W - 16 * K;
    const path = () => { c.beginPath(); for (let x = x0; x <= x1; x += 1) { const y = mid + Math.sin((x - x0) / (x1 - x0) * Math.PI * 2.5) * amp; if (x === x0) c.moveTo(x, y); else c.lineTo(x, y); } };
    const head = () => { c.beginPath(); c.moveTo(W - 3 * K, mid); c.lineTo(x1 - 2 * K, mid - 7 * K); c.lineTo(x1 + 1 * K, mid); c.lineTo(x1 - 2 * K, mid + 7 * K); c.closePath(); };
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (sel) { c.strokeStyle = 'rgba(255,193,7,0.9)'; c.lineWidth = 9 * K; path(); c.stroke(); head(); c.stroke(); }
    c.strokeStyle = '#fff'; c.lineWidth = 5.5 * K; path(); c.stroke(); head(); c.lineWidth = 3 * K; c.stroke(); c.fillStyle = '#fff'; c.fill();
    c.strokeStyle = color; c.lineWidth = 2.6 * K; path(); c.stroke(); head(); c.fillStyle = color; c.fill();
    ic = { img: cv, size: [W, H], K };
    if (IC.size > 60) IC.clear(); IC.set(key, ic); return ic;
  }
  App.flowStyle = function (f, s) {
    if (f.get('theme') !== App.theme) return null;
    const a = list()[f.get('idx')]; if (!a) return null;
    const ic = icon(a.color || '#1E5BFF', f.get('idx') === selIdx && App.layout && App.layout.isActive && App.layout.isActive(), s);
    return new ol.style.Style({ image: new ol.style.Icon({ img: ic.img, imgSize: ic.size, scale: (Number(a.size) || 100) / 100 / ic.K * s, rotation: (Number(a.rot) || 0) * Math.PI / 180, rotateWithView: false }) });
  };
  function draw() {
    App.src.flow.clear();
    list().forEach((a, i) => { const f = new ol.Feature(new ol.geom.Point(a.c)); f.set('theme', App.theme); f.set('idx', i); App.src.flow.addFeature(f); });
  }

  // 미리보기에서 누른 곳 근처의 화살표 (픽셀 기준)
  App.flowHit = function (map, px, ppm) {
    let best = null, bd = 1e9;
    list().forEach((a, i) => { const q = map.getPixelFromCoordinate(a.c); if (!q) return; const d = Math.hypot(q[0] - px[0], q[1] - px[1]), r = 14 * (Number(a.size) || 100) / 100 * (ppm / (96 / 25.4)); if (d < Math.max(10, r) && d < bd) { bd = d; best = i; } });
    return best;
  };
  App.flowMove = function (i, coord) { const a = list()[i]; if (!a) return; a.c = coord; draw(); App.liveSets.forEach(s => s.changed && s.changed()); };
  App.flowDone = function () { App.saveOpts(); };
  App.flowSelect = function (i) { selIdx = i; sync(); App.liveSets.forEach(s => s.changed && s.changed()); };

  // 요소 상자 UI
  function sync() {
    draw();
    const box = $('#flowBox'); if (!box) return;
    const wasOpen = box.querySelector('details') && box.querySelector('details').open;
    const a = list();
    box.innerHTML = `<details class="el-box" ${wasOpen || selIdx != null ? 'open' : ''}><summary>유하방향 화살표 <small class="sub">${a.length ? a.length + '개' : ''}</small></summary><div class="el-body">
      <ul class="bullets full"><li>추가하면 지도 가운데에 놓입니다. 끌어서 하천 위로 옮기세요</li><li>방향은 직접 확인한 뒤 회전으로 맞춥니다 (0° = 오른쪽)</li></ul>
      <div class="row full"><button type="button" class="btn small" data-fadd="1">+ 화살표 추가</button></div>
      ${a.map((x, i) => `<div class="fl-row full ${i === selIdx ? 'sel' : ''}" data-fi="${i}">
        <b class="fl-no">${i + 1}</b>
        <div class="stepper"><span class="lbl">회전</span><button type="button" data-frot="${i}" data-step="-15">↺</button><input type="number" step="5" data-fi2="${i}" data-ff="rot" value="${Math.round(Number(x.rot) || 0)}"><button type="button" data-frot="${i}" data-step="15">↻</button></div>
        <label class="unit-input fl-size"><input type="number" min="20" max="400" step="10" data-fi2="${i}" data-ff="size" value="${Number(x.size) || 100}"><span class="unit">%</span></label>
        <input type="color" data-fi2="${i}" data-ff="color" value="${x.color || '#1E5BFF'}" title="색">
        <button type="button" class="btn small" data-fdel="${i}" title="빼기">×</button></div>`).join('')}
    </div></details>`;
  }
  App.flowSync = sync;
  function init() {
    const box = $('#flowBox'); if (!box) return;
    box.addEventListener('click', e => {
      if (e.target.closest('[data-fadd]')) {
        const v = App.layout && App.layout.getView && App.layout.getView();
        const c = v ? v.getCenter() : App.workMap.getView().getCenter();
        list().push({ c: c.slice(), rot: 0, size: 100, color: '#1E5BFF' }); selIdx = list().length - 1; save(); return;
      }
      const r = e.target.closest('[data-frot]'); if (r) { const a = list()[+r.dataset.frot]; a.rot = (((Number(a.rot) || 0) + Number(r.dataset.step) * (e.shiftKey ? 1 / 15 : 1)) % 360 + 360) % 360; selIdx = +r.dataset.frot; save(); return; }
      const d = e.target.closest('[data-fdel]'); if (d) { list().splice(+d.dataset.fdel, 1); selIdx = null; save(); return; }
      const row = e.target.closest('[data-fi]'); if (row && e.target.tagName !== 'INPUT') { selIdx = +row.dataset.fi; save(); }
    });
    box.addEventListener('input', e => { const t = e.target; if (t.dataset.fi2 == null) return; const a = list()[+t.dataset.fi2]; a[t.dataset.ff] = t.dataset.ff === 'color' ? t.value : Number(t.value) || 0; selIdx = +t.dataset.fi2; App.saveOpts(); draw(); App.liveSets.forEach(s => s.changed && s.changed()); });
    App.listeners.push(() => { if (box._theme !== App.theme) { box._theme = App.theme; selIdx = null; sync(); } });
    sync();
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); init(); };
})();
