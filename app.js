/* 생태자연도 등급별 면적 산정 도구 - 작업 탭 (app.js)
 * 도면 출력 탭은 app2.js 에 있으며 전역 App 객체를 공유한다. */
'use strict';

// ============================================================ 1. 공통 상수/유틸
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CATS = ['사업지구', '계획지구', '사업노선', '계획노선'];
const GRADE_COLOR = { '1': '#1AA800', '2': '#92D050', '3': '#FFFFFF', '9': '#FF8000' };
const GRADE_NAME = { '1': '1등급', '2': '2등급', '3': '3등급', '9': '별도관리지역' };
const EP = 'https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService';
const REF_BBOX = [314548, 401742, 320867, 409072];
const PX_PER_MM96 = 96 / 25.4; // 96dpi 기준 mm당 px
const DEFAULT_CAT_STYLE = {
  '사업지구': { color: '#FF0000', width: 3, dash: 'solid' },
  '계획지구': { color: '#0050FF', width: 3, dash: 'dashed' },
  '사업노선': { color: '#E000E0', width: 3, dash: 'solid' },
  '계획노선': { color: '#00A0E0', width: 3, dash: 'dashed' },
};

const App = {
  cfg: {},
  opts: { basemap: 'base', mode: 'both', opA: 0.6, opI: 0.6, opS: 1, opE: 0.7, opB: 1, proxy: false, rest3: true, range: 500 },
  catStyle: JSON.parse(JSON.stringify(DEFAULT_CAT_STYLE)),
  // 국토환경성평가지도 주제용 도면 선 (1~5등급 색과 겹치지 않게 검정·파랑 기본)
  catStyleE: { '사업지구': { color: '#000000', width: 3, dash: 'solid' }, '계획지구': { color: '#0033CC', width: 3, dash: 'dashed' }, '사업노선': { color: '#000000', width: 3, dash: 'solid' }, '계획노선': { color: '#0033CC', width: 3, dash: 'dashed' } },
  sites: [],
  area: null,        // /api/area 응답
  eczmCount: 0,
  fresh: null,       // 최근 자료 확인 결과
  listeners: [],     // 상태 변경 시 호출 (도면 출력 탭 갱신)
  liveSets: [],      // 화면에 떠 있는 레이어 세트
  CATS, GRADE_COLOR, GRADE_NAME, PX_PER_MM96,
  src: {
    around: new ol.source.Vector(),
    inside: new ol.source.Vector(),
    sites: new ol.source.Vector(),
    prot: new ol.source.Vector(),
    admin: new ol.source.Vector(),
    pick: new ol.source.Vector(),     // 초기 입지 검토: 검토 지점 + 반경 원 (pick.js)    // 시군구 경계 (브이월드)
    arrows: new ol.source.Vector(),   // 최근접 거리 화살표 (theme 별)     // 보호구역 검토 레이어 (prot.js)
  },
};
App.emit = () => App.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n) {
  return (Number(n) || 0).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
App.fmt = fmt;

let toastTimer = null;
function toast(msg, kind, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms !== 0) toastTimer = setTimeout(() => { t.hidden = true; }, ms || (kind === 'error' ? 9000 : 4500));
}
App.toast = toast;

async function api(path, body, raw) {
  const r = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (raw && r.ok) return r;
  let j = null;
  try { j = await r.json(); } catch (e) { /* 본문 없음 */ }
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
}

// 동시 요청 4개 제한 (슬롯을 대기자에게 직접 넘겨 초과 방지)
const sem = { n: 0, q: [] };
async function limited(fn) {
  if (sem.n >= 4) await new Promise(r => sem.q.push(r)); else sem.n++;
  try { return await fn(); } finally {
    const r = sem.q.shift();
    if (r) r(); else sem.n--;
  }
}

async function fetchJsonRetry(url, tries, ms) {
  let last = null;
  tries = tries || 3; ms = ms || 30000;
  for (let a = 0; a < tries; a++) {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      try { return JSON.parse(txt); } catch (e) { throw new Error('응답 형식 오류: ' + txt.slice(0, 120)); }
    } catch (e) {
      last = e.name === 'AbortError' ? new Error('시간 초과(' + Math.round(ms / 1000) + '초)') : e;
      await sleep(500 * (a + 1));
    } finally { clearTimeout(tm); }
  }
  throw last;
}

// ============================================================ 2. 설정 / 옵션 저장
function loadLocal() {
  try { Object.assign(App.opts, JSON.parse(localStorage.getItem('ecoOpts') || '{}')); } catch (e) { /* 무시 */ }
  if (!['base', 'white', 'sat', 'none'].includes(App.opts.basemap)) App.opts.basemap = 'base';
  App.opts.mode = 'both';
  try {
    const cs = JSON.parse(localStorage.getItem('ecoCatStyle') || '{}');
    for (const c of CATS) if (cs[c]) Object.assign(App.catStyle[c], cs[c]);
    const ce = JSON.parse(localStorage.getItem('ecoCatStyleE') || '{}');
    for (const c of CATS) if (ce[c]) Object.assign(App.catStyleE[c], ce[c]);
  } catch (e) { /* 무시 */ }
}
App.saveOpts = () => localStorage.setItem('ecoOpts', JSON.stringify(App.opts));

function dataKey() {
  const k = App.cfg.dataGoKrKey || '';
  return k.indexOf('%') >= 0 ? k : encodeURIComponent(k);
}

