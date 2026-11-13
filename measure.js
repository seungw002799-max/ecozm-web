/* 거리 재기 (작업 지도): 점을 찍어 가며 구간·누적 거리를 보여 준다. 두 번 누르면 끝.
 * 여러 번 잴 수 있고 '지우기'로 모두 삭제. 거리는 실제 지표 거리(측지 거리).
 * app.js 다음에 로드. */
(function () {
  'use strict';
  const src = new ol.source.Vector();
  const fmtM = m => m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(m < 10000 ? 3 : 2)} km`;
  const len = (a, b) => ol.sphere.getLength(new ol.geom.LineString([a, b]), { projection: 'EPSG:3857' });
  const lineStyle = new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#E91E63', width: 2.5, lineDash: [8, 5] }) });
  const halo = new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#fff', width: 5 }) });
  const dot = new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({ color: '#E91E63' }), stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 }) });
  const text = (t, offY) => new ol.style.Text({ text: t, font: 'bold 12px "Malgun Gothic",sans-serif', offsetY: offY || -12,
    fill: new ol.style.Fill({ color: '#111' }), stroke: new ol.style.Stroke({ color: '#fff', width: 4 }), overflow: true });
  // 선 + 꼭짓점 + 구간 거리 + 누적 거리
  function measureStyle(f) {
    const c = f.getGeometry().getCoordinates(); if (c.length < 1) return null;
    const out = [halo, lineStyle];
    let acc = 0;
    c.forEach((p, i) => {
      if (i > 0) {
        const d = len(c[i - 1], p); acc += d;
        if (c.length > 2) out.push(new ol.style.Style({ geometry: new ol.geom.Point([(c[i - 1][0] + p[0]) / 2, (c[i - 1][1] + p[1]) / 2]), text: text(fmtM(d), -10) }));
      }
      out.push(new ol.style.Style({ geometry: new ol.geom.Point(p), image: dot }));
    });
    if (c.length > 1) out.push(new ol.style.Style({ geometry: new ol.geom.Point(c[c.length - 1]), text: text((c.length > 2 ? '합계 ' : '') + fmtM(acc), 16) }));
    return out;
  }
  const layer = new ol.layer.Vector({ source: src, style: measureStyle, zIndex: 50 });
  let draw = null;

  function stop() {
    if (draw) { App.workMap.removeInteraction(draw); draw = null; }
    const b = document.getElementById('btnMeasure'); if (b) b.classList.remove('on');
  }
  function start() {
    stop();
    draw = new ol.interaction.Draw({ source: src, type: 'LineString', style: f => (f.getGeometry().getType() === 'LineString' ? measureStyle(f) : new ol.style.Style({ image: dot })) });
    App.workMap.addInteraction(draw);
    document.getElementById('btnMeasure').classList.add('on');
    App.toast && App.toast('지도에 점을 찍어 거리를 재세요. 두 번 누르면 끝납니다 (Esc: 취소).', 'ok');
  }
  function build() {
    App.workMap.addLayer(layer);
    const box = document.createElement('div');
    box.className = 'measure-ctl ol-unselectable ol-control';
    box.innerHTML = '<button type="button" id="btnMeasure" title="거리 재기">거리</button><button type="button" id="btnMeasureClear" title="잰 거리 지우기">지우기</button>';
    App.workMap.addControl(new ol.control.Control({ element: box }));
    document.getElementById('btnMeasure').addEventListener('click', () => (draw ? stop() : start()));
    document.getElementById('btnMeasureClear').addEventListener('click', () => { src.clear(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && draw) { draw.abortDrawing(); stop(); } });
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
