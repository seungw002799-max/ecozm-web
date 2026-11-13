/* 생태자연도 등급별 면적 산정 도구 - 도면 출력 탭 (app2.js)
 * app.js 의 전역 App 객체를 사용한다. 마지막에 App.init() 호출. */
(function () {
  'use strict';

  // ========================================================== 1. 상수 / 기본값
  const PT = 0.3528;                 // pt -> mm
  // 도면 글꼴은 KoPub돋움체 Bold 로 고정 (app.css 의 @font-face 'EcoFont' = 설치된 KoPub돋움체 Bold, 없으면 static/fonts 의 파일)
  const FONT = '"EcoFont","KoPub돋움체 Bold","KoPubDotum Bold","KoPub Dotum Bold","Malgun Gothic",sans-serif';
  const LEN_OPTS = (() => { const a = [0.1, 0.2, 0.3, 0.4, 0.5]; for (let v = 1; v <= 200.001; v += 0.5) a.push(Math.round(v * 10) / 10); return a; })();   // 축척바 길이(km): 0.5 미만은 0.1 단위, 이상은 0.5 단위
  const PX96 = App.PX_PER_MM96;

  function defaults() {
    return {
      pw: 297, ph: 210, margin: 10, dpi: 200, frame: true,
      scale: 5000, center: null,          // scale: 내부 계산용(화면 확대/축소로 자동 결정, 입력란 없음)
      els: {
        north: { show: true, x: null, y: null, size: 18, buf: 0.8 },
        scalebar: { show: true, x: null, y: null, buf: 2.4, size: 100 },
        legend: { show: true, x: null, y: null, font: 9, size: 100, buf: 2.2, all: false },
        areatext: { show: true, x: null, y: null, font: 9 },
      },
    };
  }
  let L = defaults();
  function loadLayout() {
    try {
      const s = JSON.parse(localStorage.getItem('ecoLayout3') || 'null');
      if (!s) return;
      const d = defaults();
      const els = Object.assign({}, d.els);
      for (const k of Object.keys(els)) els[k] = Object.assign({}, d.els[k], (s.els || {})[k] || {});
      L = Object.assign(d, { pw: s.pw, ph: s.ph, margin: s.margin, dpi: s.dpi, frame: s.frame, scale: s.scale, center: s.center }, { els });
      ['pw', 'ph', 'margin', 'dpi', 'scale'].forEach(k => { if (!isFinite(Number(L[k])) || L[k] === null) L[k] = d[k]; });
    } catch (e) { L = defaults(); }
  }
  let saveTimer = null;
  function saveLayout() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => localStorage.setItem('ecoLayout3', JSON.stringify(L)), 200);
  }

  function dims() {
    return { W: Math.max(30, Number(L.pw) || 297), H: Math.max(30, Number(L.ph) || 210) };
  }
  // 하단 면적 문구 줄 (사업지구 등 구분별 한 줄)
  function areaLines() {
    if (App.theme === 'prot') {          // 보호구역 도면: 최근접 거리
      const rs = App.protRows ? App.protRows() : [];
      if (!rs.length) return ['최근접 거리 : -'];
      const parts = rs.map(r => `${r.name} ${r.dist === 0 ? '0.00km(중첩)' : App.fmtDist(r.dist)}`);
      const out = []; for (let i = 0; i < parts.length; i += 4) out.push((i ? '' : '최근접 거리 : ') + parts.slice(i, i + 4).join('   '));
      return out;
    }
    if (App.theme === 'ecvam') {         // 국토환경성평가지도: 등급별 면적
      const er = App.ecvamResult && App.ecvamResult();
      const GE = App.ECVAM_GRADES || [];
      if (!er) return [GE.map(g => g.label + ' 면적 : -').join('   ')];
      return er.rows.map(r => (er.rows.length > 1 ? '[' + r.category + ']  ' : '') + GE.map(g => g.label + ' 면적 : ' + Math.round(r.areas[g.key]).toLocaleString('en-US') + '㎡').join('   '));
    }
    const m = App.tableModel();
    const G = [['1', '1등급'], ['2', '2등급'], ['3', '3등급']];
    const f = v => Math.round(v).toLocaleString('en-US') + '㎡';
    if (!m) return ['1등급 면적 : -   2등급 면적 : -   3등급 면적 : -'];
    return m.rows.map(r => {
      const val = k => { const i = m.cols.findIndex(c => c.key === k); return i >= 0 ? r.vals[i] : 0; };
      let t = G.map(([k, n]) => n + ' 면적 : ' + f(val(k))).join('   ');
      const ni = m.cols.findIndex(c => c.key === 'none');
      if (ni >= 0) t += '   등급 없음 : ' + f(r.vals[ni]);
      return (m.rows.length > 1 ? '[' + r.category + ']  ' : '') + t;
    });
  }
  function areaBlockH() {
    const c = L.els.areatext;
    return c.show ? areaLines().length * c.font * PT * 1.5 + 2 : 0;
  }
  function mapRectMm() {
    const { W, H } = dims(); const m = Math.max(0, Number(L.margin) || 0);
    return { x: m, y: m, w: W - 2 * m, h: Math.max(10, H - 2 * m - areaBlockH()) };
  }

  // ========================================================== 2. 요소 그리기 (미리보기/내보내기 공용)
  function setFont(ctx, pt) { ctx.font = `${(pt * PT).toFixed(4)}px ${FONT}`; }
  function textW(ctx, t, pt, bold) { setFont(ctx, pt, bold); return ctx.measureText(t).width; }
  function haloText(ctx, t, x, y, pt, bold) {
    setFont(ctx, pt, bold);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    ctx.lineWidth = pt * PT * 0.3; ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeText(t, x, y);
    ctx.fillStyle = '#000'; ctx.fillText(t, x, y);
  }
  function autoLen(targetKm) {   // 목록 중 목표 길이에 가장 가까운 값
    let best = LEN_OPTS[0], bd = Infinity;
    LEN_OPTS.forEach(v => { const d = Math.abs(Math.log(v / Math.max(targetKm, 1e-6))); if (d < bd) { bd = d; best = v; } });
    return best;
  }
  const numTxt = v => String(parseFloat(v.toFixed(3)));

  function legendGrades(c) {
    const m = App.tableModel();
    if (c && c.all) return [{ key: '1', label: '1등급' }, { key: '2', label: '2등급' }, { key: '3', label: '3등급' }, { key: '9', label: '별도관리지역' }];   // 자료에 없는 등급도 표시
    const has9 = !!(App.area && (App.area.has9 || (App.area.gradeKeys || []).includes('9')));   // 별도관리지역: 면적표엔 없지만 도면에 보이면 범례에 표시
    if (m) { const ks = m.cols.filter(c => c.key !== 'none' && ((App.area.gradeKeys || []).includes(c.key) || (c.key === '3' && App.opts.rest3))); if (has9) ks.push({ key: '9', label: '별도관리지역' }); return ks; }
    const keys = m ? [] : [{ key: '1', label: '1등급' }, { key: '2', label: '2등급' }, { key: '3', label: '3등급' }, { key: '9', label: '별도관리지역' }];
    return keys;
  }

  // 각 요소: 크기를 계산하고 draw(x,y) 를 돌려준다 (단위 mm)
  const BUILD = {
    // 방위표: 8방위 나침반(고정). 꼭짓점마다 반쪽은 검정, 반쪽은 흰색. 별과 글자 둘레의 흰 테두리(버퍼) 두께를 buf(mm)로 조절
    north(ctx, c) {
      const S = Math.max(6, Number(c.size) || 18);
      const bufN = Number(c.buf);
      const buf = isFinite(bufN) ? Math.max(0, bufN) : 0.8;
      const T = S + 2 * buf;
      return {
        w: T, h: T,
        draw(x, y) {
          const cx = x + T / 2, cy = y + T / 2, lh = S * 0.105, R = S / 2 - lh * 1.35, ri = R * 0.36, rd = R * 0.6;
          const P = (a, r) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
          const D = Math.PI / 180;
          const ptsOuter = k => P(k * 45 * D, k % 2 === 0 ? R : rd);
          const sil = new Path2D();
          for (let k = 0; k < 8; k++) {
            const o = ptsOuter(k), i2 = P((k * 45 + 22.5) * D, ri);
            if (k === 0) sil.moveTo(o[0], o[1]); else sil.lineTo(o[0], o[1]);
            sil.lineTo(i2[0], i2[1]);
          }
          sil.closePath();
          const letters = [['N', 0, -1, 0], ['E', 1, 0, 0], ['S', 0, 1, 0], ['W', -1, 0, 0]];
          const lr = R + lh * 0.62;
          ctx.save();
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          setFont(ctx, lh / PT);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (buf > 0) {             // 흰색 버퍼(할로): 별 + 글자 둘레
            ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = buf * 2;
            ctx.fill(sil); ctx.stroke(sil);
            letters.forEach(l => ctx.strokeText(l[0], cx + l[1] * lr, cy + l[2] * lr));
          }
          // 꼭짓점 반쪽씩: 바깥쪽을 보았을 때 왼쪽(반시계) 반쪽은 검정, 오른쪽 반쪽은 흰색
          ctx.lineWidth = Math.max(0.08, S * 0.006); ctx.strokeStyle = '#000'; ctx.lineJoin = 'miter';
          for (let k = 0; k < 8; k++) {
            const o = ptsOuter(k), iL = P((k * 45 - 22.5) * D, ri), iR = P((k * 45 + 22.5) * D, ri);
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(o[0], o[1]); ctx.lineTo(iR[0], iR[1]); ctx.closePath();
            ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(o[0], o[1]); ctx.lineTo(iL[0], iL[1]); ctx.closePath();
            ctx.fillStyle = '#000'; ctx.fill(); ctx.stroke();
          }
          ctx.fillStyle = '#000';
          letters.forEach(l => ctx.fillText(l[0], cx + l[1] * lr, cy + l[2] * lr));
          ctx.restore();
        },
      };
    },
    // 축척바: 흰 박스 + 위쪽 숫자(0.0 / 2.0 / 4.0 km) + 위아래 어긋난 흑백 2단 막대. 길이는 0.5km 미만 0.1km 단위, 이상 0.5km 단위
    scalebar(ctx, cIn, env) {
      // 글자·막대 크기는 용지 크기에 비례해 자동 (A4 기준 9pt, 막대 4mm)
      const z = Math.max(0.3, (Number(cIn.size) || 100) / 100);         // 축척바 크기(%)
      const k = Math.min(env.W, env.H) / 210 * z;
      const c = { len: 'auto', div: 2, h: Math.max(1, 4 * k), font: Math.min(28, Math.max(4, 11 * k)) };
      const bf = Number(cIn.buf);
      const N = env.N, fmm = c.font * PT, pad = isFinite(bf) && cIn.buf !== null && cIn.buf !== '' ? Math.max(0.3, bf) : 2.4 * Math.max(0.7, k), gap = 1.2 * Math.max(0.7, k);
      const maxKm = env.mapRect.w * N / 1e6 * z;
      const km = (c.len === 'auto' || c.len == null || c.len === '') ? autoLen(maxKm / 4) : (Number(c.len) || 0.5);
      const lenMm = km * 1e6 / N;
      const d = Math.min(10, Math.max(1, Math.round(Number(c.div) || 2))), bh = Math.max(1, Number(c.h) || 4);
      const step = km / d;
      // 숫자는 소수 첫째 자리까지 (0.0 / 2.0 / 4.0), 중간값이 0.25 처럼 더 필요하면 그만큼만 늘림
      const fmtKm = v => { for (const k of [1, 2, 3]) { const s = v * Math.pow(10, k); if (Math.abs(s - Math.round(s)) < 1e-6) return v.toFixed(k); } return v.toFixed(3); };
      const labels = [];
      for (let i = 0; i <= d; i++) labels.push(fmtKm(step * i));
      const w0 = textW(ctx, labels[0], c.font), wl = textW(ctx, labels[d], c.font), wu = textW(ctx, 'km', c.font), sp = textW(ctx, ' ', c.font);
      const left = w0 / 2 + pad;
      const right = wl / 2 + sp + wu + pad;
      const w = left + lenMm + right, h = pad * 2 + fmm * 1.25 + gap + bh;
      return {
        w, h,
        draw(x, y) {
          ctx.save();
          ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
          ctx.lineWidth = 0.35; ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, h);
          const x0 = x + left, y0 = y + pad + fmm * 1.25 + gap, rh = bh / 2;
          ctx.lineWidth = 0.25; ctx.lineJoin = 'miter';
          for (let i = 0; i < d; i++) {
            const sx = x0 + lenMm * i / d, sw = lenMm / d;
            ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff'; ctx.fillRect(sx, y0, sw, rh); ctx.strokeRect(sx, y0, sw, rh);
            ctx.fillStyle = i % 2 === 0 ? '#fff' : '#000'; ctx.fillRect(sx, y0 + rh, sw, rh); ctx.strokeRect(sx, y0 + rh, sw, rh);
          }
          setFont(ctx, c.font); ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
          labels.forEach((t, i) => ctx.fillText(t, x0 + lenMm * i / d, y + pad));
          ctx.textAlign = 'left';
          ctx.fillText('km', x0 + lenMm + wl / 2 + sp, y + pad);
          ctx.restore();
        },
      };
    },
    legend(ctx, c) {
      const z = Math.max(0.3, (Number(c.size) || 100) / 100);         // 범례 자체 크기(%)
      const lbf = Number(c.buf);
      const f = c.font, fmm = f * PT, pad = (isFinite(lbf) && c.buf !== null && c.buf !== '' ? Math.max(0.3, lbf) : 2.2) * z, rowH = Math.max(fmm * 1.2, fmm * 1.7 * z), sw = 7 * z;
      const grades = App.theme === 'eco' ? legendGrades(c) : [];
      const egrades = App.theme === 'ecvam' ? (App.ECVAM_GRADES || []) : [];
      const cats = App.CATS.filter(k => App.sites.some(s => s.category === k && s.geometry));
      const rows = [{ t: '범 례', head: true }];
      grades.forEach(g => rows.push({ t: g.label, grade: g.key }));
      egrades.forEach(g => rows.push({ t: g.label, ecolor: g.color }));
      const hide = App.opts.legendHide || {};   // 범례에서 뺄 항목 (도면 출력 > 표시 이름·크기·색)
      cats.filter(k => !hide['cat:' + k]).forEach(k => rows.push({ t: k, cat: k }));
      (App.theme === 'prot' && App.protLegend ? App.protLegend() : []).filter(p => !hide['p:' + p.id]).forEach(p => { const lk = App.protLook(p); rows.push({ t: lk.name, prot: Object.assign({}, p, { color: lk.color }) }); });
      if (App.opts.adm && App.src.admin.getFeatures().length && !hide.adm) { const al = App.admLook(); rows.push({ t: al.name, adm: al.color }); }
      let tw = 0;
      rows.forEach(r => { tw = Math.max(tw, textW(ctx, r.t, f, !!r.head)); });
      const w = pad * 2 + (rows.length > 1 ? sw + 2 * z : 0) + tw, h = pad * 2 + rows.length * rowH;
      return {
        w, h,
        draw(x, y) {
          ctx.save();
          ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
          ctx.lineWidth = 0.25; ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, h);
          rows.forEach((r, i) => {
            const ry = y + pad + i * rowH, ty = ry + (rowH - fmm) / 2;
            setFont(ctx, f, !!r.head); ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
            if (r.head) { ctx.fillText(r.t, x + pad, ty); return; }
            const bx = x + pad, by = ry + rowH * 0.15, bh = rowH * 0.7;
            if (r.ecolor) {
              ctx.fillStyle = r.ecolor; ctx.fillRect(bx, by, sw, bh);
              ctx.lineWidth = 0.15; ctx.strokeStyle = '#555'; ctx.strokeRect(bx, by, sw, bh);
            } else if (r.adm) {
              ctx.strokeStyle = r.adm; ctx.lineWidth = Math.max(0.3, bh * 0.18); ctx.setLineDash([2.2, 0.8, 0.5, 0.8]);
              ctx.beginPath(); ctx.moveTo(bx, by + bh / 2); ctx.lineTo(bx + sw, by + bh / 2); ctx.stroke(); ctx.setLineDash([]);
            } else if (r.prot && r.prot.line) {
              ctx.strokeStyle = r.prot.color; ctx.lineWidth = Math.max(0.4, bh * 0.35); ctx.setLineDash([]);
              ctx.beginPath(); ctx.moveTo(bx, by + bh / 2); ctx.lineTo(bx + sw, by + bh / 2); ctx.stroke();
            } else if (r.prot) {
              const n = parseInt(r.prot.color.slice(1), 16);
              ctx.fillStyle = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.18)`; ctx.fillRect(bx, by, sw, bh);
              ctx.lineWidth = 0.35; ctx.strokeStyle = r.prot.color; ctx.setLineDash([1.2, 0.8]); ctx.strokeRect(bx, by, sw, bh); ctx.setLineDash([]);
            } else if (r.grade) {
              ctx.fillStyle = App.GRADE_COLOR[r.grade] || '#bbb'; ctx.fillRect(bx, by, sw, bh);
              ctx.lineWidth = 0.15; ctx.strokeStyle = '#555'; ctx.strokeRect(bx, by, sw, bh);
            } else {
              const st = App.catStyle[r.cat], lw = st.width / PX96;
              ctx.strokeStyle = st.color; ctx.lineWidth = lw;
              ctx.setLineDash(App.dashArr(st.dash, lw) || []);
              ctx.beginPath(); ctx.moveTo(bx, ry + rowH / 2); ctx.lineTo(bx + sw, ry + rowH / 2); ctx.stroke();
              ctx.setLineDash([]);
            }
            setFont(ctx, f, false); ctx.fillStyle = '#000';
            ctx.fillText(r.t, bx + sw + 2 * z, ty);
          });
          ctx.restore();
        },
      };
    },
    // 하단 면적 문구: "1등급 면적 : … ㎡   2등급 면적 : …"
    areatext(ctx, c) {
      const lines = areaLines(), lh = c.font * PT * 1.5;
      let w = 0; lines.forEach(t => { w = Math.max(w, textW(ctx, t, c.font)); });
      return {
        w, h: lines.length * lh,
        draw(x, y) {
          ctx.save(); setFont(ctx, c.font); ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
          lines.forEach((t, i) => ctx.fillText(t, x, y + i * lh + c.font * PT * 0.25));
          ctx.restore();
        },
      };
    },
  };
  const POS_ORDER = ['north', 'scalebar', 'legend', 'areatext'];
  const Z_ORDER = ['legend', 'scalebar', 'north', 'areatext'];
  const EL_NAMES = { north: '방위표', scalebar: '축척바', legend: '범례', areatext: '하단 표기 (면적·거리)' };

  function defaultPos(key, b, W, H, m) {
    const g = 3, mr = mapRectMm();
    switch (key) {
      case 'north': return [mr.x + mr.w - b.w - g, mr.y + g];
      case 'scalebar': return [mr.x + g, mr.y + mr.h - b.h - g];
      case 'legend': return [mr.x + mr.w - b.w - g, mr.y + mr.h - b.h - g];
      case 'areatext': return [mr.x, mr.y + mr.h + 1.5];
    }
    return [m, m];
  }

  /* 미리보기와 내보내기가 공용으로 쓰는 단 하나의 오버레이 그리기 함수.
   * ctx: 대상 캔버스 컨텍스트, pxPerMm: 용지 mm 당 캔버스 픽셀, opts: {L,W,H,mapRect,preview,write,selected}
   * 반환: 요소별 bbox(mm) */
  function drawOverlay(ctx, pxPerMm, opts) {
    const cfg = opts.L, W = opts.W, H = opts.H, m = Math.max(0, Number(cfg.margin) || 0);
    ctx.save();
    ctx.setTransform(pxPerMm, 0, 0, pxPerMm, 0, 0);
    if (cfg.frame) {
      ctx.lineWidth = 0.35; ctx.strokeStyle = '#000';
      const fr = opts.mapRect; ctx.strokeRect(fr.x, fr.y, fr.w, fr.h);
    }
    const env = { N: cfg.scale, mapRect: opts.mapRect, tm: App.tableModel(), W, H };
    const built = {}, boxes = {};
    POS_ORDER.forEach(key => {
      const c = cfg.els[key];
      if (!c.show) return;
      const b = BUILD[key](ctx, c, env);
      let x = c.x, y = c.y;
      if (x == null || y == null) {
        const p = defaultPos(key, b, W, H, m);
        x = p[0]; y = p[1];
        if (opts.write) { c.x = Math.round(x * 10) / 10; c.y = Math.round(y * 10) / 10; x = c.x; y = c.y; }
      }
      built[key] = b;
      boxes[key] = { x, y, w: b.w, h: b.h };
    });
    Z_ORDER.forEach(key => { if (built[key]) built[key].draw(boxes[key].x, boxes[key].y); });
    if (opts.preview && opts.selected && boxes[opts.selected]) {
      const b = boxes[opts.selected];
      ctx.save();
      ctx.setLineDash([1.5, 1]); ctx.lineWidth = 0.3; ctx.strokeStyle = '#0b6e69';
      ctx.strokeRect(b.x - 0.5, b.y - 0.5, b.w + 1, b.h + 1);
      ctx.restore();
    }
    ctx.restore();
    return boxes;
  }
  App.drawOverlay = drawOverlay;

  // ========================================================== 3. 미리보기 지도 / 용지
  let active = false, map = null, set = null, ppm = 3, previewScale = 1, boxes = {}, selected = null, applying = false;
  const paper = $('#paper'), paperMap = $('#paperMap'), overlay = $('#overlay'), wrap = $('#paperWrap');

  function ensureMap() {
    if (map) return;
    set = App.createLayerSet(() => previewScale, true);
    set.refresh();
    const c = L.center || (App.sitesExtent() ? ol.extent.getCenter(App.sitesExtent()) : ol.proj.fromLonLat([127.8, 36.3]));
    map = new ol.Map({
      target: paperMap, layers: set.layers, controls: [],
      interactions: ol.interaction.defaults.defaults({ mouseWheelZoom: true, doubleClickZoom: false, pinchZoom: false, altShiftDragRotate: false, pinchRotate: false, keyboard: false }),
      view: new ol.View({
        projection: 'EPSG:3857', center: c, resolution: 10, constrainResolution: false, smoothResolutionConstraint: false,
        minResolution: 0.001, maxResolution: 500000, enableRotation: false,
      }),
    });
    // 휠 확대/축소·드래그 이동 후: 현재 화면 배율을 내부 축척값으로 기억 (내보내기·축척바가 같은 값을 씀)
    map.on('moveend', () => {
      const v = map.getView(), c = v.getCenter();
      L.center = c.slice();
      if (!applying && c && v.getResolution()) {
        L.scale = v.getResolution() * ol.proj.getPointResolution('EPSG:3857', 1, c, 'm') * ppm * 1000;
      }
      saveLayout(); redraw();
    });
  }

  function layoutPaper() {
    if (!active) return;
    const { W, H } = dims(), mr = mapRectMm();
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (cw < 50 || ch < 50) return;
    ppm = Math.max(0.2, Math.min((cw - 48) / W, (ch - 48) / H));
    previewScale = ppm / PX96;
    paper.style.width = (W * ppm) + 'px'; paper.style.height = (H * ppm) + 'px';
    Object.assign(paperMap.style, { left: mr.x * ppm + 'px', top: mr.y * ppm + 'px', width: mr.w * ppm + 'px', height: mr.h * ppm + 'px' });
    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.round(W * ppm * dpr); overlay.height = Math.round(H * ppm * dpr);
    overlay.style.width = (W * ppm) + 'px'; overlay.style.height = (H * ppm) + 'px';
    map.updateSize();
    applyScale();
    if (set) set.changed();
    redraw();
  }

  // 축척 적용: 지도 위 1mm = N/1000 m (중심 위도 보정). 이미 맞으면 아무 것도 하지 않아 moveend 루프가 생기지 않는다.
  function applyScale() {
    if (!map || applying || !active) return;
    const view = map.getView(), c = view.getCenter();
    if (!c) return;
    const groundRes = Number(L.scale) / 1000 / ppm;
    const res = groundRes / ol.proj.getPointResolution('EPSG:3857', 1, c, 'm');
    const cur = view.getResolution();
    if (cur && Math.abs(cur - res) / res < 1e-7) return;
    applying = true;
    view.setResolution(res);
    applying = false;
    redraw();
  }
  function fitToSites() {
    const e = App.sitesExtent();
    if (!e) return App.toast('먼저 도면을 추가하세요.', 'warn');
    const c = ol.extent.getCenter(e), pr = ol.proj.getPointResolution('EPSG:3857', 1, c, 'm');
    const mr = mapRectMm();
    const wm = (e[2] - e[0]) * pr, hm = (e[3] - e[1]) * pr;
    const need = Math.max(wm * 1000 / (0.9 * mr.w), hm * 1000 / (0.9 * mr.h), 100);
    const n = Math.ceil(need);
    L.center = c.slice(); L.scale = n; saveLayout();
    if (map) { map.getView().setCenter(c); applyScale(); redraw(); }
  }

  // ========================================================== 4. 오버레이 갱신 / 요소 드래그
  // ---------------------------------------------------- 표시 이름·크기·색 / 화살표 미세조정
  let styleSig = null;
  const openArr = new Set();   // 미세조정 칸이 열린 화살표
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function arrowFeats() { return App.src.arrows.getFeatures().filter(f => f.get('theme') === App.theme); }
  function buildStyleUI(force) {
    const box = $('#styleBox'); if (!box) return;
    const kinds = App.theme === 'prot' && App.protLegend ? App.protLegend() : [];
    const arrs = arrowFeats();
    const adm = !!App.opts.adm && App.src.admin.getFeatures().length > 0;
    const sites = App.sites.filter(s => s.geometry);
    const sig = [App.theme, kinds.map(p => p.id).join(','), arrs.map(f => f.get('key') + f.get('label')).join(','), adm, sites.map(s => s.id + s.name + s.category).join(',')].join('#');
    if (!force && sig === styleSig) return;
    if (!force && box.contains(document.activeElement)) return;      // 입력 중에는 다시 그리지 않음
    styleSig = sig;
    const lg = k => `<input type="checkbox" data-lg="${esc(k)}" ${(App.opts.legendHide || {})[k] ? '' : 'checked'} title="범례에 표시">`;
    const row = (sk, name, color, pt, ph) => `<div class="sty-row">
        ${lg(sk === 'adm' ? 'adm' : 'p:' + sk)}
        <input type="color" data-sk="${sk}" data-f="color" value="${color}" title="색">
        <input type="text" data-sk="${sk}" data-f="name" value="${esc(name)}" placeholder="${esc(ph)}" title="범례 이름">
        <input type="number" step="0.5" min="4" data-sk="${sk}" data-f="pt" value="${pt}" title="지도 명칭 글자 크기(pt)"><span class="unit">pt</span></div>`;
    let h = '';
    if (sites.length) {
      h += '<div class="sty-sub">도면 구분·투명도 <small>(앞 체크: 범례에 표시)</small></div>';
      sites.forEach(s => { const v = Math.round((s.opacity == null ? 1 : Number(s.opacity)) * 100); h += `<div class="slider site-op">${lg('cat:' + s.category)}<span class="site-cat"><select data-sitecat="${s.id}" title="도면 구분 (범례 이름)">${(App.CATS || []).map(c => `<option ${c === s.category ? 'selected' : ''}>${c}</option>`).join('')}</select><small title="${esc(s.name)}">${esc(s.name)}</small></span><input type="range" min="0" max="100" step="5" data-siteop="${s.id}" value="${v}"><span class="pct-box"><input type="number" min="0" max="100" step="5" data-siteop="${s.id}" value="${v}"><span>%</span></span></div>`; });
    }
    if (kinds.length || adm) {
      h += '<div class="sty-head"><span title="범례에 표시">✓</span><span>색</span><span>범례 이름</span><span>명칭 크기</span></div>';
      kinds.forEach(p => { const c = (App.opts.protCustom || {})[p.id] || {}; const lk = App.protLook(p); h += row(p.id, c.name || '', lk.color, lk.pt, p.short); });
      if (adm) { const c = App.opts.admCustom || {}; const al = App.admLook(); h += row('adm', c.name || '', al.color, al.pt, '행정구역 경계'); }
    }
    const step = (k, f, lbl, a, b, inc = 0.5) => `<div class="stepper"><span class="lbl">${lbl}</span><button type="button" data-ak="${esc(k)}" data-af="${f}" data-step="${-inc}">${a}</button><input type="number" step="0.5" data-ak="${esc(k)}" data-af="${f}" value="${((App.opts.arrowAdj || {})[k] || {})[f] || (f === 'len' || f === 'w' ? 100 : 0)}"><button type="button" data-ak="${esc(k)}" data-af="${f}" data-step="${inc}">${b}</button></div>`;
    if (arrs.length) {
      // 화살표: 보호구역 결과처럼 구분별로 묶고 가까운 순. 줄의 '조정'을 누르면 미세조정 칸이 열림
      const dOf = k => { if (k === 'eco1') return App.eco1 ? App.eco1.dist : 0; const r = (App.protRows ? App.protRows() : []).find(x => x.key === k); return r ? r.dist : Infinity; };
      const groups = new Map();
      arrs.forEach(f => { const k = f.get('key'), kind = k === 'eco1' ? 'eco1' : k.split('|')[0]; if (!groups.has(kind)) groups.set(kind, []); groups.get(kind).push(f); });
      const glist = [...groups.entries()].map(([kind, fs]) => ({ kind, fs: fs.slice().sort((a, b) => dOf(a.get('key')) - dOf(b.get('key'))) }))
        .sort((a, b) => dOf(a.fs[0].get('key')) - dOf(b.fs[0].get('key')));
      h += '<div class="sty-sub">화살표 <span class="bulk"><button type="button" class="btn small" data-aall="1">전체 선택</button><button type="button" class="btn small" data-aall="0">전체 해제</button></span></div><ul class="bullets"><li>체크: 화살표 켜기/끄기 (구분 체크는 묶음 전체)</li><li>조정: 위치 0.5mm, 길이·굵기 5%, 회전 1°씩 (Shift: 10배)</li></ul><div class="ar-list">';
      glist.forEach(g => {
        const p = (App.PROT || []).find(x => x.id === g.kind);
        const col = p ? App.protLook(p).color : '#1AA800', gname = p ? App.protLook(p).name : '생태자연도 1등급';
        const nOn = g.fs.filter(f => f.get('on') !== false).length;
        h += `<div class="ar-group"><div class="ar-gh"><input type="checkbox" data-agrp="${esc(g.kind)}" ${nOn === g.fs.length ? 'checked' : ''} ${nOn > 0 && nOn < g.fs.length ? 'data-ind="1"' : ''}>
          <span class="swatch${p && p.line ? ' swatch-line' : ''}" style="border-color:${col};background:${p && p.line ? 'transparent' : col + '2e'}"></span><b>${esc(gname)}</b><span class="pr-cnt">${g.fs.length}곳</span></div>`;
        g.fs.forEach(f => {
          const k = f.get('key'), a = (App.opts.arrowAdj || {})[k] || {};
          const nm = k === 'eco1' ? '1등급' : (k.split('|')[1] || k);
          const adjd = Object.keys(a).some(x => a[x] != null && a[x] !== '' && !(x === 'len' && +a[x] === 100) && !(x === 'w' && +a[x] === 100) && +a[x] !== 0);
          h += `<div class="ar-row"><input type="checkbox" data-aon="${esc(k)}" ${f.get('on') !== false ? 'checked' : ''}>
            <span class="ar-name">${esc(nm)}</span><span class="ar-dist">${esc((f.get('label') || '').replace(/\s*이격$/, ''))}</span>
            <button type="button" class="btn small ar-adj${adjd ? ' on' : ''}" data-aopen="${esc(k)}">조정</button></div>
            <div class="ar-panel el-body" data-apanel="${esc(k)}" ${openArr.has(k) ? '' : 'hidden'}>
            <label class="field full"><span>글자</span><input type="text" data-ak="${esc(k)}" data-af="text" value="${esc(a.text || '')}" placeholder="${esc(f.get('label'))}"></label>
            <label class="field"><span>글자 크기(pt)</span><input type="number" step="0.5" min="4" data-ak="${esc(k)}" data-af="size" value="${a.size || ''}" placeholder="10.5"></label>
            <div class="sty-sub full">화살표 모양</div>
            <div class="pos-row full">${step(k, 'len', '길이', '－', '＋', 5)}${step(k, 'w', '굵기', '－', '＋', 5)}<span class="unit">%</span></div>
            <div class="pos-row full">${step(k, 'rot', '회전', '↺', '↻', 1)}<span class="unit">° (시계 방향 +)</span></div>
            <div class="sty-sub full">화살표 위치</div>
            <div class="pos-row full">${step(k, 'sx', 'X', '◀', '▶')}${step(k, 'sy', 'Y', '▲', '▼')}<span class="unit">mm</span></div>
            <div class="sty-sub full">글자 위치</div>
            <div class="pos-row full">${step(k, 'lx', 'X', '◀', '▶')}${step(k, 'ly', 'Y', '▲', '▼')}<span class="unit">mm</span></div>
            <div class="row full"><button type="button" class="btn small" data-areset="${esc(k)}">이 화살표 초기화</button></div>
            </div>`;
        });
        h += '</div>';
      });
      h += '</div>';
    }
    setTimeout(() => box.querySelectorAll('[data-ind]').forEach(c => { c.indeterminate = true; }), 0);
    box.innerHTML = h || '<p class="hint">보호구역 검토를 실행하면 종류별 이름·색·크기와 화살표를 조정할 수 있습니다.</p>';
    $('#styleSection').hidden = !h && App.theme !== 'prot';
  }
  // 화살표 켜기/끄기: 보호구역은 결과표 체크와 같이, 생태자연도는 1등급 체크와 같이
  function setArrowOn(key, on) {
    if (App.theme === 'prot' && App.protSetArrow) App.protSetArrow(key, on);
    else {
      App.src.arrows.getFeatures().filter(f => f.get('key') === key).forEach(f => f.set('on', on));
      if (key === 'eco1') { const c = document.getElementById('eco1Chk'); if (c) c.checked = on; }
    }
    App.liveSets.forEach(s => s.changed()); redraw();
  }
  function syncArrGroups() {
    const box = $('#styleBox'); if (!box) return;
    box.querySelectorAll('[data-agrp]').forEach(g => {
      const cs = [...box.querySelectorAll('[data-aon]')].filter(c => (c.dataset.aon === 'eco1' ? 'eco1' : c.dataset.aon.split('|')[0]) === g.dataset.agrp);
      const n = cs.filter(c => c.checked).length; g.checked = n === cs.length; g.indeterminate = n > 0 && n < cs.length;
    });
  }
  function initStyleUI() {
    const box = $('#styleBox'); if (!box) return;
    const changed = () => { App.saveOpts(); App.liveSets.forEach(s => s.changed()); redraw(); };
    box.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.siteop) {
        const s = App.sites.find(x => String(x.id) === t.dataset.siteop); if (!s) return;
        s.opacity = Math.max(0, Math.min(100, Number(t.value) || 0)) / 100;
        box.querySelectorAll(`[data-siteop="${t.dataset.siteop}"]`).forEach(o => { if (o !== t) o.value = Math.round(s.opacity * 100); });
        App.liveSets.forEach(x => x.changed()); redraw(); return;
      }
      if (t.dataset.sk) {
        const sk = t.dataset.sk, f = t.dataset.f;
        const tgt = sk === 'adm' ? (App.opts.admCustom = App.opts.admCustom || {}) : ((App.opts.protCustom = App.opts.protCustom || {})[sk] = (App.opts.protCustom[sk] || {}));
        if (f === 'pt') tgt.pt = Number(t.value) || null; else tgt[f] = t.value;
        changed(); return;
      }
      if (t.dataset.ak) {
        const k = t.dataset.ak, f = t.dataset.af;
        const a = (App.opts.arrowAdj = App.opts.arrowAdj || {})[k] = (App.opts.arrowAdj[k] || {});
        if (f === 'text') a.text = t.value; else a[f] = t.value === '' ? null : Number(t.value);
        changed();
      }
    });
    let timer = null;
    const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
    const bump = (btn, big) => {
      const k = btn.dataset.ak, f = btn.dataset.af;
      const a = (App.opts.arrowAdj = App.opts.arrowAdj || {})[k] = (App.opts.arrowAdj[k] || {});
      const base = Number(a[f]) || (f === 'len' || f === 'w' ? 100 : 0);
      a[f] = Math.round((base + Number(btn.dataset.step) * (big ? 10 : 1)) * 10) / 10;
      if (f === 'len' || f === 'w') a[f] = Math.max(10, Math.min(400, a[f]));
      if (f === 'rot') a[f] = ((a[f] + 180) % 360 + 360) % 360 - 180;
      const inp = box.querySelector(`input[data-ak="${CSS.escape(k)}"][data-af="${f}"]`); if (inp) inp.value = a[f];
      changed();
    };
    box.addEventListener('pointerdown', e => {
      const btn = e.target.closest('button[data-ak]'); if (!btn) return;
      e.preventDefault(); const big = e.shiftKey; bump(btn, big);
      timer = setTimeout(() => { timer = setInterval(() => bump(btn, big), 80); }, 350);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => document.addEventListener(ev, stop));
    box.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.lg) { App.opts.legendHide = App.opts.legendHide || {}; if (t.checked) delete App.opts.legendHide[t.dataset.lg]; else App.opts.legendHide[t.dataset.lg] = true; App.saveOpts(); redraw(); }
      if (t.dataset.aon) { setArrowOn(t.dataset.aon, t.checked); syncArrGroups(); }
      if (t.dataset.agrp) { const on = t.checked; arrowFeats().filter(f => (f.get('key') === 'eco1' ? 'eco1' : f.get('key').split('|')[0]) === t.dataset.agrp).forEach(f => { setArrowOn(f.get('key'), on); const c = box.querySelector(`[data-aon="${CSS.escape(f.get('key'))}"]`); if (c) c.checked = on; }); syncArrGroups(); }
      if (t.dataset.sitecat) { const s = App.sites.find(x => String(x.id) === t.dataset.sitecat); if (s) { s.category = t.value; if (s.feature) s.feature.set('category', s.category); App.renderSiteCard && App.renderSiteCard(s); App.liveSets.forEach(x => x.changed()); styleSig = null; App.emit(); redraw(); } }
    });
    box.addEventListener('click', e => {
      const all = e.target.closest('[data-aall]');
      if (all) { const on = all.dataset.aall === '1'; arrowFeats().forEach(f => setArrowOn(f.get('key'), on)); box.querySelectorAll('[data-aon],[data-agrp]').forEach(c => { c.checked = on; c.indeterminate = false; }); return; }
      const op = e.target.closest('[data-aopen]');
      if (op) { const k = op.dataset.aopen, pn = box.querySelector(`[data-apanel="${CSS.escape(k)}"]`); if (pn) { pn.hidden = !pn.hidden; if (pn.hidden) openArr.delete(k); else openArr.add(k); } return; }
      const b = e.target.closest('[data-areset]'); if (!b) return;
      if (App.opts.arrowAdj) delete App.opts.arrowAdj[b.dataset.areset];
      changed(); buildStyleUI(true);
    });
  }

  function redraw() {
    if (!active || !map) return;
    buildStyleUI();
    const { W, H } = dims();
    const dpr = window.devicePixelRatio || 1;
    const ctx = overlay.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    boxes = drawOverlay(ctx, ppm * dpr, { L, W, H, mapRect: mapRectMm(), preview: true, write: true, selected });
    syncPos();
    saveLayout();
  }
  function syncPos() {
    $$('#elList [data-f="x"],#elList [data-f="y"]').forEach(inp => {
      if (document.activeElement === inp) return;
      const c = L.els[inp.dataset.el];
      const v = c[inp.dataset.f];
      inp.value = v == null ? '' : v;
    });
  }
  function hit(mx, my) {
    for (let i = Z_ORDER.length - 1; i >= 0; i--) {
      const k = Z_ORDER[i], b = boxes[k];
      if (b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return k;
    }
    return null;
  }
  function mmFromEvent(e) {
    const r = overlay.getBoundingClientRect();
    return [(e.clientX - r.left) / ppm, (e.clientY - r.top) / ppm];
  }
  // 미리보기 지도에서 보호구역 명칭 위치 근처(20px)를 눌렀는지
  function labelHit(e) {
    if (!map || !App.protLabelPoint) return null;
    const px = map.getEventPixel(e); let best = null, bd = 22;
    const fs = [];
    if (App.theme === 'prot' && App.opts.protLabel !== false) App.src.prot.getFeatures().forEach(f => { const p = (App.PROT || []).find(x => x.id === f.get('kind')); if (p && (App.opts.protShow || {})[p.id] !== false && (!p.labelNearest || f.get('labelMe'))) fs.push(f); });
    if (App.opts.adm && App.opts.admLabel !== false) App.src.admin.getFeatures().forEach(f => fs.push(f));
    fs.forEach(f => {
      const lp = f.get('kind') === 'adm' && App.admLabelPoint ? App.admLabelPoint(f, set) : App.protLabelPoint(f, set); if (!lp) return;
      const q = map.getPixelFromCoordinate(lp); if (!q) return;
      const d = Math.hypot(q[0] - px[0], q[1] - px[1]); if (d < bd) { bd = d; best = f; }
    });
    return best;
  }
  function initDrag() {
    let drag = null;
    // 캡처 단계에서 요소 위 클릭만 가로채고, 그 외에는 OL 이 지도 이동을 처리하도록 둔다
    paper.addEventListener('pointerdown', e => {
      if (!active || e.button !== 0) return;
      const [mx, my] = mmFromEvent(e);
      const k = hit(mx, my);
      if (!k) {
        // 보호구역 명칭 끌기 (명칭 근처를 누른 경우)
        const lf = labelHit(e);
        if (lf) { e.stopPropagation(); e.preventDefault(); drag = { label: lf }; return; }
        if (selected) { selected = null; redraw(); } return;
      }
      e.stopPropagation(); e.preventDefault();
      selected = k;
      const b = boxes[k];
      drag = { k, dx: mx - b.x, dy: my - b.y };
      redraw();
    }, true);
    window.addEventListener('pointermove', e => {
      if (drag && drag.label) {
        const px = map.getEventPixel(e); drag.label.set('labelPos', map.getCoordinateFromPixel(px));
        App.liveSets.forEach(s => s.changed()); e.preventDefault(); return;
      }
      if (drag) {
        const { W, H } = dims(); const [mx, my] = mmFromEvent(e); const b = boxes[drag.k]; if (!b) return;
        const c = L.els[drag.k];
        c.x = Math.round(Math.max(0, Math.min(W - b.w, mx - drag.dx)) * 10) / 10;
        c.y = Math.round(Math.max(0, Math.min(H - b.h, my - drag.dy)) * 10) / 10;
        redraw();
        e.preventDefault();
      } else if (active && e.target && paper.contains(e.target)) {
        const [mx, my] = mmFromEvent(e);
        paper.style.cursor = (hit(mx, my) || labelHit(e)) ? 'move' : '';
      }
    });
    window.addEventListener('pointerup', () => { drag = null; });
    // 명칭 두 번 누르기: 글자 바꾸기 (비우면 원래 이름)
    paper.addEventListener('dblclick', e => {
      if (!active) return;
      const lf = labelHit(e); if (!lf) return;
      e.stopPropagation(); e.preventDefault();
      const key = lf.get('kind') === 'adm' ? 'adm|' + lf.get('name') : App.protLabelKey(lf);
      App.opts.protLabelText = App.opts.protLabelText || {};
      const cur = App.opts.protLabelText[key] || lf.get('name') || '';
      const v = prompt('지도에 표시할 명칭 (비우면 원래 이름)', cur);
      if (v === null) return;
      if (v.trim() === '' || v === lf.get('name')) delete App.opts.protLabelText[key]; else App.opts.protLabelText[key] = v;
      App.saveOpts(); App.liveSets.forEach(s => s.changed()); redraw();
    }, true);
  }

  // ========================================================== 5. 설정 패널 UI
  const EL_UI = [
    ['north', [['size', '크기(mm)', 'number'], ['buf', '흰색 버퍼(mm)', 'number']]],
    ['scalebar', [['size', '축척바 크기(%)', 'number'], ['buf', '흰색 버퍼(mm)', 'number']]],
    ['legend', [['font', '글자 크기(pt)', 'number'], ['size', '범례 크기(%)', 'number'], ['buf', '흰색 버퍼(mm)', 'number'], ['all', '자료에 없는 등급도 표시', 'check']]],
    ['areatext', [['font', '글자 크기(pt)', 'number']]],
  ];
  const EL_HINT = { scalebar: ['길이·글자 크기는 도면 크기와 화면 배율에 맞춰 자동', '축척바 크기(%)로 전체를 줄이거나 키움', '0.5km 미만은 0.1km 단위', '0.5km 이상은 0.5km 단위'] };
  // X(좌우)는 ◀ ▶, Y(위아래)는 ▲ ▼ 버튼으로 1mm씩 (Shift 누르면 10mm)
  function posRow(key, c) {
    const val = v => (v == null ? '' : v);
    return `<div class="pos-row full">
      <div class="stepper"><span class="lbl">X</span><button type="button" data-el="${key}" data-axis="x" data-step="-1" title="왼쪽">◀</button><input type="number" step="any" data-el="${key}" data-f="x" value="${val(c.x)}"><button type="button" data-el="${key}" data-axis="x" data-step="1" title="오른쪽">▶</button></div>
      <div class="stepper"><span class="lbl">Y</span><button type="button" data-el="${key}" data-axis="y" data-step="-1" title="위">▲</button><input type="number" step="any" data-el="${key}" data-f="y" value="${val(c.y)}"><button type="button" data-el="${key}" data-axis="y" data-step="1" title="아래">▼</button></div>
      <span class="unit">mm</span></div>`;
  }
  function buildElUI() {
    $('#elList').innerHTML = EL_UI.map(([key, fields]) => {
      const c = L.els[key];
      const one = ([f, label, type, extra]) => {
        const v = c[f];
        if (type === 'check') return `<label class="check full"><input type="checkbox" data-el="${key}" data-f="${f}" ${v ? 'checked' : ''}> ${label}</label>`;
        if (type === 'select') return `<label class="field"><span>${label}</span><select data-el="${key}" data-f="${f}">${extra.map(o => `<option value="${o[0]}" ${String(v) === String(o[0]) ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>`;
        return `<label class="field ${type === 'text' ? 'full' : ''}"><span>${label}</span><input type="${type}" ${type === 'number' ? 'step="any"' : ''} data-el="${key}" data-f="${f}" value="${v == null ? '' : String(v).replace(/"/g, '&quot;')}"></label>`;
      };
      const main = fields.filter(f => f[2] !== 'check').map(one).join('');
      const checks = fields.filter(f => f[2] === 'check').map(one).join('');     // 체크박스는 맨 아래
      const hint = EL_HINT[key] ? `<ul class="bullets full">${EL_HINT[key].map(t => `<li>${t}</li>`).join('')}</ul>` : '';
      return `<details class="el-box"><summary><input type="checkbox" data-el="${key}" data-f="show" ${c.show ? 'checked' : ''}> ${EL_NAMES[key]}</summary><div class="el-body">${hint}${main}${posRow(key, c)}${checks}</div></details>`;
    }).join('');
  }
  // 위치 버튼: 누르고 있으면 계속 이동
  function initSteppers() {
    let timer = null;
    const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
    const bump = (btn, big) => {
      const key = btn.dataset.el, ax = btn.dataset.axis, c = L.els[key];
      if (c[ax] == null) redraw();                       // 기본 위치를 먼저 확정
      const cur = Number(c[ax]) || 0, d = Number(btn.dataset.step) * (big ? 10 : 1);
      const { W, H } = dims(), b = boxes[key] || { w: 0, h: 0 };
      const lim = ax === 'x' ? W - b.w : H - b.h;
      c[ax] = Math.round(Math.max(0, Math.min(lim, cur + d)) * 10) / 10;
      const inp = $(`#elList input[data-el="${key}"][data-f="${ax}"]`); if (inp) inp.value = c[ax];
      redraw();
    };
    $('#elList').addEventListener('pointerdown', e => {
      const btn = e.target.closest('button[data-step]'); if (!btn) return;
      e.preventDefault();
      const big = e.shiftKey;
      bump(btn, big);
      timer = setTimeout(() => { timer = setInterval(() => bump(btn, big), 60); }, 350);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => document.addEventListener(ev, stop));
  }
  function syncControls() {
    $('#paperW').value = L.pw; $('#paperH').value = L.ph;
    $('#marginMm').value = L.margin; $('#dpiSel').value = String(L.dpi);
    $('#frameChk').checked = !!L.frame;
  }
  function resetPositions() { Object.values(L.els).forEach(c => { c.x = null; c.y = null; }); buildElUI(); }

  function initControls() {
    initStyleUI();
    $('#layoutTheme').addEventListener('change', e => { App.setTheme(e.target.value); L.els.areatext.x = null; L.els.areatext.y = null; layoutPaper(); });
    $('#btnFit').addEventListener('click', fitToSites);

    const onPaper = () => {
      L.pw = Math.max(30, Number($('#paperW').value) || 297);
      L.ph = Math.max(30, Number($('#paperH').value) || 210);
      L.margin = Math.max(0, Number($('#marginMm').value) || 0);
      resetPositions();           // 크기가 바뀌면 요소를 기본 위치(지도틀 모서리)로 다시 배치
      saveLayout(); layoutPaper();
    };
    ['paperW', 'paperH', 'marginMm'].forEach(id => $('#' + id).addEventListener('change', onPaper));
    $('#btnSwap').addEventListener('click', () => { const w = L.pw; L.pw = L.ph; L.ph = w; syncControls(); resetPositions(); saveLayout(); layoutPaper(); });
    $('#dpiSel').addEventListener('change', e => { L.dpi = Number(e.target.value); saveLayout(); });
    $('#frameChk').addEventListener('change', e => { L.frame = e.target.checked; saveLayout(); redraw(); });

    $('#elList').addEventListener('input', e => {
      const t = e.target, key = t.dataset.el, f = t.dataset.f;
      if (!key || !f) return;
      const c = L.els[key];
      if (t.type === 'checkbox') c[f] = t.checked;
      else if (f === 'len') c[f] = t.value === 'auto' ? 'auto' : Number(t.value);
      else if (t.type === 'number') { c[f] = t.value === '' ? (f === 'x' || f === 'y' ? null : c[f]) : Number(t.value); if (f === 'buf' && c[f] < 0) c[f] = 0; }
      else c[f] = t.value;
      if (f === 'show' && !t.checked && selected === key) selected = null;
      if (key === 'areatext' && (f === 'show' || f === 'font')) { if (c.show) { c.x = null; c.y = null; } layoutPaper(); } else redraw();
    });
    $('#btnLayoutReset').addEventListener('click', () => {
      if (!confirm('도면 출력 설정을 기본값으로 되돌릴까요?')) return;
      const center = L.center; L = defaults(); L.center = center;
      syncControls(); buildElUI(); selected = null; layoutPaper();
    });
    $('#btnLabelReset').addEventListener('click', () => { App.src.prot.getFeatures().forEach(f => f.unset('labelPos')); App.src.admin.getFeatures().forEach(f => f.unset('labelPos')); App.liveSets.forEach(s => s.changed()); });
    $('#btnPng').addEventListener('click', () => doExport('png'));
    $('#btnPdf').addEventListener('click', () => doExport('pdf'));
    if (window.ResizeObserver) new ResizeObserver(() => layoutPaper()).observe(wrap);
    window.addEventListener('resize', layoutPaper);
  }

  // ========================================================== 6. 내보내기 (PNG / PDF)
  let exporting = false;
  function prog(msg) { const p = $('#exportProg'); p.hidden = !msg; p.textContent = msg || ''; }

  /* 화면 밖 OL 지도를 pixelRatio = DPI/96 으로 그려 .ol-layer canvas 들을 합성(OL 공식 export 예제 방식) 후 오버레이를 얹는다 */
  async function renderExport(proxy) {
    try { await document.fonts.load('12px EcoFont'); } catch (e) { /* 폰트 없으면 대체 글꼴 */ }
    const dpi = Number(L.dpi) || 200, { W, H } = dims(), mr = mapRectMm();
    const pr = dpi / 96;
    const pxW = Math.round(W / 25.4 * dpi), pxH = Math.round(H / 25.4 * dpi);
    const sw = Math.max(1, Math.round(mr.w * PX96)), sh = Math.max(1, Math.round(mr.h * PX96));   // 지도틀 CSS px
    const effPpm = sw / mr.w;                                                                 // 반올림 반영한 실제 px/mm
    const div = document.createElement('div');
    div.style.cssText = `position:absolute;left:-20000px;top:0;width:${sw}px;height:${sh}px;`;
    document.body.appendChild(div);
    const eset = App.createLayerSet(() => 1, false);
    eset.refresh({ proxy });
    const center = (map && map.getView().getCenter()) || L.center;
    const res = (L.scale / 1000 / effPpm) / ol.proj.getPointResolution('EPSG:3857', 1, center, 'm');
    const emap = new ol.Map({
      target: div, pixelRatio: pr, controls: [], interactions: [], layers: eset.layers,
      view: new ol.View({ projection: 'EPSG:3857', center, resolution: res, constrainResolution: false, smoothResolutionConstraint: false, minResolution: 0.001, maxResolution: 500000, enableRotation: false }),
    });
    try {
      emap.setSize([sw, sh]);
      eset.viewExtent = emap.getView().calculateExtent([sw, sh]);   // 명칭 위치를 출력 범위 기준으로
      await new Promise((ok, no) => {
        const to = setTimeout(() => no(new Error('지도 렌더링 시간 초과(60초)')), 60000);
        emap.once('rendercomplete', () => { clearTimeout(to); ok(); });
        emap.renderSync();
      });
      // .ol-layer canvas 합성 (opacity / transform 반영)
      const mc = document.createElement('canvas');
      mc.width = Math.round(sw * pr); mc.height = Math.round(sh * pr);
      const mctx = mc.getContext('2d');
      Array.prototype.forEach.call(div.querySelectorAll('.ol-layer canvas'), cv => {
        if (cv.width <= 0) return;
        const parent = cv.parentNode;
        const op = parent.style.opacity;
        mctx.globalAlpha = op === '' ? 1 : Number(op);
        const bg = parent.style.backgroundColor || cv.style.backgroundColor;
        if (bg) { mctx.fillStyle = bg; mctx.fillRect(0, 0, cv.width, cv.height); }
        const tr = cv.style.transform;
        const mm = /^matrix\(([^)]*)\)$/.exec(tr || '');
        // OL 이 canvas 에 주는 CSS transform 은 CSS px 기준(1/pixelRatio 배율 포함)이므로 pixelRatio 만큼 곱해 장치 px 기준으로 변환
        if (mm) CanvasRenderingContext2D.prototype.setTransform.apply(mctx, mm[1].split(',').map(Number).map(v => v * pr));
        else mctx.setTransform(1, 0, 0, 1, 0, 0);
        mctx.drawImage(cv, 0, 0);
      });
      mctx.globalAlpha = 1; mctx.setTransform(1, 0, 0, 1, 0, 0);
      // 최종 용지 캔버스
      const out = document.createElement('canvas');
      out.width = pxW; out.height = pxH;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pxW, pxH);
      const mx = Math.round(mr.x / 25.4 * dpi), my = Math.round(mr.y / 25.4 * dpi);
      ctx.drawImage(mc, mx, my, Math.round(mr.w / 25.4 * dpi), Math.round(mr.h / 25.4 * dpi));
      drawOverlay(ctx, dpi / 25.4, { L, W, H, mapRect: mr, preview: false, write: false });
      // 오염 검사 / 타일 오류 검사
      const retry = new Error('canvas tainted or tile load failed'); retry.retry = true;
      try { ctx.getImageData(0, 0, 1, 1); } catch (e) { if (!proxy) throw retry; throw e; }
      if (!proxy && eset.errors > 0 && App.cfg.vworldKey) throw retry;
      if (proxy && eset.errors > 0) App.toast('일부 배경 타일을 불러오지 못했습니다. 브이월드 키를 확인하세요.', 'warn');
      return out;
    } finally {
      emap.setTarget(null);
      emap.dispose && emap.dispose();
      div.remove();
    }
  }

  async function doExport(kind) {
    if (exporting) return;
    const dpi = Number(L.dpi) || 200, { W, H } = dims();
    const pxW = Math.round(W / 25.4 * dpi), pxH = Math.round(H / 25.4 * dpi);
    if (Math.max(pxW, pxH) > 14000) {
      return App.toast(`출력 크기가 ${pxW}×${pxH}px 로 너무 큽니다 (한 변 14000px 초과). 해상도(DPI)를 낮추세요.`, 'error');
    }
    exporting = true;
    $('#btnPng').disabled = true; $('#btnPdf').disabled = true;
    try {
      prog(`내보내는 중... (${pxW}×${pxH}px, ${dpi}dpi)`);
      let canvas;
      try { canvas = await renderExport(!!App.opts.proxy); }
      catch (e) {
        if (e.retry || e.name === 'SecurityError') {
          prog('배경지도 CORS 문제로 타일 프록시로 다시 시도합니다...');
          canvas = await renderExport(true);
        } else throw e;
      }
      const base = `생태자연도_도면_1-${Math.round(L.scale)}`;
      if (kind === 'png') {
        const blob = await new Promise((ok, no) => canvas.toBlob(b => b ? ok(b) : no(new Error('PNG 생성 실패')), 'image/png'));
        App.downloadBlob(blob, base + '.png');
      } else {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: W >= H ? 'landscape' : 'portrait', unit: 'mm', format: [W, H] });
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H);
        doc.save(base + '.pdf');
      }
      App.toast('내보내기를 마쳤습니다.', 'ok');
    } catch (e) {
      App.toast('내보내기 실패: ' + e.message, 'error');
    } finally {
      exporting = false; prog('');
      $('#btnPng').disabled = false; $('#btnPdf').disabled = false;
    }
  }

  // ========================================================== 7. 탭 진입/이탈 및 시작
  App.layout = {
    getL() { return JSON.parse(JSON.stringify(L)); },
    setL(o) { const d = defaults(); L = Object.assign(d, o || {}); L.els = Object.assign(d.els, (o && o.els) || {}); Object.keys(d.els).forEach(k => { L.els[k] = Object.assign(defaults().els[k], (o && o.els && o.els[k]) || {}); }); saveLayout(); syncControls(); buildElUI(); styleSig = null; if (active) { if (map && L.center) map.getView().setCenter(L.center); layoutPaper(); } },
    enter() {
      active = true;
      ensureMap();
      syncControls();
      if (!L.center && App.sitesExtent()) fitToSites();
      layoutPaper();
      requestAnimationFrame(layoutPaper);
    },
    leave() { active = false; },
  };
  App.listeners.push(() => { if (active) { const ts = document.getElementById('layoutTheme'); if (ts) ts.value = App.theme; layoutPaper(); if (set) set.changed(); } });

  if (document.fonts && document.fonts.load) document.fonts.load('12px EcoFont').then(() => { if (active) redraw(); }).catch(() => {});
  loadLayout();
  buildElUI();
  syncControls();
  initControls();
  initDrag();
  initSteppers();
  App.init();
})();
