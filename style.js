/* 통일 스타일 편집기: 모든 레이어·문자를 같은 방식으로 하나씩 설정
 * - 선: 색, 두께, 선 종류, 버퍼 색, 버퍼 두께
 * - 문자: 표시, 색(레이어 색과 같게), 크기(%), 버퍼(상자 테두리) 색, 두께
 * 열기: 출력 화면 '레이어·문자 스타일' 목록의 [설정], 또는 미리보기에서 레이어를 두 번 누르기.
 * 기존 저장 위치(protCustom, catStyle, tgt, ringColor 등)와 연결되어 다른 화면의 설정과 같이 움직임. app2.js 앞에 로드. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const S = () => (App.opts.sty = App.opts.sty || {});
  const raw = id => S()[id] || {};
  // 한 항목의 설정값 읽기 (없으면 기본값)
  App.styGet = (id, k, def) => { const v = raw(id)[k]; return v == null || v === '' ? def : v; };
  const refresh = () => { App.saveOpts(); App.liveSets.forEach(s => s.changed && s.changed()); if (App.layout && App.layout.redraw) App.layout.redraw(); App.emit(); };
  const DASHES = [['solid', '실선'], ['dashed', '파선'], ['dotted', '점선']];
  const LINE = ['color', 'width', 'dash', 'halo', 'haloW'], LBL = ['lshow', 'lauto', 'lcolor', 'lsize', 'lhalo', 'lhaloW'];
  const optMap = (id, map, def) => ({   // 옛 저장 위치(App.opts.xxx)와 연결
    get: k => (map[k] ? (App.opts[map[k]] == null || App.opts[map[k]] === '' ? def[k] : App.opts[map[k]]) : App.styGet(id, k, def[k])),
    set: (k, v) => { if (map[k]) App.opts[map[k]] = v; else S()[id] = Object.assign({}, raw(id), { [k]: v }); },
  });
  const plain = (id, def) => ({ get: k => App.styGet(id, k, def[k]), set: (k, v) => { S()[id] = Object.assign({}, raw(id), { [k]: v }); } });

  // ------------------------------------------------------------ 지금 화면에 있는 설정 가능한 항목
  function entries() {
    const out = [], th = App.theme;
    // 도면 (사업지구·계획지구 등): 선은 도면 탭 선 스타일과 같은 값
    [...new Set(App.sites.filter(s => s.geometry).map(s => s.category))].forEach(cat => {
      const id = 'site:' + cat, key = th === 'ecvam' ? 'catStyleE' : 'catStyle', lsKey = th === 'ecvam' ? 'ecoCatStyleE' : 'ecoCatStyle';
      const base = () => App.catStyleFor(cat), sl = App.opts.siteLabel || {};
      const def = { halo: '#ffffff', haloW: 0, lshow: sl.show !== false, lauto: true, lcolor: base().color, lsize: 100, lhalo: '#ffffff', lhaloW: sl.buf == null || sl.buf === '' ? 0.8 : Number(sl.buf) };
      out.push({ id, name: cat + ' (도면)', group: '도면', fields: LINE.concat(LBL), lunit: 'mm', color: () => base().color,
        get: k => (['color', 'width', 'dash'].includes(k) ? base()[k] : App.styGet(id, k, def[k])),
        set: (k, v) => { if (['color', 'width', 'dash'].includes(k)) { App[key][cat] = Object.assign({}, App[key][cat], { [k]: v }); try { localStorage.setItem(lsKey, JSON.stringify(App[key])); } catch (e) { /* 무시 */ } } else S()[id] = Object.assign({}, raw(id), { [k]: v }); } });
    });
    if (App.opts.adm) {
      const def = { color: App.admLook().color, width: 100, dash: 'dashdot', halo: '#ffffff', haloW: 0 };
      out.push(Object.assign({ id: 'adm', name: '행정구역 경계', group: '경계', fields: ['color', 'width', 'halo', 'haloW'], wunit: '%', color: () => App.admLook().color },
        { get: k => (k === 'color' ? App.admLook().color : k === 'width' ? (Number(App.opts.admWPct) || 100) : App.styGet('adm', k, def[k])),
          set: (k, v) => { if (k === 'color') App.opts.admCustom = Object.assign({}, App.opts.admCustom, { color: v }); else if (k === 'width') App.opts.admWPct = v; else S().adm = Object.assign({}, raw('adm'), { [k]: v }); } }));
    }
    if (th === 'prot') {
      const kinds = [...new Set((App.protRows ? App.protRows() : []).map(r => r.kind))];
      kinds.forEach(kid => {
        const p = (App.PROT || []).find(q => q.id === kid); if (!p) return; const id = 'p:' + kid;
        const lk = () => App.protLook(p);
        const def = { lshow: true, lauto: true, lsize: 100, lhalo: App.opts.lblHalo || '#ffffff', lhaloW: App.opts.lblHaloW == null ? 3 : Number(App.opts.lblHaloW) };
        out.push({ id, name: lk().name, group: '레이어', fields: LINE.concat(LBL), color: () => lk().color,
          get: k => (LINE.includes(k) ? lk()[k] : k === 'lcolor' ? App.styGet(id, k, lk().color) : App.styGet(id, k, def[k])),
          set: (k, v) => { if (LINE.includes(k)) { App.opts.protCustom = App.opts.protCustom || {}; App.opts.protCustom[kid] = Object.assign({}, App.opts.protCustom[kid], { [k]: v }); } else S()[id] = Object.assign({}, raw(id), { [k]: v }); } });
      });
      if (App.src.pick.getFeatures().some(f => f.get('pk') === 'ring'))
        out.push(Object.assign({ id: 'pk:ring', name: '반경 원', group: '반경', fields: LINE.concat(['lshow', 'lcolor', 'lsize', 'lhalo', 'lhaloW']), badge: true, color: () => App.opts.ringColor || '#111111' },
          optMap('pk:ring', { color: 'ringColor', width: 'ringW', halo: 'ringHalo', haloW: 'ringBuf' }, { color: '#111111', width: 1.8, dash: 'solid', halo: '#ffffff', haloW: 1.1, lshow: true, lcolor: '#111111', lsize: 100, lhalo: '#111111', lhaloW: 1.2 })));
      if (App.src.pick.getFeatures().some(f => f.get('pk') === 'region'))
        out.push(Object.assign({ id: 'pk:region', name: '선택 행정구역 경계', group: '반경', fields: LINE, color: () => App.opts.pickRegionColor || '#E91E63' },
          optMap('pk:region', { color: 'pickRegionColor', width: 'regionW', halo: 'regionHalo', haloW: 'regionBuf' }, { color: '#E91E63', width: 2.2, dash: 'solid', halo: '#ffffff', haloW: 1.15 })));
    }
    if (th === 'target' || th === 'meas') {
      const t = App.opts.tgt || {};
      if (th === 'target' && App.src.target.getFeatures().some(f => f.get('tk') === 'ring'))
        out.push({ id: 'tg:ring', name: '거리 범위 선', group: '범위', fields: LINE.concat(['lshow', 'lcolor', 'lsize', 'lhalo', 'lhaloW']), badge: true, color: () => (App.opts.tgt || {}).ringColor || '#222222',
          get: k => { const o = App.opts.tgt || {}; return k === 'color' ? (o.ringColor || '#222222') : k === 'width' ? (o.ringW || 1.8) : k === 'haloW' ? (o.ringBuf == null ? 0.9 : o.ringBuf) : App.styGet('tg:ring', k, { dash: 'solid', halo: '', lshow: true, lcolor: '#111111', lsize: 100, lhalo: '#111111', lhaloW: 1.1 }[k]); },
          set: (k, v) => { const o = App.opts.tgt = App.opts.tgt || {}; if (k === 'color') o.ringColor = v; else if (k === 'width') o.ringW = v; else if (k === 'haloW') o.ringBuf = v; else S()['tg:ring'] = Object.assign({}, raw('tg:ring'), { [k]: v }); } });
      const RIV = { river_nat: '국가하천', river_loc: '지방하천', river_small: '소하천' };
      [...new Set(App.src.target.getFeatures().filter(f => f.get('tk') === 'river').map(f => f.get('rid')))].forEach(rid => {
        const id = 'tg:' + rid, dcol = rid === 'river_small' ? '#2F80ED' : '#1E4FD8';
        out.push(Object.assign({ id, name: RIV[rid] || rid, group: '하천', fields: ['color', 'width', 'halo', 'haloW'].concat(LBL), badge: true, color: () => App.styGet(id, 'color', dcol) },
          plain(id, { color: dcol, width: 1.2, halo: '#ffffff', haloW: 0, lshow: true, lauto: true, lcolor: dcol, lsize: 100, lhalo: dcol, lhaloW: 1 })));
      });
    }
    if (th === 'meas' && App.opts.meas) {
      const used = new Set((App.opts.meas.rows || []).filter(r => r.ll).map(r => r.cat));
      (App.opts.meas.cats || []).filter(c => used.has(c.k)).forEach(c => {
        const id = 'ms:' + c.k;
        out.push({ id, name: c.k + ' 측정지점', group: '측정지점', fields: ['color', 'halo', 'haloW', 'lshow', 'lcolor', 'lsize', 'lhalo', 'lhaloW'], badge: true, haloName: '기호 테두리', color: () => c.color,
          get: k => (k === 'color' ? c.color : App.styGet(id, k, { halo: '#111111', haloW: 1.4, lshow: true, lcolor: '#111111', lsize: 100, lhalo: '#222222', lhaloW: 1.1 }[k])),
          set: (k, v) => { if (k === 'color') c.color = v; else S()[id] = Object.assign({}, raw(id), { [k]: v }); } });
      });
    }
    return out;
  }
  App.styEntries = entries;

  // 지도 도형 → 스타일 항목 id (미리보기 두 번 누르기)
  App.styIdOf = f => {
    if (f.get('kind') && f.get('kind') !== 'adm') return 'p:' + f.get('kind');
    if (f.get('kind') === 'adm' || f.get('lvl')) return 'adm';
    if (f.get('tk') === 'ring') return 'tg:ring';
    if (f.get('tk') === 'river') return 'tg:' + f.get('rid');
    if (f.get('pk') === 'ring') return 'pk:ring';
    if (f.get('pk') === 'region') return 'pk:region';
    if (f.get('mcat')) return 'ms:' + f.get('mcat');
    if (f.get('siteId') != null) return 'site:' + f.get('category');
    return null;
  };

  // ------------------------------------------------------------ 속성 창
  function pop() {
    let el = document.getElementById('styPop');
    if (!el) {
      el = document.createElement('div'); el.id = 'styPop'; el.className = 'prop-pop sty-pop'; el.hidden = true; document.body.appendChild(el);
      document.addEventListener('pointerdown', ev => { if (!el.hidden && !el.contains(ev.target) && !ev.target.closest('[data-styopen]')) el.hidden = true; }, true);
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape') el.hidden = true; });
    }
    return el;
  }
  App.stylePopup = function (id, x, y) {
    const e = entries().find(q => q.id === id); if (!e) return false;
    const el = pop(), g = k => e.get(k), has = k => e.fields.includes(k);
    const num = (k, lbl, step, unit, min) => `<label>${lbl} <input type="number" data-sk="${k}" step="${step}" min="${min || 0}" value="${esc(g(k))}">${unit ? ` <small>${unit}</small>` : ''}</label>`;
    const col = (k, lbl, dis) => `<label>${lbl} <input type="color" data-sk="${k}" value="${esc(/^#[0-9a-f]{6}$/i.test(g(k) || '') ? g(k) : '#ffffff')}" ${dis ? 'disabled' : ''}></label>`;
    let h = '';
    if (has('color') || has('width')) {
      h += '<div class="sp-h">선 · 면</div><div class="pp-g">';
      if (has('color')) h += col('color', e.id.startsWith('ms:') ? '기호 색' : '색');
      if (has('width')) h += num('width', '두께', e.wunit === '%' ? 10 : 0.1, e.wunit || 'px', e.wunit === '%' ? 10 : 0.1);
      if (has('halo')) h += col('halo', (e.haloName || '버퍼') + ' 색');
      if (has('haloW')) h += num('haloW', e.haloName ? '두께' : '버퍼', 0.1, 'px');
      if (has('dash')) h += `<label class="pp-w">선 종류 <select data-sk="dash">${DASHES.map(d => `<option value="${d[0]}" ${g('dash') === d[0] ? 'selected' : ''}>${d[1]}</option>`).join('')}</select></label>`;
      h += '</div>';
    }
    if (has('lshow')) {
      h += `<div class="sp-h">문자</div><label class="check"><input type="checkbox" data-sk="lshow" ${g('lshow') !== false ? 'checked' : ''}> 문자 표시</label><div class="pp-g">`;
      h += num('lsize', '크기', 10, '%', 20);
      const auto = has('lauto') && g('lauto') !== false;
      h += col('lcolor', e.badge && has('lauto') ? '이름 바탕색' : '글자 색', auto);
      if (has('lauto')) h += `<label class="check pp-w"><input type="checkbox" data-sk="lauto" ${auto ? 'checked' : ''}> 레이어 색과 같게</label>`;
      h += col('lhalo', e.badge ? '상자 테두리 색' : '버퍼 색');
      h += num('lhaloW', e.badge ? '테두리' : '버퍼', 0.1, e.lunit || 'px');
      h += '</div>';
    }
    h += `<div class="row sp-btns"><button type="button" class="btn small" data-sreset="1">이 항목 기본값으로</button></div>`;
    el.innerHTML = `<div class="pp-h"><b>${esc(e.name)}</b><button type="button" class="pp-x" title="닫기">×</button></div><div class="pp-b">${h}</div>`;
    el.hidden = false;
    el.style.left = Math.max(8, Math.min(x + 12, innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y + 12, innerHeight - el.offsetHeight - 8)) + 'px';
    el.querySelector('.pp-x').onclick = () => { el.hidden = true; };
    el.oninput = el.onchange = ev => {
      const t = ev.target, k = t.dataset.sk; if (!k) return;
      const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
      e.set(k, v);
      if (k === 'lauto') { const c = el.querySelector('[data-sk=lcolor]'); if (c) { c.disabled = v; if (!v) e.set('lcolor', c.value); } }
      refresh(); renderList();
    };
    el.querySelector('[data-sreset]').onclick = () => {
      delete S()[id];
      if (id.startsWith('p:') && App.opts.protCustom) delete App.opts.protCustom[id.slice(2)];
      refresh(); renderList(); App.stylePopup(id, x, y);
    };
    return true;
  };

  // ------------------------------------------------------------ 출력 화면 목록
  let sig = null;
  function renderList(force) {
    const box = $('#styList'); if (!box) return;
    const es = entries(), s = es.map(e => e.id + (e.color ? e.color() : '')).join(',') + App.theme;
    if (!force && s === sig) return; sig = s;
    if (!es.length) { box.innerHTML = '<div class="hint">설정할 레이어가 아직 없습니다</div>'; return; }
    let last = null;
    box.innerHTML = es.map(e => { const gh = e.group !== last ? `<div class="sty-g">${esc(e.group)}</div>` : ''; last = e.group;
      return gh + `<div class="sty-item"><span class="sty-sw" style="background:${esc(e.color ? e.color() : '#888')}"></span><span class="sty-nm" title="${esc(e.name)}">${esc(e.name)}</span><button type="button" class="btn small" data-styopen="${esc(e.id)}">설정</button></div>`; }).join('');
  }
  App.styRender = renderList;
  function init() {
    const box = $('#styList'); if (!box) return;
    box.addEventListener('click', e => { const b = e.target.closest('[data-styopen]'); if (!b) return; const r = b.getBoundingClientRect(); App.stylePopup(b.dataset.styopen, r.right, r.top); });
    App.listeners.push(() => renderList(false));
    renderList(true);
  }
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); init(); };
})();
