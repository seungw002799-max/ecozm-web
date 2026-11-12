/* 생태자연도 도구 - 브라우저 백엔드
 * 로컬 Python 서버(server.py)가 하던 /api/* 를 브라우저 안에서 처리한다 (fetch 가로채기).
 * 도면 파일은 서버로 올라가지 않고 이 PC 브라우저 안에서만 처리된다.
 * 필요: proj4, jsts, ExcelJS(엑셀 저장 시 지연 로드), CAD(cad.js) */
(function () {
  'use strict';
  const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

  // ---------------------------------------------------------------- 좌표계 후보 (server.py 와 동일)
  const TW = '+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
  const CRS = [
    ['EPSG:5186', 'EPSG:5186 GRS80 중부원점 (가산 60만)', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', 1],
    ['EPSG:5187', 'EPSG:5187 GRS80 동부원점 (가산 60만)', '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', 2],
    ['EPSG:5185', 'EPSG:5185 GRS80 서부원점 (가산 60만)', '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', 2],
    ['EPSG:5188', 'EPSG:5188 GRS80 동해원점 (가산 60만)', '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', 3],
    ['EPSG:5174', 'EPSG:5174 Bessel 중부원점 (구좌표, 가산 50만)', '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel ' + TW + ' +units=m +no_defs', 4],
    ['EPSG:5176', 'EPSG:5176 Bessel 동부원점 (구좌표, 가산 50만)', '+proj=tmerc +lat_0=38 +lon_0=129.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel ' + TW + ' +units=m +no_defs', 5],
    ['EPSG:5173', 'EPSG:5173 Bessel 서부원점 (구좌표, 가산 50만)', '+proj=tmerc +lat_0=38 +lon_0=125.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel ' + TW + ' +units=m +no_defs', 5],
    ['EPSG:5175', 'EPSG:5175 Bessel 제주 (구좌표, 가산 55만)', '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=550000 +ellps=bessel ' + TW + ' +units=m +no_defs', 6],
    ['EPSG:5181', 'EPSG:5181 GRS80 중부원점 (가산 50만)', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', 6],
    ['EPSG:2097', 'EPSG:2097 Bessel 중부원점 (경도 보정 없음)', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel ' + TW + ' +units=m +no_defs', 7],
    ['EPSG:5179', 'EPSG:5179 UTM-K (GRS80)', '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', 3],
    ['EPSG:32652', 'EPSG:32652 WGS84 UTM 52N', '+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs', 8],
    ['EPSG:4326', 'EPSG:4326 경위도 (WGS84)', '+proj=longlat +datum=WGS84 +no_defs', 8],
  ];
  const CRS_BY = Object.fromEntries(CRS.map(c => [c[0], c]));
  const TARGET = CRS_BY['EPSG:5186'][2], WGS = '+proj=longlat +datum=WGS84 +no_defs';
  // 주의: proj4js 는 한쪽에 측지계 정보가 없으면 측지계 변환을 생략하므로 GRS80 정의에 +towgs84=0 을 넣어 둠
  const tcache = {};
  const tr = (a, b) => (tcache[a + '|' + b] = tcache[a + '|' + b] || proj4(a, b));
  const inKorea = (lon, lat) => lon >= 124 && lon <= 132.2 && lat >= 32.8 && lat <= 38.9;

  // ---------------------------------------------------------------- JSTS 도우미
  let J = null;
  function jst() {
    if (J) return J;
    const g = jsts;
    J = {
      fac: new g.geom.GeometryFactory(),
      reader: new g.io.GeoJSONReader(), writer: new g.io.GeoJSONWriter(),
    };
    J.fix = (geom) => {
      try { if (g.geom.util.GeometryFixer) return g.geom.util.GeometryFixer.fix(geom); } catch (e) { /* 아래로 */ }
      return geom.isValid() ? geom : geom.buffer(0);
    };
    J.union = (arr) => {
      if (!arr.length) return J.fac.createPolygon();
      try { return g.operation.union.UnaryUnionOp.union(J.fac.createGeometryCollection(arr)); }
      catch (e) { return arr.reduce((a, b) => a.union(b)); }
    };
    J.read = gj => J.reader.read(gj);
    J.write = geom => J.writer.write(geom);
    return J;
  }
  function polys(geom) {         // Polygon 들로 분해
    const out = [];
    const walk = gm => {
      if (!gm || gm.isEmpty()) return;
      const t = gm.getGeometryType();
      if (t === 'Polygon') { if (gm.getArea() > 0) out.push(gm); }
      else if (t === 'MultiPolygon' || t === 'GeometryCollection') for (let i = 0; i < gm.getNumGeometries(); i++) walk(gm.getGeometryN(i));
    };
    walk(geom);
    return out;
  }
  const polyOnly = gm => { const J0 = jst(), p = polys(gm); return p.length === 1 ? p[0] : J0.fac.createMultiPolygon(p); };
  function mapCoords(gj, fn) {   // GeoJSON 좌표 변환
    const m = c => (typeof c[0] === 'number') ? fn(c) : c.map(m);
    return Object.assign({}, gj, { coordinates: m(gj.coordinates) });
  }
  const toGJ = it => ({ type: it.type, coordinates: it.coords });

  // ---------------------------------------------------------------- 업로드 / 사이트
  const UP = {};
  async function upload(name, file) {
    const r = await CAD.read(file);
    if (!r.items.length) throw new Error('도면에서 도형을 찾지 못했습니다.');
    const fid = Math.random().toString(16).slice(2, 14);
    UP[fid] = { name, items: r.items, converter: r.converter };
    const layers = {};
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    const ext = p => { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; };
    r.items.forEach(it => {
      const L = layers[it.layer] = layers[it.layer] || { name: it.layer, count: 0, types: {}, closed: 0 };
      L.count++; L.types[it.type] = (L.types[it.type] || 0) + 1;
      if (it.type === 'Polygon') { L.closed++; it.coords[0].forEach(ext); }
      else if (it.type === 'LineString') {
        const c = it.coords; c.forEach(ext);
        if (c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) L.closed++;
      } else ext(it.coords);
    });
    return { fileId: fid, name, converter: r.converter,
      layers: Object.values(layers).sort((a, z) => (z.closed - a.closed) || a.name.localeCompare(z.name)), bounds: b };
  }

  // 선택 레이어 -> 폴리곤 (닫힌 선, 면, 흩어진 선 polygonize) 후 합치기. 좌표는 원본 * scale
  // 외곽선 모드: 선택한 모든 선·면을 gap 만큼 부풀려 합치고, 구멍을 메운 뒤 다시 gap 만큼 줄여 가장 바깥 윤곽만 남김
  function outlineGeom(sel, gap) {
    const J0 = jst(), gs = [];
    sel.forEach(it => {
      if (it.type === 'Point') return;
      try { gs.push(J0.read(toGJ(it))); } catch (e) { /* 무시 */ }
    });
    if (!gs.length) throw new Error('선택한 레이어에 선이나 면이 없습니다.');
    const bp = new jsts.operation.buffer.BufferParameters(); bp.setQuadrantSegments(4);
    const grown = jsts.operation.buffer.BufferOp.bufferOp(J0.fac.createGeometryCollection(gs), gap, bp);
    const shells = polys(grown).map(p => J0.fac.createPolygon(p.getExteriorRing().getCoordinates()));
    const out = jsts.operation.buffer.BufferOp.bufferOp(J0.union(shells), -gap, bp);
    const parts = polys(out);
    if (!parts.length) throw new Error('외곽선을 만들지 못했습니다. 틈 메우기 값을 늘려 보세요.');
    const maxA = Math.max(...parts.map(p => p.getArea()));
    const keep = parts.filter(p => p.getArea() >= maxA * 0.01);       // 가장 큰 조각의 1% 미만 잔조각은 제외
    return { geom: J0.union(keep.map(p => J0.fac.createPolygon(p.getExteriorRing().getCoordinates()))), parts: keep.length, dropped: parts.length - keep.length };
  }

  function siteGeom(fid, layers, scale, opt) {
    const up = UP[fid];
    if (!up) throw new Error('업로드 정보가 없습니다. 파일을 다시 올려 주세요.');
    const J0 = jst();
    const sel = up.items.filter(it => !layers || !layers.length || layers.includes(it.layer));
    if (!sel.length) throw new Error('선택한 레이어에 도형이 없습니다.');
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    sel.forEach(it => { const cs = it.type === 'Polygon' ? it.coords[0] : (it.type === 'Point' ? [it.coords] : it.coords); cs.forEach(p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }); });
    const tol = Math.max(Math.max(b[2] - b[0], b[3] - b[1]) * 1e-7, 1e-6);
    if (opt && opt.outline) {
      const gapOrig = Math.max(0.01, Number(opt.gap) || 5) / (scale || 1);   // m -> 도면 단위
      const o = outlineGeom(sel, gapOrig);
      let gj0 = J0.write(o.geom);
      if (scale !== 1) gj0 = mapCoords(gj0, p => [p[0] * scale, p[1] * scale]);
      return { gj: gj0, nOpen: 0, outline: { parts: o.parts, dropped: o.dropped } };
    }
    const parts = [], open = [];
    sel.forEach(it => {
      if (it.type === 'Polygon') { try { parts.push(...polys(J0.fix(J0.read(toGJ(it))))); } catch (e) { /* 무시 */ } }
      else if (it.type === 'LineString') {
        const c = it.coords.slice();
        if (c.length >= 4 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) <= tol) {
          c[c.length - 1] = c[0];
          try { parts.push(...polys(J0.fix(J0.read({ type: 'Polygon', coordinates: [c] })))); } catch (e) { /* 무시 */ }
        } else if (c.length >= 2) open.push(J0.read({ type: 'LineString', coordinates: c }));
      }
    });
    let nOpen = 0;
    if (open.length) {
      const noded = J0.union(open);                       // 교차점에서 선 분할
      const pz = new jsts.operation.polygonize.Polygonizer();
      pz.add(noded);
      const faces = pz.getPolygons().toArray();
      nOpen = faces.length;
      faces.forEach(f => parts.push(f));
    }
    if (!parts.length) throw new Error('선택한 레이어에서 닫힌 영역(폴리곤)을 만들 수 없습니다. 경계선 레이어를 선택했는지 확인해 주세요.');
    let g = J0.union(parts);
    let gj = J0.write(g);
    if (scale !== 1) gj = mapCoords(gj, p => [p[0] * scale, p[1] * scale]);
    return { gj, nOpen };
  }

  function crsCandidates(fid, layers, opt) {
    const J0 = jst();
    const { gj } = siteGeom(fid, layers, 1, opt);
    const pt = J0.read(gj).getInteriorPoint().getCoordinate();
    const x = pt.x, y = pt.y, out = [];
    const scales = [1]; if (Math.abs(x) > 2e6 || Math.abs(y) > 5e6) scales.push(0.001);   // mm 단위 도면
    scales.forEach(s => CRS.forEach(([key, label, def, prio]) => {
      try {
        const [lon, lat] = tr(def, WGS).forward([x * s, y * s]);
        if (!isFinite(lon) || !isFinite(lat) || !inKorea(lon, lat)) return;
        const g5 = mapCoords(gj, p => def === TARGET ? [p[0] * s, p[1] * s] : tr(def, TARGET).forward([p[0] * s, p[1] * s]));
        const e = J0.read(g5).getEnvelopeInternal();
        out.push({ key, scale: s, label: label + (s !== 1 ? ' ×0.001 (mm 도면)' : ''), priority: prio + (s !== 1 ? 10 : 0), lon, lat,
          bbox5186: [e.getMinX(), e.getMinY(), e.getMaxX(), e.getMaxY()] });
      } catch (e) { /* 무시 */ }
    }));
    out.sort((a, z) => a.priority - z.priority);
    return { candidates: out, rawCenter: [x, y] };
  }

  function buildSite(fid, layers, key, scale, opt) {
    const J0 = jst();
    const { gj, nOpen, outline } = siteGeom(fid, layers, scale, opt);
    const def = CRS_BY[key][2];
    const g5 = def === TARGET ? gj : mapCoords(gj, p => tr(def, TARGET).forward(p));
    const g = polyOnly(J0.union(polys(J0.fix(J0.read(g5)))));
    const e = g.getEnvelopeInternal();
    return { geometry: J0.write(g), area: g.getArea(), bbox: [e.getMinX(), e.getMinY(), e.getMaxX(), e.getMaxY()], polygonizedFromLines: nOpen, outline: outline || null };
  }

  // ---------------------------------------------------------------- 면적 산정 (server.py compute_area 와 같은 규칙)
  const GRADE_ORDER = ['9', '1', '2', '3'];   // 중첩 시 우선 배정 (보전 가치 높은 순)
  const GRADE_LABEL = { '1': '1등급', '2': '2등급', '3': '3등급', '9': '별도관리지역' };
  const gkey = v => { if (v == null) return '기타'; const s = String(v).trim(); const n = Number(s); return isFinite(n) && s !== '' ? String(Math.trunc(n)) : s; };

  function computeArea(sites, eczm) {
    const J0 = jst();
    const byGrade = {}, seen = new Set();
    (eczm.features || []).forEach(f => {
      if (seen.has(f.id)) return; seen.add(f.id);
      let g; try { g = J0.fix(J0.read(f.geometry)); } catch (e) { return; }
      const k = gkey((f.properties || {}).eczm_grad);
      (byGrade[k] = byGrade[k] || []).push(g);
    });
    const keys = GRADE_ORDER.filter(k => byGrade[k]).concat(Object.keys(byGrade).filter(k => !GRADE_ORDER.includes(k)).sort());
    const tree = new jsts.index.strtree.STRtree();
    keys.forEach(k => byGrade[k].forEach(g => tree.insert(g.getEnvelopeInternal(), { g, k })));
    const cats = {};
    sites.forEach(s => { (cats[s.category] = cats[s.category] || []).push(J0.fix(J0.read(s.geometry))); });
    const rows = [], clipped = [];
    Object.entries(cats).forEach(([cat, gs]) => {
      const site = J0.union(gs), total = site.getArea();
      let assigned = null; const areas = {}; let overlap = 0;
      const per = {};
      tree.query(site.getEnvelopeInternal()).toArray().forEach(o => { if (o.g.intersects(site)) (per[o.k] = per[o.k] || []).push(o.g); });
      keys.forEach(k => {
        if (!per[k]) return;
        const inter = J0.fix(site.intersection(J0.union(per[k])));
        const raw = inter.getArea();
        const part = assigned ? J0.fix(inter.difference(assigned)) : inter;
        overlap += raw - part.getArea();
        if (part.getArea() <= 0) return;
        areas[k] = part.getArea();
        assigned = assigned ? J0.union([assigned, part]) : part;
        polys(part).forEach(p => clipped.push({ type: 'Feature', geometry: J0.write(p), properties: { category: cat, grade: k, area: p.getArea() } }));
      });
      const sum = Object.values(areas).reduce((a, b) => a + b, 0);
      const rest = assigned ? J0.fix(site.difference(assigned)) : site;
      polys(rest).forEach(p => { if (p.getArea() > 0.01) clipped.push({ type: 'Feature', geometry: J0.write(p), properties: { category: cat, grade: 'rest', area: p.getArea() } }); });
      rows.push({ category: cat, total, areas, noData: Math.max(total - sum, 0), overlapRemoved: overlap });
    });
    return { rows, gradeKeys: keys, gradeLabels: Object.fromEntries(keys.map(k => [k, GRADE_LABEL[k] || ('코드 ' + k)])),
      clipped: { type: 'FeatureCollection', features: clipped }, eczmCount: seen.size };
  }

  // ---------------------------------------------------------------- 엑셀 (ExcelJS)
  let excelP = null;
  function loadExcel() {
    if (!excelP) excelP = new Promise((ok, no) => { const s = document.createElement('script'); s.src = EXCELJS; s.onload = ok; s.onerror = () => no(new Error('엑셀 라이브러리를 불러오지 못했습니다.')); document.head.appendChild(s); });
    return excelP;
  }
  async function makeXlsx(p) {
    await loadExcel();
    const as3 = !!p.remainderAs3, order = { '1': 0, '2': 1, '3': 2, '9': 3 };
    let gks = p.gradeKeys.slice(); const labels = Object.assign({}, p.gradeLabels);
    ['1', '2', '3', '9'].forEach(k => { if (!gks.includes(k)) { gks.push(k); labels[k] = labels[k] || GRADE_LABEL[k]; } });   // 등급 4개 항상 표시
    gks.sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9));
    let rows = p.rows;
    if (as3) rows = rows.map(r => Object.assign({}, r, { areas: Object.assign({}, r.areas, { '3': (r.areas['3'] || 0) + r.noData }), noData: 0 }));
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('생태자연도 등급별 면적');
    const thin = { style: 'thin', color: { argb: 'FF000000' } }, bd = { top: thin, left: thin, bottom: thin, right: thin };
    ws.getCell('A1').value = p.title || '생태자연도 등급별 면적 현황'; ws.getCell('A1').font = { bold: true, size: 13 };
    const cols = gks.map(k => labels[k]).concat(as3 ? [] : ['등급 없음(자료 외)'], ['계']);
    let r = 3;
    ws.getCell(r, 1).value = '구분'; ws.mergeCells(r, 1, r + 1, 1);
    let c = 2;
    cols.forEach(n => { ws.getCell(r, c).value = n; ws.mergeCells(r, c, r, c + 1); ws.getCell(r + 1, c).value = '면적(㎡)'; ws.getCell(r + 1, c + 1).value = '비율(%)'; c += 2; });
    for (const rr of [r, r + 1]) for (let cc = 1; cc < c; cc++) {
      const cell = ws.getCell(rr, cc); cell.font = { bold: true }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; cell.border = bd;
    }
    r += 2;
    rows.forEach(row => {
      const t = row.total || 0;
      const vals = gks.map(k => row.areas[k] || 0).concat(as3 ? [] : [row.noData], [t]);
      const c1 = ws.getCell(r, 1); c1.value = row.category; c1.alignment = { horizontal: 'center' }; c1.border = bd;
      let cc = 2;
      vals.forEach(v => {
        const a = ws.getCell(r, cc), q = ws.getCell(r, cc + 1);
        a.value = Math.round(v * 100) / 100; a.numFmt = '#,##0.00';
        q.value = t ? Math.round(v / t * 10000) / 100 : 0; q.numFmt = '0.00';
        [a, q].forEach(x => { x.alignment = { horizontal: 'right' }; x.border = bd; });
        cc += 2;
      });
      r++;
    });
    r++;
    const notes = ['※ 면적은 EPSG:5186(GRS80 중부원점) 평면좌표 기준으로 산정', '※ 생태자연도 출처: 국립생태원 생태자연도 서비스(공공데이터포털 15057288)'];
    if (as3) notes.push('※ 1·2등급 및 별도관리지역 외 지역은 3등급으로 산정(자연환경보전법 제34조)');
    Object.entries(p.meta || {}).forEach(([k, v]) => notes.push('※ ' + k + ': ' + v));
    notes.forEach(n => { const x = ws.getCell(r++, 1); x.value = n; x.font = { size: 9, color: { argb: 'FF555555' } }; });
    ws.getColumn(1).width = 16;
    for (let i = 2; i < 2 + cols.length * 2; i++) ws.getColumn(i).width = 13;
    return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------------------------------------------------------------- 설정 저장 (브라우저 localStorage)
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  const DEFAULT_CFG = (window.ECO_DEFAULT_CONFIG || {});
  // 키 정리: 복사·붙여넣기 때 섞인 공백/줄바꿈/따옴표 제거, 브이월드 키는 대문자(소문자면 '등록되지 않은 인증키' 오류)
  const normKeys = c => {
    if (c.vworldKey) c.vworldKey = String(c.vworldKey).replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
    if (c.dataGoKrKey) c.dataGoKrKey = String(c.dataGoKrKey).replace(/[\s"'<>]/g, '');
    return c;
  };
  // 팀 설정 링크: 주소 끝 #d=공공데이터키&v=브이월드키 로 열면 키를 이 브라우저에 저장하고 주소에서 지운다
  // (# 뒤 내용은 서버로 전송되지 않으며, 저장소에도 키가 남지 않음)
  try {
    const hp = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    const d = hp.get('d'), v = hp.get('v');
    if (d || v) {
      const c = ls('ecoCfg', {});
      if (d) c.dataGoKrKey = d;
      if (v) c.vworldKey = v;
      localStorage.setItem('ecoCfg', JSON.stringify(normKeys(c)));
      history.replaceState(null, '', location.pathname + location.search);
      window.ECO_KEYS_FROM_LINK = true;
    }
  } catch (e) { /* 무시 */ }
  // 사이트를 연 상태에서 팀 링크를 붙여넣은 경우에도 적용되도록 새로고침
  window.addEventListener('hashchange', () => { if (/(^|[#&])(d|v)=/.test(location.hash)) location.reload(); });

  // ---------------------------------------------------------------- fetch 가로채기
  const realFetch = window.fetch.bind(window);
  const json = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async function (url, opts) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    const path = u.replace(location.origin, '');
    if (!path.startsWith('/api/')) return realFetch(url, opts);
    opts = opts || {};
    try {
      const body = typeof opts.body === 'string' ? JSON.parse(opts.body || '{}') : null;
      const post = (opts.method || 'GET').toUpperCase() === 'POST';
      switch (path) {
        case '/api/config':
          if (post) { const c = normKeys(Object.assign(ls('ecoCfg', {}), body)); localStorage.setItem('ecoCfg', JSON.stringify(c)); return json(c); }
          { const c = normKeys(ls('ecoCfg', {})); localStorage.setItem('ecoCfg', JSON.stringify(c)); return json(Object.assign({}, DEFAULT_CFG, c)); }
        case '/api/state':
          if (post) { localStorage.setItem('ecoState', JSON.stringify(body)); return json({ ok: true }); }
          return json(ls('ecoState', {}));
        case '/api/health': return json({ ok: true, browser: true });
        case '/api/upload': {
          const h = opts.headers || {}, name = decodeURIComponent(h['X-Filename'] || h['x-filename'] || (opts.body && opts.body.name) || 'upload.dxf');
          const f = opts.body instanceof File ? opts.body : new File([opts.body], name);
          return json(await upload(name, f));
        }
        case '/api/crs': return json(crsCandidates(body.fileId, body.layers, body));
        case '/api/site': return json(buildSite(body.fileId, body.layers, body.crs, Number(body.scale || 1), body));
        case '/api/area': return json(computeArea(body.sites, body.eczm));
        case '/api/xlsx': return new Response(await makeXlsx(body), { status: 200 });
      }
      return json({ error: 'unknown api' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || String(e) }, 400);
    }
  };
  window.EcoBackend = { computeArea, crsCandidates, buildSite, upload, UP };
})();