// ============================================================ 3. 생태자연도 API
function wfsUrl(b, maxFeatures) {
  return `${EP}/wfs/getEcologyzmpWFS?ServiceKey=${dataKey()}&typename=tbl_opn_eczm&srs=EPSG:5186` +
    `&bbox=${b[0]},${b[1]},${b[2]},${b[3]}&outputFormat=application/json` + (maxFeatures ? `&maxFeatures=${maxFeatures}` : '');
}
async function wfsCount(b) {
  const j = await limited(() => fetchJsonRetry(wfsUrl(b, 1)));
  return { total: typeof j.totalFeatures === 'number' ? j.totalFeatures : (j.features || []).length, first: (j.features || [])[0] };
}
function idToDate(id) {
  const m = /\.(\d{8})/.exec(String(id || ''));
  return m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}` : '';
}

// 쿼드트리 수집: totalFeatures > features.length 이면 4등분 재귀 (startIndex 사용 안 함)
async function collectEczm(bbox, onProg) {
  const feats = new Map();
  let calls = 0, deepWarn = 0;
  async function rec(b, depth) {
    const j = await limited(() => fetchJsonRetry(wfsUrl(b)));
    calls++;
    const arr = j.features || [];
    arr.forEach((f, i) => {
      const id = f.id != null ? f.id : ('noid-' + calls + '-' + i);
      if (!feats.has(id)) { f.id = id; feats.set(id, f); }
    });
    if (onProg) onProg(calls, feats.size);
    const total = typeof j.totalFeatures === 'number' ? j.totalFeatures : (arr.length >= 500 ? Infinity : arr.length);
    if (total > arr.length) {
      if (depth >= 12) { deepWarn++; return; }
      const mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2;
      await Promise.all([
        rec([b[0], b[1], mx, my], depth + 1), rec([mx, b[1], b[2], my], depth + 1),
        rec([b[0], my, mx, b[3]], depth + 1), rec([mx, my, b[2], b[3]], depth + 1),
      ]);
    }
  }
  await rec(bbox, 0);
  return { features: Array.from(feats.values()), calls, deepWarn };
}

// ============================================================ 4. 자료 최신 확인
async function checkFresh() {
  const info = $('#freshInfo'), banner = $('#freshBanner');
  if (!App.cfg.dataGoKrKey) {
    info.innerHTML = '<span class="bad">data.go.kr 인증키를 입력하세요.</span>';
    return null;
  }
  info.innerHTML = '<div class="fresh-main">자료 상태 : 확인 중</div>';
  try {
    const xml = await limited(async () => {
      const r = await fetch(`${EP}/wms/getEcologyzmpWMS?ServiceKey=${dataKey()}&request=GetCapabilities`);
      if (!r.ok) throw new Error('GetCapabilities HTTP ' + r.status);
      return r.text();
    });
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const updateSequence = doc.documentElement.getAttribute('updateSequence') || '';
    const ref = await wfsCount(REF_BBOX);
    const cur = {
      updateSequence, idDate: idToDate(ref.first && ref.first.id), refTotal: ref.total,
      checkedAt: new Date().toISOString(),
    };
    let prev = {};
    try { prev = await api('/api/state'); } catch (e) { prev = {}; }
    if (prev && prev.updateSequence !== undefined) {
      const diffs = [];
      if (String(prev.updateSequence) !== String(cur.updateSequence)) diffs.push('updateSequence ' + prev.updateSequence);
      if (prev.idDate !== cur.idDate) diffs.push('기준일 ' + prev.idDate);
      if (prev.refTotal !== cur.refTotal) diffs.push('기준 영역 건수 ' + prev.refTotal);
      if (diffs.length) {
        banner.hidden = false;
        banner.textContent = `생태자연도 자료가 갱신되었습니다 (이전: ${diffs.join(', ')} → 현재: updateSequence ${cur.updateSequence}, 기준일 ${cur.idDate}, 기준 영역 건수 ${cur.refTotal})`;
      }
    } else {
      banner.hidden = false;
      banner.textContent = '기준 자료 등록: 이번 확인 값을 기준으로 저장했습니다.';
    }
    try { await api('/api/state', cur); } catch (e) { /* 저장 실패는 진행 허용 */ }
    App.fresh = cur;
    info.innerHTML = `<div class="fresh-main">자료 상태 : <span class="ok-blue">최신 확인 완료</span></div>` +
      `<div class="fresh-sub">확인 시각 ${esc(new Date(cur.checkedAt).toLocaleString('ko-KR'))}<br>updateSequence ${esc(cur.updateSequence)} · 자료 기준일 ${esc(cur.idDate || '-')}</div>`;
    return cur;
  } catch (e) {
    App.fresh = null;
    info.innerHTML = `<span class="bad">자료 확인 실패: ${esc(e.message)}</span><br>인증키나 네트워크를 확인하세요. 작업은 계속할 수 있습니다.`;
    return null;
  }
}

// ============================================================ 5. 스타일 / 레이어 세트
const styleCache = new Map();
function cached(key, mk) {
  let s = styleCache.get(key);
  if (!s) { s = mk(); styleCache.set(key, s); if (styleCache.size > 2000) styleCache.clear(); }
  return s;
}
function dashArr(kind, w) {
  if (kind === 'dashed') return [w * 4, w * 2.5];
  if (kind === 'dotted') return [w * 0.8, w * 2];
  return undefined;
}
App.dashArr = dashArr;

function gradeStyle(grade, s, thin) {
  return cached(`g|${grade}|${s.toFixed(3)}|${thin ? 1 : 0}`, () => {
    const col = GRADE_COLOR[grade] || '#BBBBBB';
    return new ol.style.Style({
      fill: new ol.style.Fill({ color: col }),
      stroke: new ol.style.Stroke({ color: grade === '3' ? '#999999' : 'rgba(60,60,60,0.7)', width: Math.max(0.3, (thin ? 0.5 : 0.8) * s) }),
    });
  });
}
function hexA(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function insideStyle(grade, s, a, thin) {
  return cached(`i|${grade}|${s.toFixed(3)}|${a.toFixed(2)}|${thin ? 1 : 0}`, () => new ol.style.Style({
    fill: new ol.style.Fill({ color: hexA(GRADE_COLOR[grade] || '#BBBBBB', a) }),
    stroke: new ol.style.Stroke({ color: grade === '3' ? `rgba(153,153,153,${a})` : `rgba(60,60,60,${0.7 * a})`, width: Math.max(0.3, (thin ? 0.5 : 0.8) * s) }),
  }));
}
// 최근접 거리 화살표: 양쪽 화살촉 + "약 4.7km 이격" 글자
function arrowStyle(f, s, res) {
  const c0 = f.getGeometry().getCoordinates(); if (c0.length < 2) return null;
  // 미세조정 (도면 출력): 화살표 이동 sx/sy, 글자 이동 lx/ly (mm, 아래쪽 +), 글자 내용 text, 글자 크기 pt
  const adj = ((App.opts.arrowAdj || {})[f.get('key')]) || {};
  const PXMM = App.PX_PER_MM96 * s;                       // 1mm 의 화면 px
  const mx = (Number(adj.sx) || 0) * PXMM * (res || 0), my = -(Number(adj.sy) || 0) * PXMM * (res || 0);
  // 길이(%)·회전(°): 화살표 가운데를 기준으로 늘이고 돌림 (시계 방향 +)
  const k = (Number(adj.len) || 100) / 100, rot = -(Number(adj.rot) || 0) * Math.PI / 180;
  const cx = (c0[0][0] + c0[1][0]) / 2 + mx, cy = (c0[0][1] + c0[1][1]) / 2 + my;
  const hx = (c0[1][0] - c0[0][0]) / 2 * k, hy = (c0[1][1] - c0[0][1]) / 2 * k;
  const rx = hx * Math.cos(rot) - hy * Math.sin(rot), ry = hx * Math.sin(rot) + hy * Math.cos(rot);
  const a = [cx - rx, cy - ry], b = [cx + rx, cy + ry];
  const wk = (Number(adj.w) || 100) / 100;                // 굵기·화살촉 크기(%)
  const line = new ol.geom.LineString([a, b]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const head = (p, rot) => new ol.style.Style({ geometry: new ol.geom.Point(p),
    image: new ol.style.RegularShape({ points: 3, radius: 7 * s * wk, rotation: rot, fill: new ol.style.Fill({ color: '#000' }) }) });
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // 글자: 화살표와 겹치지 않게 선의 수직 방향(위쪽 또는 오른쪽)으로 글자 크기만큼 띄움 (흰 테두리 글자)
  const label = adj.text != null && adj.text !== '' ? adj.text : (f.get('label') || '');
  const pt = Number(adj.size) || Number(App.opts.arrowPt) || 10.5;
  const fpx = Math.round(pt * 0.3528 * PXMM * 10) / 10;
  const font = `${fpx}px "EcoFont","Malgun Gothic",sans-serif`;
  arrowStyle.ctx = arrowStyle.ctx || document.createElement('canvas').getContext('2d');
  arrowStyle.ctx.font = font;
  const pad = 2 * s, tw = arrowStyle.ctx.measureText(label).width + pad * 2, th = fpx + pad;
  let nx = -Math.sin(ang), ny = Math.cos(ang);              // 선에 수직 (지도 좌표, y 위쪽)
  if (ny < 0 || (Math.abs(ny) < 1e-6 && nx < 0)) { nx = -nx; ny = -ny; }   // 위쪽/오른쪽으로
  const d = 4 * s + Math.abs(nx) * tw / 2 + Math.abs(ny) * th / 2;
  const ox = nx * d + (Number(adj.lx) || 0) * PXMM, oy = -ny * d + (Number(adj.ly) || 0) * PXMM;
  return [
    new ol.style.Style({ geometry: line, stroke: new ol.style.Stroke({ color: '#fff', width: 5 * s * wk }) }),
    new ol.style.Style({ geometry: line, stroke: new ol.style.Stroke({ color: '#000', width: 2.2 * s * wk }) }),
    head(b, Math.PI / 2 - ang), head(a, -Math.PI / 2 - ang),
    new ol.style.Style({ geometry: new ol.geom.Point(mid), text: new ol.style.Text({
      text: label, font, textAlign: 'center', textBaseline: 'middle', offsetX: ox, offsetY: oy,
      fill: new ol.style.Fill({ color: '#000' }), stroke: new ol.style.Stroke({ color: '#fff', width: 4 * s }), overflow: true }) }),
  ];
}
// 화살표 추가/교체: pts = [[x,y],[x,y]] (EPSG:5186)
App.setArrows = function (theme, list) {
  App.src.arrows.getFeatures().filter(f => f.get('theme') === theme).forEach(f => App.src.arrows.removeFeature(f));
  list.forEach(it => {
    const g = new ol.geom.LineString(it.pts.map(p => ol.proj.transform(p, 'EPSG:5186', 'EPSG:3857')));
    const f = new ol.Feature({ geometry: g });
    f.set('theme', theme); f.set('label', it.label); f.set('on', it.on !== false); f.set('key', it.key);
    App.src.arrows.addFeature(f);
  });
  App.emit();
};
App.catStyleFor = cat => ((App.theme === 'ecvam' ? App.catStyleE : App.catStyle)[cat]) || DEFAULT_CAT_STYLE['사업지구'];
// 도면 명칭(사업지구·계획지구 등): 도면 안쪽 가운데에 선 색 글자 + 흰 버퍼. 위치는 끌거나 X/Y(mm)로 조정
App.siteLabelPoint = function (s) {
  if (!s || !s.feature) return null;
  if (s.labelPos) return s.labelPos;
  const g = s.feature.getGeometry();
  if (s._lpG === g && s._lp) return s._lp;
  let p = null;
  try {
    if (g.getType() === 'Polygon') p = g.getInteriorPoint().getCoordinates();
    else if (g.getType() === 'MultiPolygon') { let best = null, ba = -1; g.getPolygons().forEach(q => { const a = q.getArea(); if (a > ba) { ba = a; best = q; } }); p = best.getInteriorPoint().getCoordinates(); }
    else p = ol.extent.getCenter(g.getExtent());
  } catch (e) { p = ol.extent.getCenter(g.getExtent()); }
  s._lpG = g; s._lp = [p[0], p[1]];
  return s._lp;
};
function siteStyleFull(f, s) {
  const site = App.sites.find(x => x.id === f.get('siteId')) || {};
  const st = siteStyle(f.get('category'), s, site.opacity);
  const o = App.opts.siteLabel || {};
  if (o.show === false || !site.feature) return st;
  const lp = App.siteLabelPoint(site); if (!lp) return st;
  const PXMM = PX_PER_MM96 * s, off = site.labelOff || [0, 0];
  const pt = (Number(o.pt) || 14) * ((Number(o.scale) || 100) / 100), buf = o.buf == null || o.buf === '' ? 0.8 : Math.max(0, Number(o.buf));
  const col = App.catStyleFor(f.get('category')).color;
  return [st, new ol.style.Style({ geometry: new ol.geom.Point(lp), zIndex: 10, text: new ol.style.Text({
    text: site.labelText || site.category || '', font: `bold ${Math.round(pt * 0.3528 * PXMM * 10) / 10}px "EcoFont","Malgun Gothic",sans-serif`,
    offsetX: (Number(off[0]) || 0) * PXMM, offsetY: (Number(off[1]) || 0) * PXMM,
    fill: new ol.style.Fill({ color: col }), stroke: buf > 0 ? new ol.style.Stroke({ color: '#fff', width: buf * 2 * PXMM }) : undefined, overflow: true }) })];
}
function siteStyle(cat, s, op) {
  const st = App.catStyleFor(cat);
  const a = op == null || op === '' ? 1 : Math.max(0, Math.min(1, Number(op)));   // 도면별 투명도 (도면 출력)
  return cached(`s|${cat}|${st.color}|${st.width}|${st.dash}|${s.toFixed(3)}|${a}`, () => {
    const w = st.width * s;
    return new ol.style.Style({ stroke: new ol.style.Stroke({ color: hexA(st.color, a), width: w, lineDash: dashArr(st.dash, w), lineCap: 'butt' }) });
  });
}

function tileSource(layer, ext, proxy) {
  const key = App.cfg.vworldKey;
  const url = proxy ? `/tile/vworld/${layer}/{z}/{y}/{x}.${ext}` : `https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}/{z}/{y}/{x}.${ext}`;
  return new ol.source.XYZ({ url, minZoom: 6, maxZoom: 19, crossOrigin: 'anonymous' });
}

/* 레이어 세트 생성. getScale(): 선 굵기 배율(styleScale). 미리보기/내보내기가 같은 팩토리를 사용 */
App.createLayerSet = function (getScale, live) {
  const set = { baseKey: null };
  set.base = new ol.layer.Tile({ visible: false, zIndex: 0 });
  set.label = new ol.layer.Tile({ visible: false, zIndex: 1 });
  set.around = new ol.layer.VectorImage({ imageRatio: 1.5,
    source: App.src.around, zIndex: 2,
    // 주변 생태자연도: 3등급(흰색)은 '흰색(3등급) 투명도', 나머지는 '생태자연도 투명도'
    style: f => {
      const g = String(f.get('eczm_grad'));
      const a = g === '3' ? (App.opts.opI == null ? 0.6 : Number(App.opts.opI)) : Number(App.opts.opA);
      return insideStyle(g, getScale(), a, true);
    },
  });
  set.inside = new ol.layer.VectorImage({ imageRatio: 1.5,
    source: App.src.inside, zIndex: 3,
    style: f => {
      let g = String(f.get('grade'));
      if (g === 'rest') { if (!App.opts.rest3) return null; g = '3'; }
      // 도면 내부: 3등급(흰색)은 '도면 투명도(내부)', 나머지 등급은 '생태자연도 투명도'
      const a = g === '3' ? (App.opts.opI == null ? 0.6 : Number(App.opts.opI)) : Number(App.opts.opA);
      return insideStyle(g, getScale(), a);
    },
  });
  set.sites = new ol.layer.Vector({
    source: App.src.sites, zIndex: 4,
    style: f => siteStyleFull(f, getScale()),
  });
  set.ecvam = new ol.layer.Tile({ zIndex: 2.5, visible: false });   // 국토환경성평가지도 (ecvam.js)
  set.prot = new ol.layer.VectorImage({ imageRatio: 1.5,
    source: App.src.prot, zIndex: 3.5,
    style: f => (App.protStyle ? App.protStyle(f, getScale(), set) : null),
  });
  set.id = (App._setSeq = (App._setSeq || 0) + 1);
  // 화면 범위가 바뀌면 보호구역 명칭 위치를 다시 계산
  // 화면 범위가 바뀌면 명칭 위치(보호구역·시군구)를 다시 계산
  const onPre = e => {
    const ex = e.frameState.extent, o = set.viewExtent;
    const tol = o ? (o[2] - o[0]) * 0.02 : 0;
    if (!o || Math.abs(ex[0] - o[0]) > tol || Math.abs(ex[1] - o[1]) > tol || Math.abs(ex[2] - o[2]) > tol || Math.abs(ex[3] - o[3]) > tol) {
      // 움직이는 동안에는 이전 명칭 위치를 쓰고, 멈춘 뒤(0.3초) 한 번만 다시 계산
      clearTimeout(set._lpTimer);
      const exs = ex.slice();
      set._lpTimer = setTimeout(() => { set.viewExtent = exs; set.prot.changed(); if (set.admin) set.admin.changed(); }, o ? 300 : 0);
    }
  };
  set.prot.on('prerender', onPre);
  set.admin = new ol.layer.VectorImage({ imageRatio: 1.5,
    source: App.src.admin, zIndex: 5.5, declutter: false,
    style: (f, res) => (App.admStyle ? App.admStyle(f, getScale(), set, res) : null),
  });
  set.admin.on('prerender', onPre);
  set.pick = new ol.layer.Vector({ source: App.src.pick, zIndex: 5.8, style: f => (App.pickStyle ? App.pickStyle(f, getScale()) : null) });
  set.arrows = new ol.layer.Vector({
    source: App.src.arrows, zIndex: 6, declutter: false,
    style: (f, res) => (f.get('theme') === App.theme && f.get('on') !== false ? arrowStyle(f, getScale(), res) : null),
  });
  set.layers = [set.base, set.label, set.ecvam, set.around, set.inside, set.prot, set.admin, set.pick, set.sites, set.arrows];
  set.errors = 0;
  set.refresh = function (over) {
    const o = Object.assign({}, App.opts, over || {});
    // 표시 방식은 '주변 전체 + 사업지구 내부' 하나로 고정, 투명도는 하나로 통일
    if (!['base', 'white', 'sat', 'none'].includes(o.basemap)) o.basemap = App.opts.basemap = 'base';
    // 주제(생태자연도 / 보호구역)에 따라 레이어 표시
    const eco = App.theme === 'eco';
    set.around.setVisible(eco);
    set.inside.setVisible(eco);
    if (set.prot) set.prot.setVisible(App.theme === 'prot');
    const ev = App.theme === 'ecvam' && !!App.ecvamSource;
    if (ev) { const src = App.ecvamSource(); if (set.ecvam.getSource() !== src) set.ecvam.setSource(src); }
    set.ecvam.setVisible(ev);
    set.ecvam.setOpacity(o.opE == null ? 0.7 : Number(o.opE));
    set.around.setOpacity(1);   // 등급별 투명도는 스타일에서 적용
    set.inside.setOpacity(1);   // 내부는 스타일에서 등급별로 투명도 적용
    set.sites.setOpacity(o.opS == null ? 1 : Number(o.opS));
    set.base.setOpacity(o.opB == null ? 1 : Number(o.opB));   // 배경지도 투명도   // 올린 도면(경계선) 투명도
    const key = [o.basemap, o.proxy ? 1 : 0, App.cfg.vworldKey || ''].join('|');
    if (key !== set.baseKey) {
      set.baseKey = key;
      const hasKey = !!App.cfg.vworldKey;
      let b = null, l = null;
      if (o.basemap !== 'none') {
        if (!hasKey) { b = new ol.source.OSM(); }
        else if (o.basemap === 'base') b = tileSource('Base', 'png', o.proxy);
        else if (o.basemap === 'white') b = tileSource('white', 'png', o.proxy);   // 브이월드 백지도 (상호·시설 글자 없음)
        else if (o.basemap === 'sat') b = tileSource('Satellite', 'jpeg', o.proxy);
        else if (o.basemap === 'hybrid') { b = tileSource('Satellite', 'jpeg', o.proxy); l = tileSource('Hybrid', 'png', o.proxy); }
        else if (o.basemap === 'gray') b = tileSource('gray', 'png', o.proxy);
      }
      set.errors = 0;
      [[set.base, b], [set.label, l]].forEach(([lyr, s]) => {
        if (s) {
          s.on('tileloaderror', () => { set.errors++; if (live && set.errors === 1) toast('배경지도 타일을 불러오지 못했습니다. 브이월드 키/도메인을 확인하세요.', 'warn'); });
          lyr.setSource(s);
        }
        lyr.setVisible(!!s);
      });
    }
  };
  set.changed = () => { set.around.changed(); set.inside.changed(); set.prot.changed(); set.sites.changed(); set.arrows.changed(); if (set.pick) set.pick.changed(); if (set.admin) set.admin.changed(); };
  set.tileSources = () => [set.base.getSource(), set.label.getSource()].filter(Boolean);
  if (live) App.liveSets.push(set);
  return set;
};

// ============================================================ 6. 작업 지도
proj4.defs('EPSG:5186', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs');
ol.proj.proj4.register(proj4);
const geojson = new ol.format.GeoJSON();
const readOpts = { dataProjection: 'EPSG:5186', featureProjection: 'EPSG:3857' };
App.readOpts = readOpts;

App.workSet = App.createLayerSet(() => 1, true);
App.workMap = new ol.Map({
  target: 'map',
  layers: App.workSet.layers,
  view: new ol.View({ projection: 'EPSG:3857', center: ol.proj.fromLonLat([127.8, 36.3]), zoom: 7, minZoom: 5, maxZoom: 21 }),
});

App.applyOpts = function () {
  App.liveSets.forEach(s => { s.refresh(); s.changed(); });
  renderTable();
  App.emit();
};

App.sitesExtent = function () {
  const e = App.src.sites.getExtent();
  return (e && isFinite(e[0])) ? e : null;
};
function fitSites(sitesOnly) {
  const e = App.sitesExtent();
  if (e) App.workMap.getView().fit(e, { padding: [50, 50, 50, 50], maxZoom: 18, duration: 300 });
}

// ============================================================ 7. 옵션 UI (두 탭 공유)
const SLD = (lab, k) => `<div class="slider" data-row="${k}"><span>${lab}</span><input type="range" min="0" max="1" step="0.05" data-opt="${k}">
      <span class="pct-box"><input type="number" min="0" max="100" step="5" data-pct="${k}"><span>%</span></span></div>`;
// parts: 'base' = 배경지도 + 도면 선, 'eco' = 생태자연도·흰색, 'all' = 둘 다
function buildMapOpts(el, parts) {
  let h = '';
  if (parts !== 'eco') h += `<label class="field"><span>배경지도</span><select data-opt="basemap">
      <option value="base">일반지도</option><option value="white">백지도 (글자 적음)</option><option value="sat">위성지도</option><option value="none">흰색 배경</option></select></label>` + SLD('배경지도 투명도', 'opB');
  if (parts !== 'base') h += SLD('생태자연도 투명도', 'opA') + SLD('흰색(3등급) 투명도', 'opI');
  if (parts === 'all') h += SLD('평가지도 투명도', 'opE');
  if (parts !== 'eco') h += SLD('도면 투명도(선)', 'opS');
  el.innerHTML = h;
}
function syncOptUI() {
  $$('[data-opt]').forEach(el => {
    const v = App.opts[el.dataset.opt];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = el.value === String(v);
    else el.value = v;
  });
  $$('[data-pct]').forEach(el => { if (document.activeElement !== el) el.value = Math.round(Number(App.opts[el.dataset.pct]) * 100); });
}
function initOptUI() {
  $('#optRest3').dataset.opt = 'rest3';
  $('#optRange').dataset.opt = 'range';
  buildMapOpts($('#mapOptsWork'), 'base');
  buildMapOpts($('#ecoOpts'), 'eco');
  $('#ecvamOpts').innerHTML = SLD('평가지도 투명도', 'opE');
  buildMapOpts($('#mapOptsLayout'), 'all');
  syncOptUI();
  // 투명도 % 직접 입력 (0~100)
  document.addEventListener('input', e => {
    const p = e.target.dataset && e.target.dataset.pct;
    if (!p || e.target.value === '') return;
    App.opts[p] = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100;
    App.saveOpts(); syncOptUI(); App.applyOpts();
  });
  document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.pct) syncOptUI(); });
  document.addEventListener('input', e => {
    const el = e.target.closest ? e.target.closest('[data-opt]') : null;
    if (!el) return;
    const k = el.dataset.opt;
    if (el.type === 'checkbox') App.opts[k] = el.checked;
    else if (el.type === 'radio') { if (!el.checked) return; App.opts[k] = el.value; }
    else if (el.type === 'range' || el.type === 'number') App.opts[k] = Number(el.value);
    else App.opts[k] = el.value;
    App.saveOpts();
    syncOptUI();
    App.applyOpts();
  });
}

// ============================================================ 8. 구분별 선 스타일 UI
function initCatStyles() { catStyleBox('#catStyles', 'catStyle', 'ecoCatStyle'); catStyleBox('#catStylesE', 'catStyleE', 'ecoCatStyleE'); }
// 구분(4가지) 중 하나를 골라 그 선 스타일만 편집 (도면 탭: 기본 / 국토환경성평가 탭: 평가지도용)
function catStyleBox(sel0, key, lsKey) {
  const box = $(sel0); if (!box) return;
  box.innerHTML = `<div class="cat-row">
      <select data-f="cat">${CATS.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
      <input type="color" data-f="color" title="색">
      <input type="number" data-f="width" min="0.5" max="12" step="0.5" title="굵기">
      <select data-f="dash" title="선 종류"><option value="solid">실선</option><option value="dashed">파선</option><option value="dotted">점선</option></select></div>`;
  const sel = $('[data-f="cat"]', box);
  const fill = () => { const s = App[key][sel.value]; $('[data-f="color"]', box).value = s.color; $('[data-f="width"]', box).value = s.width; $('[data-f="dash"]', box).value = s.dash; };
  fill();
  box.addEventListener('input', e => {
    const f = e.target.dataset.f;
    if (f === 'cat') return fill();
    if (!f) return;
    App[key][sel.value][f] = f === 'width' ? (Number(e.target.value) || 1) : e.target.value;
    localStorage.setItem(lsKey, JSON.stringify(App[key]));
    App.liveSets.forEach(s => s.sites.changed());
    App.emit();
  });
  box.addEventListener('change', e => { if (e.target.dataset.f === 'cat') fill(); });
}

// ============================================================ 9. 도면(사이트) 카드
let siteSeq = 0;
function guessCategory(name) {
  if (/사업지구|사업부지|사업구역/.test(name)) return '사업지구';
  if (/계획지구|계획구역|계획부지/.test(name)) return '계획지구';
  if (/사업노선/.test(name)) return '사업노선';
  if (/계획노선/.test(name)) return '계획노선';
  if (/노선|도로|선형/.test(name)) return '사업노선';
  return '사업지구';
}
function autoLayers(layers) {
  const re = /경계|구역|부지|지구|노선|계획|사업|용지|boundary|limit|site/i;
  let any = false;
  layers.forEach(l => { l.checked = l.closed > 0 && re.test(l.name); if (l.checked) any = true; });
  if (!any) layers.forEach(l => { l.checked = l.closed > 0; });
}

function renderCard(s) {
  let el = s.el;
  if (!el) {
    el = document.createElement('div');
    el.className = 'site-card';
    el.dataset.sid = s.id;
    s.el = el;
    $('#siteList').appendChild(el);
  }
  const layers = (s.layers || []).map((l, i) =>
    `<label><input type="checkbox" data-act="layer" data-i="${i}" ${l.checked ? 'checked' : ''}> <span>${esc(l.name || '(이름 없음)')}</span>
     <span class="cnt">${l.count}개 · 닫힘 ${l.closed}</span></label>`).join('');
  let crs = '';
  if (s.cands && s.cands.length) {
    const opts = s.cands.map((c, i) => `<option value="${i}" ${i === s.crsIdx ? 'selected' : ''}>${esc(c.label || c.key)} (${c.hits == null ? '확인불가' : '주변 1km ' + c.hits + '건'})</option>`).join('');
    const c = s.cands[s.crsIdx] || s.cands[0];
    const geo = (c.lat != null && c.lon != null) ? `, 경위도 ${Number(c.lat).toFixed(2)}N ${Number(c.lon).toFixed(2)}E` : '';
    crs = `<label class="field"><span>좌표계</span><select data-act="crs">${opts}</select></label>
      <div class="note">자동 판정: ${esc(c.key)} (${c.hits == null ? '생태자연도 확인 불가' : '주변 1km 생태자연도 ' + c.hits + '건'}${geo})</div>`;
    if (s.cands.filter(x => x.hits > 0).length >= 2) {
      crs += '<div class="note warn">다른 좌표계도 육지에 위치합니다. 지도에서 위치를 꼭 확인하세요.</div>';
    }
  }
  el.innerHTML = `
    <div class="head"><span class="fname">${esc(s.name)}</span>
      <button class="btn small" data-act="zoom" type="button" ${s.geometry ? '' : 'disabled'}>위치로 이동</button>
      <button class="btn small" data-act="del" type="button">삭제</button></div>
    ${s.restored ? '<div class="note">저장한 작업 파일에서 불러온 도면입니다 (레이어·좌표계를 바꾸려면 원본 도면을 다시 올려 주세요)</div>' : ''}
    ${s.converter ? `<div class="note">DWG→DXF 변환: ${esc(s.converter)}</div>` : ''}
    <label class="field"><span>구분</span><select data-act="cat">${CATS.map(c => `<option ${c === s.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    ${s.layers ? `<div class="layer-list">${layers || '<div class="note">레이어 없음</div>'}</div>` : ''}
    ${s.layers ? `<div class="outline-opt">
      <label class="check"><input type="checkbox" data-act="outline" ${s.outline ? 'checked' : ''}> 외곽선만 사용 (복잡한 도면)</label>
      <label class="gap-box" ${s.outline ? '' : 'hidden'}>틈 메우기 <input type="number" data-act="gap" min="0.5" max="100" step="0.5" value="${s.gap}"> m</label>
    </div>` : ''}
    ${crs}
    ${s.busy ? `<div class="busy">${esc(s.busy)}</div>` : ''}
    ${s.area != null ? `<div class="area">면적 ${fmt(s.area)} ㎡</div>` : ''}
    ${s.poly > 0 ? `<div class="note">흩어진 선 ${s.poly}개 영역을 면으로 합성했습니다.</div>` : ''}
    ${s.outlineInfo ? `<div class="note">외곽선 ${s.outlineInfo.parts}개 영역으로 정리${s.outlineInfo.dropped ? ` (작은 조각 ${s.outlineInfo.dropped}개 제외)` : ''}. 선이 끊겨 안쪽이 비면 틈 메우기 값을 늘리세요.</div>` : ''}
    ${s.error ? `<div class="note err">${esc(s.error)}</div>` : ''}`;
}

function siteById(id) { return App.sites.find(s => String(s.id) === String(id)); }

// ---- 작업 저장/열기 (project.js) 에서 쓰는 도우미
App.restoreSite = function (o) {
  const s = { id: ++siteSeq, name: o.name, category: o.category, geometry: o.geometry, area: o.area, bbox: o.bbox, opacity: o.opacity, labelPos: o.labelPos, labelOff: o.labelOff, labelText: o.labelText, restored: true, seq: 0 };
  App.sites.push(s); renderCard(s); if (s.geometry) setSiteFeature(s);
  return s;
};
App.clearWork = function () {
  App.sites.slice().forEach(s => { s.seq++; clearSiteGeom(s); if (s.el) s.el.remove(); });
  App.sites.length = 0;
  ['around', 'inside', 'prot', 'arrows', 'admin'].forEach(k => App.src[k] && App.src[k].clear());
  App.area = null; App.eco1 = null; App.eczmCache = null;
  renderTable(); const ei = $('#eco1Info'); if (ei) ei.innerHTML = '면적 계산 후 표시됩니다.';
  App.emit();
};
App.restoreArea = function (area, around, inside, eczmCount, eco1, eco1Html) {
  App.area = area; App.eczmCount = eczmCount;
  App.src.around.clear(); App.src.inside.clear();
  if (around) App.src.around.addFeatures(around);
  if (inside) App.src.inside.addFeatures(inside);
  App.eco1 = eco1 || null; const ei = $('#eco1Info'); if (ei && eco1Html) ei.innerHTML = eco1Html;
  renderTable();
};
App.fitSites = () => fitSites();
App.renderSiteCard = s => renderCard(s);

async function addFile(file) {
  const s = { id: ++siteSeq, name: file.name, category: guessCategory(file.name), busy: '업로드 중...', seq: 0 };
  App.sites.push(s);
  renderCard(s);
  try {
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name) }, body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    s.fileId = j.fileId;
    s.converter = j.converter || '';
    s.layers = (j.layers || []).map(l => ({ name: l.name, count: l.count, types: l.types, closed: l.closed || 0, checked: false }));
    autoLayers(s.layers);
    // 도형이 많은 복잡한 도면은 외곽선 모드로 시작 (선/면이 있는 레이어 전부 선택)
    const total = s.layers.reduce((a, l) => a + l.count, 0);
    s.gap = 5;
    s.outline = total > 500;
    if (s.outline) s.layers.forEach(l => { l.checked = Object.keys(l.types || {}).some(t => t !== 'Point'); });
    s.bounds = j.bounds;
    await reprocess(s);
  } catch (e) {
    s.busy = ''; s.error = e.message; renderCard(s);
    toast(`${file.name}: ${e.message}`, 'error');
  }
}

