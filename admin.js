/* 시군구 경계 (브이월드 2D데이터 API, LT_C_ADSIGG_INFO)
 * 도면 탭 / 도면 출력 탭의 '시군구 경계 표시' 로 켜고 끈다. 모든 도면 주제에 함께 그려진다.
 * prot.js 다음, app2.js 앞에 로드. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const gjf = new ol.format.GeoJSON();
  const PAD = 30000;            // 사업지구 범위 + 30km 를 받는다
  let loadedKey = null, loading = false;

  App.admLook = () => {
    const c = App.opts.admCustom || {};
    return { color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#5A5A5A', pt: Number(c.pt) || 10, name: c.name || '시군구 경계' };
  };

  const cache = new Map();
  App.admStyle = function (f, s, set) {
    if (!App.opts.adm) return null;
    const lk = App.admLook();
    const key = lk.color + '|' + s.toFixed(3);
    let st = cache.get(key);
    if (!st) {
      st = new ol.style.Style({ stroke: new ol.style.Stroke({ color: lk.color, width: Math.max(0.8, 1.6 * s), lineDash: [10 * s, 3 * s, 2 * s, 3 * s] }) });
      if (cache.size > 200) cache.clear();
      cache.set(key, st);
    }
    if (App.opts.admLabel === false) return st;
    const lp = App.protLabelPoint ? App.protLabelPoint(f, set) : null;
    if (!lp) return st;
    const custom = (App.opts.protLabelText || {})['adm|' + f.get('name')];
    return [st, new ol.style.Style({ geometry: new ol.geom.Point(lp), text: new ol.style.Text({
      text: custom != null && custom !== '' ? custom : f.get('name'),
      font: `bold ${Math.round(lk.pt * 0.3528 * App.PX_PER_MM96 * s * 10) / 10}px "EcoFont","Malgun Gothic",sans-serif`,
      fill: new ol.style.Fill({ color: lk.color }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 * s }), overflow: true }) })];
  };

  function wantedBox() {
    const bs = App.sites.filter(s => s.bbox).map(s => s.bbox);
    if (!bs.length) return null;
    const b = [Math.min(...bs.map(x => x[0])) - PAD, Math.min(...bs.map(x => x[1])) - PAD,
      Math.max(...bs.map(x => x[2])) + PAD, Math.max(...bs.map(x => x[3])) + PAD];
    return b.map(v => Math.round(v / 1000) * 1000);
  }

  async function load() {
    if (!App.opts.adm || loading) return;
    const b = wantedBox();
    const msg = $('#admMsg');
    if (!b) { if (msg) { msg.hidden = false; msg.textContent = '도면을 먼저 추가하면 주변 시군구 경계를 불러옵니다.'; } return; }
    const k = b.join(',');
    if (k === loadedKey) return;
    if (!App.cfg.vworldKey) { if (msg) { msg.hidden = false; msg.textContent = '브이월드 인증키가 없습니다.'; } return; }
    if (!App.jsonp) return;
    loading = true;
    if (msg) { msg.hidden = false; msg.textContent = '시군구 경계를 받는 중...'; }
    try {
      const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(p => proj4('EPSG:5186', 'EPSG:4326', p));
      const bb = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
      const feats = [];
      for (let page = 1; page <= 10; page++) {
        const u = 'https://api.vworld.kr/req/data?service=data&request=GetFeature&format=json&crs=EPSG:4326&geometry=true&attribute=true&size=1000' +
          `&page=${page}&data=LT_C_ADSIGG_INFO&key=${App.cfg.vworldKey}&domain=${encodeURIComponent(location.origin)}&geomFilter=BOX(${bb.join(',')})`;
        const j = await App.jsonp(u);
        const r = j.response || {};
        if (r.status === 'NOT_FOUND') break;
        if (r.status !== 'OK') throw new Error((r.error && r.error.text) || r.status);
        const fs = (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
        fs.forEach(f => feats.push(f));
        if (feats.length >= (Number(r.record && r.record.total) || 0) || !fs.length) break;
      }
      App.src.admin.clear();
      feats.forEach(f => {
        if (!f.geometry) return;
        const of = gjf.readFeature({ type: 'Feature', geometry: f.geometry, properties: {} }, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
        of.set('name', (f.properties || {}).sig_kor_nm || '');
        of.set('kind', 'adm');
        App.src.admin.addFeature(of);
      });
      loadedKey = k;
      if (msg) { msg.textContent = `시군구 ${feats.length}곳 표시 (브이월드 2D데이터 API, 실시간)`; }
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = '시군구 경계를 받지 못했습니다: ' + (e.message || e); }
    } finally {
      loading = false;
      App.liveSets.forEach(s => s.changed && s.changed()); App.emit();
    }
  }
  App.loadAdmin = load;

  function sync() {
    ['#admChk', '#admChk2'].forEach(id => { const c = $(id); if (c) c.checked = !!App.opts.adm; });
  }
  function build() {
    // 시군구 경계는 다른 자료로 바꿀 예정이라 잠시 끔 (체크칸 숨김)
    if (App.opts.adm) { App.opts.adm = false; App.saveOpts(); }
    App.src.admin.clear();
    ['#admChk', '#admChk2'].forEach(id => {
      const c = $(id); if (!c) return;
      c.addEventListener('change', e => {
        App.opts.adm = e.target.checked; App.saveOpts(); sync();
        if (App.opts.adm) load();
        App.liveSets.forEach(s => s.changed && s.changed()); App.emit();
      });
    });
    sync();
    // 도면이 바뀌면 (범위가 달라지면) 다시 받기
    App.listeners.push(() => { if (App.opts.adm) { const b = wantedBox(); if (b && b.join(',') !== loadedKey) load(); } });
    if (App.opts.adm) setTimeout(load, 1500);
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
