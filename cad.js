/* 생태자연도 도구 - 브라우저 도면 읽기 (DWG / DXF / SHP / GeoJSON)
 * window.CAD.read(file) -> { converter, items: [{ layer, type: 'LineString'|'Polygon'|'Point', coords }] }
 * 좌표는 도면 원래 좌표(2D). */
(function () {
  'use strict';
  const CDN = {
    dxf: 'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.js',
    shp: 'https://cdn.jsdelivr.net/npm/shpjs@6.1.0/dist/shp.min.js',
    dwg: 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.8.4/dist/libredwg-web.js',
    wasm: 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.8.4/wasm',
  };
  const loaded = {};
  function loadScript(url) {
    if (!loaded[url]) loaded[url] = new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = url; s.onload = ok;
      s.onerror = () => no(new Error('라이브러리를 불러오지 못했습니다: ' + url)); document.head.appendChild(s);
    });
    return loaded[url];
  }

  // ---------------------------------------------------------------- 기하 도우미
  const MAX_STEP = 2 * Math.PI / 180;      // 호 분할 최대 각도 2도
  function arcPts(cx, cy, r, a0, a1) {      // 반시계 a0 -> a1 (라디안)
    while (a1 <= a0) a1 += 2 * Math.PI;
    const n = Math.min(720, Math.max(8, Math.ceil((a1 - a0) / MAX_STEP)));
    const out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  // bulge 구간 -> 점 목록 (시작점 제외, 끝점 포함)
  function bulgePts(p1, p2, b) {
    if (!b || Math.abs(b) < 1e-12) return [p2];
    const th = 4 * Math.atan(b), dx = p2[0] - p1[0], dy = p2[1] - p1[1], c = Math.hypot(dx, dy);
    if (c === 0) return [p2];
    const r = c / (2 * Math.sin(th / 2));
    const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
    const h = r * Math.cos(th / 2);          // 현 중점에서 중심까지 (부호 포함)
    const cx = mx - h * dy / c, cy = my + h * dx / c;
    const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
    const n = Math.min(720, Math.max(4, Math.ceil(Math.abs(th) / MAX_STEP)));
    const out = [], R = Math.abs(r);
    for (let i = 1; i <= n; i++) { const a = a0 + th * i / n; out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
    out[out.length - 1] = [p2[0], p2[1]];
    return out;
  }
  function polyPts(verts, closed) {       // verts: [{x,y,bulge}]
    if (!verts || !verts.length) return [];
    const out = [[verts[0].x, verts[0].y]];
    const n = verts.length, segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = verts[i], b = verts[(i + 1) % n];
      bulgePts([a.x, a.y], [b.x, b.y], a.bulge || 0).forEach(p => out.push(p));
    }
    if (closed) out[out.length - 1] = out[0].slice();
    return out;
  }
  function ellipsePts(c, maj, ratio, t0, t1) {
    const ma = Math.hypot(maj.x, maj.y), rot = Math.atan2(maj.y, maj.x), mi = ma * ratio;
    while (t1 <= t0) t1 += 2 * Math.PI;
    const n = Math.min(720, Math.max(16, Math.ceil((t1 - t0) / MAX_STEP)));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + (t1 - t0) * i / n, x = ma * Math.cos(t), y = mi * Math.sin(t);
      out.push([c.x + x * Math.cos(rot) - y * Math.sin(rot), c.y + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return out;
  }
  // B-스플라인 (de Boor) 평가
  function bspline(ctrl, degree, knots, weights) {
    const n = ctrl.length;
    if (!knots || knots.length !== n + degree + 1 || degree < 1) return ctrl.map(p => [p.x, p.y]);
    const lo = knots[degree], hi = knots[n], steps = Math.min(2000, Math.max(20, n * 16)), out = [];
    for (let s = 0; s <= steps; s++) {
      const t = s === steps ? hi - 1e-10 * (hi - lo) : lo + (hi - lo) * s / steps;
      let k = degree; while (k < n - 1 && t >= knots[k + 1]) k++;
      const d = [];
      for (let j = 0; j <= degree; j++) { const p = ctrl[k - degree + j], w = weights ? (weights[k - degree + j] || 1) : 1; d.push([p.x * w, p.y * w, w]); }
      for (let r = 1; r <= degree; r++) for (let j = degree; j >= r; j--) {
        const i = k - degree + j, a = (t - knots[i]) / ((knots[i + degree - r + 1] - knots[i]) || 1);
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
      }
      out.push([d[degree][0] / d[degree][2], d[degree][1] / d[degree][2]]);
    }
    return out;
  }
  const closeRing = r => { if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0].slice()); return r; };

  // ---------------------------------------------------------------- 공통 엔티티 변환
  // ent 는 아래 공통 형태로 맞춰진 객체. tf = [a,b,c,d,e,f] (x' = a x + c y + e, y' = b x + d y + f)
  function apply(tf, p) { return [tf[0] * p[0] + tf[2] * p[1] + tf[4], tf[1] * p[0] + tf[3] * p[1] + tf[5]]; }
  function mul(A, B) {       // A ∘ B
    return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  }
  const I = [1, 0, 0, 1, 0, 0];

  function geomOf(e) {        // 공통 엔티티 -> [{type, coords}] (원 좌표계)
    const ocs = e.extrusionDirection && e.extrusionDirection.z < 0 ? -1 : 1;   // 돌출방향 z=-1 이면 x 반전
    const fx = p => [p[0] * ocs, p[1]];
    const P = v => [v.x, v.y];
    switch (e.type) {
      case 'LINE': return [{ type: 'LineString', coords: [P(e.start), P(e.end)].map(fx) }];
      case 'LWPOLYLINE': case 'POLYLINE': {
        const pts = polyPts(e.vertices, !!e.closed).map(fx);
        return pts.length >= 2 ? [{ type: 'LineString', coords: pts }] : [];
      }
      case 'ARC': return [{ type: 'LineString', coords: arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle).map(fx) }];
      case 'CIRCLE': { const r = arcPts(e.center.x, e.center.y, e.radius, 0, 2 * Math.PI).map(fx); r[r.length - 1] = r[0].slice(); return [{ type: 'LineString', coords: r }]; }
      case 'ELLIPSE': {
        const full = Math.abs((e.endAngle - e.startAngle) - 2 * Math.PI) < 1e-6 || e.endAngle === e.startAngle;
        const pts = ellipsePts(e.center, e.majorAxisEndPoint, e.axisRatio, e.startAngle, full ? e.startAngle + 2 * Math.PI : e.endAngle).map(fx);
        if (full) pts[pts.length - 1] = pts[0].slice();
        return [{ type: 'LineString', coords: pts }];
      }
      case 'SPLINE': {
        let pts = (e.controlPoints && e.controlPoints.length >= 2) ? bspline(e.controlPoints, e.degree || 3, e.knots, e.weights)
          : (e.fitPoints || []).map(P);
        if (e.closed && pts.length > 2) closeRing(pts);
        return pts.length >= 2 ? [{ type: 'LineString', coords: pts.map(fx) }] : [];
      }
      case 'SOLID': case '3DFACE': {
        const v = (e.points || []).map(P);
        if (v.length === 4 && e.type === 'SOLID') { const t = v[2]; v[2] = v[3]; v[3] = t; }   // SOLID 점 순서 보정
        return v.length >= 3 ? [{ type: 'Polygon', coords: [closeRing(v.map(fx))] }] : [];
      }
      case 'HATCH': {
        const rings = [];
        (e.loops || []).forEach(lp => { const r = closeRing(lp); if (r.length >= 4) rings.push(r.map(fx)); });
        return rings.map(r => ({ type: 'Polygon', coords: [r] }));
      }
      case 'POINT': return e.position ? [{ type: 'Point', coords: fx(P(e.position)) }] : [];
    }
    return [];
  }

  // blocks: { name: { base:{x,y}, entities:[공통 엔티티] } }
  function explode(entities, blocks, out, tf, parentLayer, depth) {
    for (const e of entities) {
      const layer = (e.layer && e.layer !== '0') ? e.layer : (parentLayer || e.layer || '0');
      if (e.type === 'INSERT') {
        const blk = blocks[e.name];
        if (!blk || depth > 8) continue;
        const sx = e.xScale || 1, sy = e.yScale || 1, rot = (e.rotation || 0);
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
        const ocs = e.extrusionDirection && e.extrusionDirection.z < 0 ? -1 : 1;
        for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
          const ox = ci * (e.columnSpacing || 0), oy = ri * (e.rowSpacing || 0);
          // 블록 좌표 -> 기준점 이동 -> 배율 -> 배열 간격 -> 회전 -> 삽입점
          let m = [1, 0, 0, 1, -blk.base.x, -blk.base.y];
          m = mul([sx, 0, 0, sy, 0, 0], m);
          m = mul([1, 0, 0, 1, ox, oy], m);
          m = mul([cos, sin, -sin, cos, 0, 0], m);
          m = mul([1, 0, 0, 1, e.position.x, e.position.y], m);
          if (ocs < 0) m = mul([-1, 0, 0, 1, 0, 0], m);
          explode(blk.entities, blocks, out, mul(tf, m), layer, depth + 1);
        }
        continue;
      }
      let gs;
      try { gs = geomOf(e); } catch (err) { continue; }
      for (const g of gs) {
        if (g.type === 'Point') out.push({ layer, type: 'Point', coords: apply(tf, g.coords) });
        else if (g.type === 'LineString') out.push({ layer, type: 'LineString', coords: g.coords.map(p => apply(tf, p)) });
        else out.push({ layer, type: 'Polygon', coords: g.coords.map(r => r.map(p => apply(tf, p))) });
      }
    }
  }

  // ---------------------------------------------------------------- DXF (dxf-parser)
  const DEG = Math.PI / 180;
  function fromDxfEnt(e) {
    const c = { type: e.type, layer: e.layer, extrusionDirection: e.extrusionDirection };
    switch (e.type) {
      case 'LINE': c.start = e.vertices[0]; c.end = e.vertices[1]; break;
      case 'LWPOLYLINE': case 'POLYLINE':
        if (e.type === 'POLYLINE' && (e.isPolyfaceMesh || e.isPolygonMesh)) return null;
        c.type = 'LWPOLYLINE'; c.vertices = (e.vertices || []).map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 })); c.closed = !!e.shape; break;
      case 'ARC': c.center = e.center; c.radius = e.radius; c.startAngle = e.startAngle; c.endAngle = e.endAngle; break;   // dxf-parser 는 라디안
      case 'CIRCLE': c.center = e.center; c.radius = e.radius; break;
      case 'ELLIPSE': c.center = e.center; c.majorAxisEndPoint = e.majorAxisEndPoint; c.axisRatio = e.axisRatio; c.startAngle = e.startAngle; c.endAngle = e.endAngle; break;
      case 'SPLINE': c.controlPoints = e.controlPoints; c.degree = e.degreeOfSplineCurve; c.knots = e.knotValues; c.fitPoints = e.fitPoints; c.closed = !!e.closed; break;
      case 'SOLID': case '3DFACE': c.points = e.points || e.vertices; break;
      case 'POINT': c.position = e.position; break;
      case 'INSERT': c.name = e.name; c.position = e.position || { x: 0, y: 0 }; c.xScale = e.xScale; c.yScale = e.yScale; c.rotation = (e.rotation || 0) * DEG;
        c.columnCount = e.columnCount; c.rowCount = e.rowCount; c.columnSpacing = e.columnSpacing; c.rowSpacing = e.rowSpacing; break;
      default: return null;
    }
    return c;
  }
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    const head = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 20000)));
    if (/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_949/i.test(head)) return new TextDecoder('euc-kr').decode(u8);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('euc-kr').decode(u8); }
  }
  async function readDxf(buf) {
    await loadScript(CDN.dxf);
    let dxf;
    try { dxf = new window.DxfParser().parseSync(decodeText(buf)); } catch (e) { throw new Error('DXF 파일을 읽을 수 없습니다: ' + e.message); }
    const blocks = {};
    Object.entries(dxf.blocks || {}).forEach(([name, b]) => {
      blocks[name] = { base: b.position || { x: 0, y: 0 }, entities: (b.entities || []).map(fromDxfEnt).filter(Boolean) };
    });
    const out = [];
    explode((dxf.entities || []).map(fromDxfEnt).filter(Boolean), blocks, out, I, null, 0);
    return out;
  }

  // ---------------------------------------------------------------- DWG (libredwg-web)
  let dwgLib = null;
  async function getDwg() {
    if (!dwgLib) dwgLib = (async () => {
      const mod = await import(CDN.dwg);
      const lib = await mod.LibreDwg.create(CDN.wasm);
      return { mod, lib };
    })();
    return dwgLib;
  }
  function hatchLoops(e) {
    const loops = [];
    (e.boundaryPaths || []).forEach(bp => {
      if (bp.vertices) { loops.push(polyPts(bp.vertices.map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 })), true)); return; }
      if (!bp.edges) return;
      const r = [];
      bp.edges.forEach(ed => {
        let pts = [];
        if (ed.type === 1) pts = [[ed.start.x, ed.start.y], [ed.end.x, ed.end.y]];
        else if (ed.type === 2) pts = ed.isCCW === false ? arcPts(ed.center.x, ed.center.y, ed.radius, -ed.endAngle, -ed.startAngle).map(p => [p[0], 2 * ed.center.y - p[1]]).reverse()
          : arcPts(ed.center.x, ed.center.y, ed.radius, ed.startAngle, ed.endAngle);
        else if (ed.type === 3) pts = ellipsePts(ed.center, ed.end, ed.lengthOfMinorAxis, ed.startAngle, ed.endAngle);
        else if (ed.type === 4) pts = (ed.fitDatum && ed.fitDatum.length ? ed.fitDatum : ed.controlPoints || []).map(p => [p.x, p.y]);
        pts.forEach(p => r.push(p));
      });
      if (r.length >= 3) loops.push(r);
    });
    return loops;
  }
  function fromDwgEnt(e) {
    const c = { type: e.type, layer: e.layer, extrusionDirection: e.extrusionDirection };
    switch (e.type) {
      case 'LINE': c.start = e.startPoint; c.end = e.endPoint; break;
      case 'LWPOLYLINE': c.vertices = e.vertices.map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 })); c.closed = !!(e.flag & 1) || !!(e.flag & 512); break;
      case 'POLYLINE2D': case 'POLYLINE3D':
        c.type = 'LWPOLYLINE';
        c.vertices = (e.vertices || []).filter(v => !(v.flag & 16)).map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 }));
        c.closed = !!(e.flag & 1); break;
      case 'ARC': c.center = e.center; c.radius = e.radius; c.startAngle = e.startAngle; c.endAngle = e.endAngle; break;
      case 'CIRCLE': c.center = e.center; c.radius = e.radius; break;
      case 'ELLIPSE': c.center = e.center; c.majorAxisEndPoint = e.majorAxisEndPoint; c.axisRatio = e.axisRatio; c.startAngle = e.startAngle; c.endAngle = e.endAngle; break;
      case 'SPLINE': c.controlPoints = e.controlPoints; c.degree = e.degree; c.knots = e.knots; c.weights = e.weights; c.fitPoints = e.fitPoints; c.closed = !!(e.flag & 1); break;
      case 'SOLID': case '3DFACE': c.points = [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean); if (!c.points.length && e.points) c.points = e.points; break;
      case 'HATCH': c.loops = hatchLoops(e); break;
      case 'POINT': c.position = e.position; break;
      case 'INSERT': c.name = e.name; c.position = e.insertionPoint || { x: 0, y: 0 }; c.xScale = e.xScale; c.yScale = e.yScale; c.rotation = e.rotation || 0;
        c.columnCount = e.columnCount; c.rowCount = e.rowCount; c.columnSpacing = e.columnSpacing; c.rowSpacing = e.rowSpacing; break;
      default: return null;
    }
    return c;
  }
  async function readDwg(buf) {
    let L;
    try { L = await getDwg(); } catch (e) { throw new Error('DWG 변환 모듈을 불러오지 못했습니다 (인터넷 연결 확인): ' + e.message); }
    const { mod, lib } = L;
    const ft = (mod.Dwg_File_Type && mod.Dwg_File_Type.DWG != null) ? mod.Dwg_File_Type.DWG : 0;
    const ptr = lib.dwg_read_data(buf, ft);
    if (ptr == null) throw new Error('DWG 파일을 읽을 수 없습니다 (지원하지 않는 버전이거나 손상된 파일).');
    let db;
    try { db = lib.convert(ptr); } finally { try { lib.dwg_free(ptr); } catch (e) { /* 무시 */ } }
    const blocks = {};
    ((db.tables.BLOCK_RECORD || {}).entries || []).forEach(b => {
      if (!b.name || /^\*(model|paper)_space/i.test(b.name)) return;
      blocks[b.name] = { base: b.basePoint || { x: 0, y: 0 }, entities: (b.entities || []).map(fromDwgEnt).filter(Boolean) };
    });
    const ents = (db.entities || []).filter(e => !e.isInPaperSpace).map(fromDwgEnt).filter(Boolean);
    const out = [];
    explode(ents, blocks, out, I, null, 0);
    return out;
  }

  // ---------------------------------------------------------------- GeoJSON / SHP
  function fromGeoJSON(gj, layer, out) {
    const add = g => {
      if (!g) return;
      if (g.type === 'GeometryCollection') return g.geometries.forEach(add);
      if (g.type === 'Point') out.push({ layer, type: 'Point', coords: g.coordinates.slice(0, 2) });
      else if (g.type === 'LineString') out.push({ layer, type: 'LineString', coords: g.coordinates.map(p => [p[0], p[1]]) });
      else if (g.type === 'Polygon') out.push({ layer, type: 'Polygon', coords: g.coordinates.map(r => r.map(p => [p[0], p[1]])) });
      else if (g.type.startsWith('Multi')) g.coordinates.forEach(c => add({ type: g.type.slice(5), coordinates: c }));
    };
    const feats = gj.type === 'FeatureCollection' ? gj.features : (gj.type === 'Feature' ? [gj] : [{ geometry: gj }]);
    feats.forEach(f => add(f.geometry));
  }

  async function read(file) {
    const name = file.name || 'upload';
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const buf = await file.arrayBuffer();
    const base = name.replace(/\.[^.]+$/, '');
    let items = [], converter = null;
    if (ext === '.dxf') items = await readDxf(buf);
    else if (ext === '.dwg') { items = await readDwg(buf); converter = '브라우저 DWG 변환 (LibreDWG WASM)'; }
    else if (ext === '.geojson' || ext === '.json') fromGeoJSON(JSON.parse(new TextDecoder('utf-8').decode(buf)), base, items);
    else if (ext === '.zip' || ext === '.shp') {
      await loadScript(CDN.shp);
      if (ext === '.shp') fromGeoJSON({ type: 'FeatureCollection', features: window.shp.parseShp(buf).map(g => ({ geometry: g })) }, base, items);
      else {
        let r = await window.shp(buf);
        (Array.isArray(r) ? r : [r]).forEach(fc => fromGeoJSON(fc, fc.fileName || base, items));
      }
    } else throw new Error('지원하지 않는 파일 형식입니다: ' + ext);
    return { converter, items };
  }

  window.CAD = { read };
})();