// 좌표계 판정 + 면적/도형 생성
async function reprocess(s, keepCrs) {
  const my = ++s.seq;
  const names = s.layers.filter(l => l.checked).map(l => l.name);
  s.error = '';
  if (!names.length) { s.busy = ''; s.error = '선택된 레이어가 없습니다.'; clearSiteGeom(s); renderCard(s); return; }
  try {
    if (!keepCrs) {
      s.busy = '좌표계 판정 중...'; renderCard(s);
      const j = await api('/api/crs', { fileId: s.fileId, layers: names, outline: !!s.outline, gap: s.gap });
      if (my !== s.seq) return;
      const cands = j.candidates || [];
      if (!cands.length) throw new Error('좌표계 후보를 찾지 못했습니다. 도면 좌표를 확인하세요.');
      // 후보별 생태자연도 건수 확인 (빠른 1회 시도, 12초). 서버가 응답하지 않으면 우선순위로 정하고 경고
      let down = false;
      await Promise.all(cands.map(async c => {
        c.hits = null;
        // 도면 범위만 보면 3등급(폴리곤 없음)만 있는 작은 도면은 0건이 되어 엉뚱한 좌표계가 뽑힌다.
        // 주변 1km 까지 넓혀 '육지(생태자연도 자료가 있는 곳)인지'만 확인하고, 육지인 후보 중 우선순위(5186 먼저)로 고른다.
        const b0 = c.bbox5186, P = 1000;
        const b = b0 && [b0[0] - P, b0[1] - P, b0[2] + P, b0[3] + P];
        if (!b || !App.cfg.dataGoKrKey || down) return;
        try {
          const j = await limited(() => fetchJsonRetry(wfsUrl(b, 1), 1, 12000));
          c.hits = typeof j.totalFeatures === 'number' ? j.totalFeatures : (j.features || []).length;
        } catch (e) { c.hits = null; if (/시간 초과|HTTP 5/.test(e.message)) down = true; }
      }));
      // 응답이 없던 후보 중 우선순위 높은 3개는 한 번 더 확인 (서버가 느릴 때 5186 이 빠지는 것 방지)
      for (const c of cands.filter(x => x.hits == null && x.bbox5186).sort((a, b) => (a.priority || 0) - (b.priority || 0)).slice(0, 3)) {
        if (!App.cfg.dataGoKrKey) break;
        const b0 = c.bbox5186, P = 1000, b = [b0[0] - P, b0[1] - P, b0[2] + P, b0[3] + P];
        try { const j = await limited(() => fetchJsonRetry(wfsUrl(b, 1), 2, 15000)); c.hits = typeof j.totalFeatures === 'number' ? j.totalFeatures : (j.features || []).length; } catch (e) { /* 그대로 확인불가 */ }
        if (my !== s.seq) return;
      }
      if (down && cands.every(c => c.hits == null)) toast('생태자연도 서버가 응답하지 않아 좌표계를 우선순위(EPSG:5186 등)로 정했습니다. 지도에서 위치를 확인하세요.', 'warn');
      if (my !== s.seq) return;
      let idx = -1;
      // 0건(바다 등)으로 확인된 후보만 빼고, 우선순위가 가장 높은 후보 (확인불가도 후보로 남김: 5186 이 기본)
      cands.forEach((c, i) => { if (c.hits !== 0 && (idx < 0 || (c.priority || 0) < (cands[idx].priority || 0))) idx = i; });
      if (idx >= 0 && cands[idx].hits == null) toast('생태자연도 서버 응답이 늦어 좌표계를 우선순위로 정했습니다. 지도에서 위치를 확인하세요.', 'warn');
      s.cands = cands;
      s.crsIdx = idx >= 0 ? idx : 0;
    }
    s.busy = '도형 생성 중...'; renderCard(s);
    const c = s.cands[s.crsIdx];
    const j = await api('/api/site', { fileId: s.fileId, layers: names, crs: c.key, scale: c.scale == null ? 1 : c.scale, outline: !!s.outline, gap: s.gap });
    if (my !== s.seq) return;
    s.geometry = j.geometry; s.area = j.area; s.bbox = j.bbox; s.poly = j.polygonizedFromLines || 0; s.outlineInfo = j.outline || null;
    const first = !App.sitesExtent();
    setSiteFeature(s);
    s.busy = '';
    renderCard(s);
    if (first) fitSites();
  } catch (e) {
    if (my !== s.seq) return;
    s.busy = ''; s.error = e.message; clearSiteGeom(s); renderCard(s);
    toast(e.message, 'error');
  }
}
function clearSiteGeom(s) {
  if (s.feature) { App.src.sites.removeFeature(s.feature); s.feature = null; }
  s.geometry = null; s.area = null; s.bbox = null; s.poly = 0;
}
function setSiteFeature(s) {
  if (s.feature) App.src.sites.removeFeature(s.feature);
  const f = geojson.readFeature({ type: 'Feature', geometry: s.geometry, properties: {} }, readOpts);
  f.set('category', s.category); f.set('siteId', s.id);
  s.feature = f;
  App.src.sites.addFeature(f);
  App.emit();
}

function initSiteList() {
  const list = $('#siteList');
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = e.target.closest('.site-card'); const s = siteById(card.dataset.sid); if (!s) return;
    if (b.dataset.act === 'del') {
      s.seq++;
      clearSiteGeom(s);
      App.sites.splice(App.sites.indexOf(s), 1);
      card.remove();
      App.emit();
    } else if (b.dataset.act === 'zoom' && s.feature) {
      App.workMap.getView().fit(s.feature.getGeometry().getExtent(), { padding: [60, 60, 60, 60], maxZoom: 18, duration: 300 });
    }
  });
  list.addEventListener('change', e => {
    const t = e.target; const act = t.dataset.act; if (!act) return;
    const card = t.closest('.site-card'); const s = siteById(card.dataset.sid); if (!s) return;
    if (act === 'cat') {
      s.category = t.value;
      if (s.feature) { s.feature.set('category', s.category); App.liveSets.forEach(x => x.changed()); App.emit(); }
    } else if (act === 'layer') {
      s.layers[Number(t.dataset.i)].checked = t.checked;
      clearTimeout(s.layerTimer);
      s.layerTimer = setTimeout(() => reprocess(s), 450);
    } else if (act === 'outline') {
      s.outline = t.checked;
      reprocess(s, true);
    } else if (act === 'gap') {
      s.gap = Math.max(0.5, Number(t.value) || 5);
      if (s.outline) reprocess(s, true);
    } else if (act === 'crs') {
      s.crsIdx = Number(t.value);
      reprocess(s, true);
    }
  });
  const dz = $('#dropZone'), fi = $('#fileInput');
  $('#btnPick').addEventListener('click', () => fi.click());
  fi.addEventListener('change', async () => { const fs = Array.from(fi.files); fi.value = ''; for (const f of fs) await addFile(f); });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', async e => { for (const f of Array.from(e.dataTransfer.files)) await addFile(f); });
}

// ============================================================ 10. 면적 산정
async function calculate() {
  const btn = $('#btnCalc'), prog = $('#calcProgress');
  const ready = App.sites.filter(s => s.geometry && !s.busy);
  if (!App.cfg.dataGoKrKey) return toast('data.go.kr 인증키를 입력하고 저장하세요.', 'error');
  if (!ready.length) return toast('면적을 계산할 도면(도형)이 없습니다.', 'error');
  btn.disabled = true; prog.hidden = false; prog.textContent = '자료 최신 여부 확인 중...';
  try {
    await checkFresh();
    const ext = [Infinity, Infinity, -Infinity, -Infinity];
    ready.forEach(s => { ext[0] = Math.min(ext[0], s.bbox[0]); ext[1] = Math.min(ext[1], s.bbox[1]); ext[2] = Math.max(ext[2], s.bbox[2]); ext[3] = Math.max(ext[3], s.bbox[3]); });
    const rg = Math.max(0, Number(App.opts.range) || 0);
    const bbox = [ext[0] - rg, ext[1] - rg, ext[2] + rg, ext[3] + rg];
    const got = await collectEczm(bbox, (calls, n) => { prog.textContent = `생태자연도 수집 중... 호출 ${calls}회, 폴리곤 ${n.toLocaleString()}개`; });
    if (got.deepWarn) toast(`일부 영역은 분할 한계(깊이 12)에 도달했습니다 (${got.deepWarn}곳). 누락 가능성이 있습니다.`, 'warn');
    prog.textContent = `면적 계산 중... (폴리곤 ${got.features.length.toLocaleString()}개)`;
    const res = await api('/api/area', {
      sites: ready.map(s => ({ category: s.category, name: s.name, geometry: s.geometry })),
      eczm: { type: 'FeatureCollection', features: got.features },
    });
    App.area = res;
    App.eczmCount = res.eczmCount != null ? res.eczmCount : got.features.length;
    App.src.around.clear(); App.src.inside.clear();
    App.src.around.addFeatures(geojson.readFeatures({ type: 'FeatureCollection', features: got.features }, readOpts));
    App.src.inside.addFeatures(geojson.readFeatures(res.clipped, readOpts));
    renderTable();
    prog.textContent = `완료: 호출 ${got.calls}회, 생태자연도 폴리곤 ${App.eczmCount.toLocaleString()}개`;
    App.eczmCache = { bbox, features: got.features };
    eco1Nearest(got.features, ready);
    App.emit();
  } catch (e) {
    prog.textContent = '실패: ' + e.message;
    toast(e.message, 'error');
  } finally { btn.disabled = false; }
}

// 표 모델 (화면 표, TSV, 도면 면적표가 공유)
App.tableModel = function () {
  const r = App.area; if (!r) return null;
  const as3 = !!App.opts.rest3;
  const keys = r.gradeKeys.filter(k => k !== '9');   // 별도관리지역은 면적표에서 제외 (도면 표시만)
  ['1', '2', '3'].forEach(k => { if (!keys.includes(k)) keys.push(k); });   // 등급 3개는 항상 표시 (없으면 0)
  if (as3 && !keys.includes('3')) keys.push('3');
  const order = { '1': 0, '2': 1, '3': 2, '9': 3 };
  keys.sort((a, b) => ((order[a] != null ? order[a] : 9) - (order[b] != null ? order[b] : 9)) || a.localeCompare(b));
  const cols = keys.map(k => ({ key: k, label: GRADE_NAME[k] || (r.gradeLabels && r.gradeLabels[k]) || k }));
  if (!as3) cols.push({ key: 'none', label: '등급 없음(자료 외)' });
  // 면적 보정: 발주처 면적(㎡)을 넣으면 등급별 면적을 같은 비율로 맞춤 (합계 = 발주처 면적)
  const tg = App.opts.areaTarget || {};
  const rows = CATS.map(c => r.rows.find(x => x.category === c)).filter(Boolean).map(row => {
    const a9 = row.areas['9'] || 0;   // 예전 저장 작업: 별도관리지역 면적은 등급 없음/3등급 쪽으로
    const raw = cols.map(c => c.key === 'none' ? row.noData + a9 : ((row.areas[c.key] || 0) + (c.key === '3' && as3 ? row.noData + a9 : 0)));
    const t = Number(tg[row.category]);
    const k = t > 0 && row.total > 0 ? t / row.total : 1;
    return { category: row.category, total: row.total * k, rawTotal: row.total, factor: k, corrected: k !== 1, vals: raw.map(v => v * k) };
  });
  return { cols, rows };
};
function renderTable() {
  const m = App.tableModel();
  $('#resultBox').hidden = !m;
  if (!m) return;
  const pct = (v, t) => t ? (v / t * 100) : 0;
  // 구분마다 블록: 등급을 세로로 나열 (가로 스크롤 없이 한눈에)
  let h = '<tr><th>등급</th><th>면적(㎡)</th><th>비율(%)</th></tr>';
  m.rows.forEach(r => {
    h += `<tr class="cat-head"><td colspan="3">${esc(r.category)}${r.corrected ? ' <span class="tag">면적 보정</span>' : ''}</td></tr>`;
    m.cols.forEach((c, i) => { h += `<tr><td class="cat">${esc(c.label)}</td><td>${fmt(r.vals[i])}</td><td>${fmt(pct(r.vals[i], r.total))}</td></tr>`; });
    h += `<tr class="sum"><td class="cat">계</td><td>${fmt(r.total)}</td><td>${fmt(100)}</td></tr>`;
  });
  $('#areaTable').innerHTML = h;
  // 면적 보정 입력칸 (구분별)
  const tg = App.opts.areaTarget || {};
  $('#areaFix').innerHTML = m.rows.map(r => `<div class="fix-row">
      <span class="fix-cat">${esc(r.category)}</span>
      <span class="fix-raw">도면 ${fmt(r.rawTotal)}㎡</span>
      <label class="unit-input"><input type="number" min="0" step="any" data-fix="${esc(r.category)}" value="${tg[r.category] || ''}" placeholder="발주처 면적"><span class="unit">㎡</span></label>
    </div>${r.corrected ? `<div class="hint fix-note">· 보정 비율 ${(r.factor * 100).toFixed(3)}% (도면 ${fmt(r.rawTotal)}㎡ → ${fmt(r.total)}㎡)</div>` : ''}`).join('');
}
App.renderAreaTable = renderTable;
function tsv() {
  const m = App.tableModel(); if (!m) return '';
  const l1 = ['구분'], l2 = [''];
  m.cols.concat([{ label: '계' }]).forEach(c => { l1.push(c.label, ''); l2.push('면적(㎡)', '비율(%)'); });
  const lines = [l1.join('\t'), l2.join('\t')];
  m.rows.forEach(r => {
    const cells = [r.category];
    r.vals.concat([r.total]).forEach(v => { cells.push(v.toFixed(2), (r.total ? v / r.total * 100 : 0).toFixed(2)); });
    lines.push(cells.join('\t'));
  });
  return lines.join('\n');
}
async function copyTable() {
  const t = tsv(); if (!t) return;
  try { await navigator.clipboard.writeText(t); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast('표를 복사했습니다. 엑셀이나 한글에 붙여넣으세요.', 'ok');
}
async function saveXlsx() {
  if (!App.area) return;
  const f = App.fresh || {};
  const meta = {
    '자료 확인 시각': f.checkedAt ? new Date(f.checkedAt).toLocaleString('ko-KR') : '확인 안 됨',
    'updateSequence': f.updateSequence || '',
    '자료 기준일(식별번호)': f.idDate || '',
    '생태자연도 폴리곤 수': String(App.eczmCount),
    '주변 범위(m)': String(App.opts.range),
    '자료 없는 지역': App.opts.rest3 ? '3등급으로 산정' : '등급 없음으로 분리',
    ...Object.fromEntries(Object.entries(App.opts.areaTarget || {}).filter(([c, v]) => Number(v) > 0 && App.area.rows.some(r => r.category === c)).map(([c, v]) => [c + ' 면적 보정', '발주처 면적 ' + Number(v).toLocaleString('ko-KR') + '㎡ 기준 (도면 ' + App.area.rows.find(r => r.category === c).total.toFixed(2) + '㎡)'])),
  };
  try {
    const r = await api('/api/xlsx', {
      rows: App.area.rows.map(row => { const k = Number((App.opts.areaTarget || {})[row.category]) > 0 && row.total > 0 ? Number(App.opts.areaTarget[row.category]) / row.total : 1;
        if (k === 1) return row;
        const areas = {}; Object.keys(row.areas).forEach(g => { areas[g] = row.areas[g] * k; });
        return Object.assign({}, row, { total: row.total * k, noData: row.noData * k, areas }); }),
      gradeKeys: App.area.gradeKeys, gradeLabels: App.area.gradeLabels,
      remainderAs3: !!App.opts.rest3, title: $('#xlsxTitle').value || '생태자연도 등급별 면적 현황', meta,
    }, true);
    const blob = await r.blob();
    downloadBlob(blob, '생태자연도_등급별면적.xlsx');
  } catch (e) { toast('엑셀 저장 실패: ' + e.message, 'error'); }
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
App.downloadBlob = downloadBlob;

// ============================================================ 11. 탭 / 시작
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $('#tabWork').hidden = name !== 'work';
  $('#tabEco').hidden = name !== 'eco';
  $('#tabProt').hidden = name !== 'prot';
  const tp = $('#tabPick'); if (tp) tp.hidden = name !== 'pick';
  $('#tabEcvam').hidden = name !== 'ecvam';
  $('#tabLayout').hidden = name !== 'layout';
  $('#workMapWrap').hidden = name === 'layout';
  if (name === 'eco' || name === 'prot' || name === 'ecvam') App.setTheme(name);
  if (name === 'pick') App.setTheme('prot');
  $('#paperWrap').hidden = name !== 'layout';
  if (name === 'layout') { if (App.layout) App.layout.enter(); }
  else { if (App.layout) App.layout.leave(); App.workMap.updateSize(); }
}

// 브이월드 키 실제 확인 (2D데이터 API 1건 요청). 결과를 설정 칸에 표시
async function checkVworldKey() {
  const el = $('#keyVworldOk'); if (!el || !App.cfg.vworldKey) return;
  if (location.protocol === 'file:') { el.textContent = '오류: 사이트 주소로 열어 주세요'; el.className = 'key-ok bad'; el.title = '내려받은 파일(file://)로 열면 브이월드가 인증키를 거부합니다. https://seungw002799-max.github.io/ecozm-web/ 로 여세요.'; return; }
  el.textContent = '확인 중...'; el.className = 'key-ok';
  const u = 'https://api.vworld.kr/req/data?service=data&request=GetFeature&format=json&size=1&geometry=false&data=LT_C_ADSIDO_INFO' +
    `&key=${App.cfg.vworldKey}&domain=${encodeURIComponent(location.origin)}&geomFilter=BOX(126.9,37.5,127.0,37.6)`;
  try {
    const j = await new Promise((ok, no) => {
      const cb = 'vwchk_' + Math.random().toString(36).slice(2), s = document.createElement('script');
      const tm = setTimeout(() => { delete window[cb]; s.remove(); no(new Error('응답 없음 (회사 보안 프로그램이나 광고 차단이 api.vworld.kr 을 막는지 확인)')); }, 15000);
      window[cb] = d => { clearTimeout(tm); delete window[cb]; s.remove(); ok(d); };
      s.onerror = () => { clearTimeout(tm); delete window[cb]; s.remove(); no(new Error('접속 차단 (회사 보안 프로그램·광고 차단 확인)')); };
      s.src = u + '&callback=' + cb; document.head.appendChild(s);
    });
    const r = (j && j.response) || {};
    if (r.status === 'OK' || r.status === 'NOT_FOUND') { el.textContent = '인증 완료'; el.className = 'key-ok'; el.title = ''; }
    else { const raw = (r.error && r.error.text) || r.status; const old = /올바르지 않습니다/.test(raw); const t = old ? '이 사이트용 키가 아닙니다 (예전 키)' : raw; el.textContent = '오류: ' + t; el.className = 'key-ok bad'; el.title = '팀 설정 링크를 다시 열거나, 인증키 변경에서 키를 다시 붙여 넣으세요.'; toast('브이월드 인증키 오류: ' + t + (old ? ' · 다른 주소(localhost)용으로 발급된 예전 키가 저장되어 있습니다. 최신 팀 설정 링크를 열거나 인증키 변경에서 새 키를 넣어 주세요.' : ' · 팀 설정 링크를 다시 열어 주세요.'), 'error'); }
  } catch (e) { el.textContent = '오류: ' + e.message; el.className = 'key-ok bad'; }
}
App.checkVworldKey = checkVworldKey;
// 키가 있으면 입력칸을 숨기고 "인증 완료"만 표시
function renderKeys(edit) {
  const has = { Data: !!App.cfg.dataGoKrKey, Vworld: !!App.cfg.vworldKey };
  ['Data', 'Vworld'].forEach(k => {
    const show = edit || !has[k];
    $('#key' + k).hidden = !show;
    $('#key' + k + 'Ok').hidden = show;
  });
  const any = edit || !has.Data || !has.Vworld;
  $('#keySaveRow').hidden = !any;
  $('#btnKeyEdit').hidden = any;
}
async function saveConfig() {
  const d = $('#keyData').value.trim(), v = $('#keyVworld').value.trim();
  try {
    App.cfg = await api('/api/config', { dataGoKrKey: d, vworldKey: v });
    toast('인증키를 저장했습니다.', 'ok');
    renderKeys(false);
    checkVworldKey();
    App.applyOpts();
    checkFresh();
  } catch (e) { toast('저장 실패: ' + e.message, 'error'); }
}

async function init() {
  loadLocal();
  initOptUI();
  initCatStyles();
  initSiteList();
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#btnSaveCfg').addEventListener('click', saveConfig);
  $('#btnKeyEdit').addEventListener('click', () => renderKeys(true));
  $('#btnFresh').addEventListener('click', checkFresh);
  $('#btnCalc').addEventListener('click', calculate);
  $('#eco1Chk').addEventListener('change', e => { App.src.arrows.getFeatures().filter(f => f.get('theme') === 'eco').forEach(f => f.set('on', e.target.checked)); App.liveSets.forEach(s => s.changed()); App.emit(); });
  $('#btnXlsx').addEventListener('click', saveXlsx);
  $('#areaFix').addEventListener('change', e => { const c = e.target.dataset.fix; if (c == null) return; App.opts.areaTarget = App.opts.areaTarget || {}; const v = Number(e.target.value); if (v > 0) App.opts.areaTarget[c] = v; else delete App.opts.areaTarget[c]; App.saveOpts(); renderTable(); App.emit(); });
  $('#btnCopy').addEventListener('click', copyTable);
  try {
    App.cfg = (await api('/api/config')) || {};
  if (window.ECO_KEYS_FROM_LINK) setTimeout(() => toast('팀 설정 링크로 인증키를 저장했습니다. 다음부터는 주소만 열면 됩니다.', 'ok'), 300);
  } catch (e) { App.cfg = {}; toast('설정을 읽지 못했습니다: ' + e.message, 'error'); }
  $('#keyData').value = App.cfg.dataGoKrKey || '';
  $('#keyVworld').value = App.cfg.vworldKey || '';
  renderKeys(false);
  checkVworldKey();
  if (!App.cfg.vworldKey) toast('브이월드 키를 입력하세요. 지금은 OSM 배경을 사용합니다.', 'warn');
  App.applyOpts();
  api('/api/health').then(h => {
    $('#healthInfo').textContent = '브라우저 버전 · DWG/DXF 직접 처리';
  }).catch(() => {});
  checkFresh();
}
App.switchTab = switchTab;
App.collectEczm = collectEczm;
// 생태자연도 1등급: 사업지구 경계에서 가장 가까운 1등급까지 거리 + 화살표
function eco1Nearest(feats, sites) {
  const box = document.getElementById('eco1Info');
  try {
    const rd = new jsts.io.GeoJSONReader();
    const ss = (sites || App.sites.filter(s => s.geometry)).map(s => rd.read(s.geometry));
    let site = ss[0]; for (let i = 1; i < ss.length; i++) site = site.union(ss[i]);
    let best = null;
    feats.filter(f => String((f.properties || {}).eczm_grad) === '1').forEach(f => {
      let g; try { g = rd.read(f.geometry); } catch (e) { return; }
      const d = g.distance(site);
      if (!best || d < best.d) best = { d, g };
    });
    App.eco1 = best ? { dist: best.d } : null;
    if (!best) { App.setArrows('eco', []); box.innerHTML = '주변 표시 범위 안에 1등급이 없습니다. 범위를 넓혀 다시 계산해 보세요.'; return; }
    if (best.d === 0) { App.setArrows('eco', []); box.innerHTML = '1등급 최근접 거리 : <b class="ok-blue">0.00km (사업지구와 중첩)</b>'; return; }
    const np = jsts.operation.distance.DistanceOp.nearestPoints(site, best.g).map(c => [c.x, c.y]);
    const on = document.getElementById('eco1Chk').checked;
    App.setArrows('eco', [{ key: 'eco1', pts: np, on, label: `1등급 ${App.fmtDist(best.d)} 이격` }]);
    box.innerHTML = `1등급 최근접 거리 : <b class="ok-blue">${App.fmtDist(best.d)}</b>`;
  } catch (e) { box.textContent = '1등급 거리 계산 실패: ' + e.message; }
}
// 거리 표기: 1km 미만은 소수 둘째 자리, 이상은 첫째 자리, 측정 오차를 감안해 "약"
App.fmtDist = (m, unit = true) => { const km = m / 1000; const v = km < 1 ? km.toFixed(2) : km.toFixed(1); return '약 ' + v + (unit ? 'km' : ''); };
App.theme = 'eco';
document.body && (document.body.dataset.theme = 'eco');
App.setTheme = function (t) {
  App.theme = ['prot', 'ecvam'].includes(t) ? t : 'eco';
  document.body.dataset.theme = App.theme;
  const sel = document.getElementById('layoutTheme'); if (sel) sel.value = App.theme;
  App.liveSets.forEach(s => { s.refresh(); s.changed(); });
  App.emit();
};
App.init = init;
