/* 작업 저장 / 열기
 * - 작업 파일(.ecozm): 도면(경계), 설정, 계산 결과(생태자연도 면적·보호구역·국토환경성평가), 도면 출력 배치를 한 파일로 저장
 * - 자동 저장: 이 브라우저(IndexedDB)에 마지막 작업을 저장해 두고, 다음에 열면 "이어서 하기"로 복원
 * 원본 DWG/DXF 는 저장하지 않는다 (경계 도형만 저장). 인증키도 저장하지 않는다.
 * admin.js 다음, app2.js 앞에 로드 (app2.js 가 App.init 을 호출). */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const VERSION = 1;
  const gj = new ol.format.GeoJSON();
  const P = { dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' };
  const wf = src => gj.writeFeaturesObject(src.getFeatures(), P);
  const rf = o => (o && o.features ? gj.readFeatures(o, P) : []);

  // ------------------------------------------------------------ 모으기
  function collect() {
    const opts = Object.assign({}, App.opts);
    return {
      app: 'ecozm-web', version: VERSION, savedAt: new Date().toISOString(),
      theme: App.theme,
      sites: App.sites.filter(s => s.geometry).map(s => ({ name: s.name, category: s.category, geometry: s.geometry, area: s.area, bbox: s.bbox, opacity: s.opacity })),
      catStyle: App.catStyle, catStyleE: App.catStyleE,
      opts,
      layout: App.layout && App.layout.getL ? App.layout.getL() : null,
      eco: App.area ? {
        area: App.area, eczmCount: App.eczmCount, eco1: App.eco1 || null,
        eco1Html: ($('#eco1Info') || {}).innerHTML || '',
        around: wf(App.src.around), inside: wf(App.src.inside),
      } : null,
      prot: (App.protRows && App.protRows().length) || App.src.prot.getFeatures().length ? {
        rows: App.protRows ? App.protRows() : [], msg: App.protMsgText ? App.protMsgText() : '',
        features: wf(App.src.prot), radius: ($('#protRadius') || {}).value,
      } : null,
      arrows: wf(App.src.arrows),
      ecvam: App.ecvamResult ? App.ecvamResult() : null,
    };
  }

  // ------------------------------------------------------------ 되살리기
  async function restore(d) {
    if (!d || d.app !== 'ecozm-web') throw new Error('이 도구의 작업 파일이 아닙니다.');
    App.clearWork();
    // 설정 (인증키는 파일에 없으므로 그대로 유지)
    if (d.opts) { Object.assign(App.opts, d.opts); App.saveOpts(); }
    if (d.catStyle) { Object.keys(d.catStyle).forEach(k => { if (App.catStyle[k]) Object.assign(App.catStyle[k], d.catStyle[k]); }); try { localStorage.setItem('ecoCatStyle', JSON.stringify(App.catStyle)); } catch (e) { /* 무시 */ } }
    if (d.catStyleE) { Object.keys(d.catStyleE).forEach(k => { if (App.catStyleE[k]) Object.assign(App.catStyleE[k], d.catStyleE[k]); }); try { localStorage.setItem('ecoCatStyleE', JSON.stringify(App.catStyleE)); } catch (e) { /* 무시 */ } }
    (d.sites || []).forEach(o => App.restoreSite(o));
    if (d.eco) App.restoreArea(d.eco.area, rf(d.eco.around), rf(d.eco.inside), d.eco.eczmCount, d.eco.eco1, d.eco.eco1Html);
    if (d.prot) {
      App.src.prot.addFeatures(rf(d.prot.features));
      if (d.prot.radius && $('#protRadius')) $('#protRadius').value = d.prot.radius;
      App.protRestore && App.protRestore(d.prot.rows, d.prot.msg);
    }
    App.src.arrows.clear(); App.src.arrows.addFeatures(rf(d.arrows));
    if (d.ecvam && App.setEcvamResult) App.setEcvamResult(d.ecvam);
    if (d.layout && App.layout && App.layout.setL) App.layout.setL(d.layout);
    App.applyOpts && App.applyOpts();
    if (App.opts.adm && App.loadAdmin) App.loadAdmin();
    if (d.theme && App.setTheme) App.setTheme(d.theme);
    App.liveSets.forEach(s => { s.refresh && s.refresh(); s.changed && s.changed(); });
    App.fitSites && App.fitSites();
    App.emit();
  }

  // ------------------------------------------------------------ 사업별 저장 (이 브라우저 + 작업 폴더)
  // 이 브라우저: IndexedDB 'projects' 에 사업명별로 저장 (자동 저장 포함)
  // 작업 폴더: 공유폴더/원드라이브/구글드라이브 폴더를 연결하면 '사업명.ecozm' 파일로도 저장 → 다른 컴퓨터에서 같은 폴더를 연결하면 바로 열림
  const DB = 'ecozm';
  const idb = () => new Promise((ok, no) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => { const db = r.result; ['kv', 'projects', 'meta'].forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  async function tx(store, mode, fn) {
    const db = await idb();
    try { return await new Promise((ok, no) => { const t = db.transaction(store, mode); const st = t.objectStore(store); let out; const q = fn(st); if (q) q.onsuccess = () => { out = q.result; }; t.oncomplete = () => ok(out); t.onerror = () => no(t.error); }); }
    finally { db.close(); }
  }
  const pPut = (name, d) => tx('projects', 'readwrite', st => st.put(d, name));
  const pGet = name => tx('projects', 'readonly', st => st.get(name));
  const pDel = name => tx('projects', 'readwrite', st => st.delete(name));
  const pAll = () => tx('projects', 'readonly', st => st.getAll());
  const mGet = k => tx('meta', 'readonly', st => st.get(k));
  const mPut = (k, v) => tx('meta', 'readwrite', st => st.put(v, k));

  const safe = n => String(n || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  let curName = localStorage.getItem('ecoProjName') || '';
  let autoNamed = localStorage.getItem('ecoProjAuto') === '1';   // 사업명을 안 넣어 도면 이름으로 자동 저장 중인지
  let dir = null, dirOk = false;
  const canFolder = !!window.showDirectoryPicker;

  function nameInput() { return $('#projName'); }
  function setName(n, auto) { curName = n || ''; autoNamed = !!auto; localStorage.setItem('ecoProjName', curName); localStorage.setItem('ecoProjAuto', autoNamed ? '1' : '0'); const i = nameInput(); if (i && i.value !== curName) i.value = curName; }
  function ensureName() {
    let n = (nameInput().value || '').trim();
    if (!n) {
      const s = App.sites.find(x => x.geometry);
      n = prompt('사업명을 입력하세요 (저장 이름)', s ? s.name.replace(/\.[^.]+$/, '') : '');
      if (!n || !n.trim()) return null;
      n = n.trim();
    }
    setName(n, false); return n;
  }

  async function writeFolder(name, d) {
    if (!dir || !dirOk) return false;
    const fh = await dir.getFileHandle(safe(name) + '.ecozm', { create: true });
    const w = await fh.createWritable(); await w.write(JSON.stringify(d)); await w.close();
    return true;
  }
  async function saveProject(silent) {
    if (!App.sites.some(s => s.geometry)) { if (!silent) App.toast && App.toast('저장할 도면이 없습니다.', 'warn'); return; }
    const name = silent ? curName : ensureName(); if (!name) return;
    const d = collect(); d.name = name;
    await pPut(name, d);
    let f = false; try { f = await writeFolder(name, d); } catch (e) { if (!silent) App.toast && App.toast('작업 폴더에 쓰지 못했습니다: ' + e.message, 'warn'); }
    const el = $('#autoSaveInfo'); if (el) el.textContent = `${silent ? '자동 저장' : '저장'}: ${name} · ${new Date().toLocaleTimeString('ko-KR')}${f ? ' (작업 폴더 포함)' : ''}`;
    if (!silent) { App.toast && App.toast(`'${name}' 저장했습니다${f ? ' (작업 폴더에도 저장)' : ''}.`, 'ok'); }
    renderList();
  }
  function exportFile() {
    if (!App.sites.some(s => s.geometry)) { App.toast && App.toast('저장할 도면이 없습니다.', 'warn'); return; }
    const name = ensureName(); if (!name) return;
    const d = collect(); d.name = name;
    App.downloadBlob(new Blob([JSON.stringify(d)], { type: 'application/json' }), safe(name) + '.ecozm');
  }
  async function openData(d, label) {
    if (App.sites.length && !confirm('지금 작업을 닫고 다른 작업을 열까요? (지금 작업은 자동 저장되어 있습니다)')) return;
    if (curName && App.sites.some(s => s.geometry)) { try { await saveProject(true); } catch (e) { /* 무시 */ } }
    await restore(d);
    setName(d.name || label || '');
    App.toast && App.toast(`'${d.name || label}' 을(를) 열었습니다 (저장 ${new Date(d.savedAt).toLocaleString('ko-KR')}).`, 'ok');
    renderList();
  }
  async function openFile(file) {
    try { const d = JSON.parse(await file.text()); if (!d.name) d.name = file.name.replace(/\.ecozm$|\.json$/i, ''); await openData(d); }
    catch (e) { App.toast && App.toast('작업 파일을 열지 못했습니다: ' + e.message, 'error'); }
  }
  async function newProject() {
    if (App.sites.length && !confirm('새 작업을 시작할까요? (지금 작업은 자동 저장되어 있습니다)')) return;
    if (curName && App.sites.some(s => s.geometry)) { try { await saveProject(true); } catch (e) { /* 무시 */ } }
    App.clearWork(); setName(''); renderList();
  }

  // ---- 작업 폴더 연결
  async function connectFolder() {
    try {
      dir = await window.showDirectoryPicker({ id: 'ecozm', mode: 'readwrite' });
      dirOk = true; await mPut('dir', dir);
      renderFolder(); renderList();
      if (curName && App.sites.some(s => s.geometry)) saveProject(true);
    } catch (e) { if (e.name !== 'AbortError') App.toast && App.toast('폴더를 연결하지 못했습니다: ' + e.message, 'error'); }
  }
  async function reconnect() {
    if (!dir) return connectFolder();
    try { dirOk = (await dir.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { dirOk = false; }
    renderFolder(); renderList();
  }
  async function loadFolderHandle() {
    if (!canFolder) return;
    try { dir = await mGet('dir'); } catch (e) { dir = null; }
    if (dir) { try { dirOk = (await dir.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { dirOk = false; } }
  }
  function renderFolder() {
    const el = $('#folderRow'); if (!el) return;
    if (!canFolder) { el.innerHTML = '<span class="hint">이 브라우저는 폴더 연결을 지원하지 않습니다 (크롬·엣지에서 가능). 파일로 내보내기/열기를 사용하세요.</span>'; return; }
    el.innerHTML = `<span class="fd-lbl">작업 폴더</span><span class="fd-name ${dir && dirOk ? 'ok' : ''}">${dir ? dir.name + (dirOk ? '' : ' (다시 연결 필요)') : '연결 안 됨'}</span>
      <button type="button" class="btn small" id="btnFolder">${dir ? (dirOk ? '폴더 바꾸기' : '다시 연결') : '폴더 연결'}</button>`;
    $('#btnFolder').onclick = () => (dir && !dirOk ? reconnect() : connectFolder());
  }

  // ---- 사업 목록 (이 브라우저 + 작업 폴더, 최근 순)
  async function renderList() {
    const box = $('#projList'); if (!box) return;
    const map = new Map();
    try { (await pAll() || []).forEach(d => { if (d && d.name) map.set(d.name, { name: d.name, local: d, t: Date.parse(d.savedAt) || 0, n: (d.sites || []).length }); }); } catch (e) { /* 무시 */ }
    if (dir && dirOk) {
      try {
        for await (const [fn, h] of dir.entries()) {
          if (h.kind !== 'file' || !/\.ecozm$/i.test(fn)) continue;
          const f = await h.getFile(); const nm = fn.replace(/\.ecozm$/i, '');
          const e = map.get(nm) || { name: nm, t: 0 };
          e.file = h; e.ft = f.lastModified; e.t = Math.max(e.t || 0, f.lastModified);
          map.set(nm, e);
        }
      } catch (e) { /* 무시 */ }
    }
    const list = [...map.values()].sort((a, b) => b.t - a.t);
    if (!list.length) { box.innerHTML = '<div class="hint">저장된 사업이 없습니다.</div>'; return; }
    box.innerHTML = '<div class="sty-sub">사업 목록</div>' + list.map(e => `<div class="proj-item ${e.name === curName ? 'cur' : ''}">
        <div class="pj-main"><b>${esc(e.name)}</b><span class="pj-meta">${new Date(e.t).toLocaleString('ko-KR')}${e.n ? ' · 도면 ' + e.n + '개' : ''}</span>
          <span class="pj-src">${e.local ? '<span class="tag tag-gray">이 컴퓨터</span>' : ''}${e.file ? '<span class="tag">작업 폴더</span>' : ''}</span></div>
        <button type="button" class="btn small primary" data-popen="${esc(e.name)}">열기</button>
        ${e.local && !e.file ? `<button type="button" class="btn small" data-pdel="${esc(e.name)}" title="이 컴퓨터에서 지우기">삭제</button>` : ''}
      </div>`).join('');
    box.onclick = async ev => {
      const o = ev.target.closest('[data-popen]'), dl = ev.target.closest('[data-pdel]');
      if (dl) { if (confirm(`'${dl.dataset.pdel}' 을(를) 이 컴퓨터에서 지울까요?`)) { await pDel(dl.dataset.pdel); renderList(); } return; }
      if (!o) return;
      const e = map.get(o.dataset.popen); if (!e) return;
      try {
        let d = e.local;
        if (e.file && (!d || e.ft > (Date.parse(d.savedAt) || 0) + 1000)) d = JSON.parse(await (await e.file.getFile()).text());   // 폴더 쪽이 더 최신이면 폴더 파일
        if (!d.name) d.name = e.name;
        await openData(d, e.name);
      } catch (err) { App.toast && App.toast('열지 못했습니다: ' + err.message, 'error'); }
    };
  }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  // ---- 자동 저장
  let timer = null, ready = false, lastSig = '';
  function scheduleAuto() {
    if (!ready) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!App.sites.some(s => s.geometry)) return;
      if (!curName) { const s = App.sites.find(x => x.geometry); setName(s.name.replace(/\.[^.]+$/, ''), true); }
      // 바뀐 게 있을 때만 저장 (도형 전체를 모으는 collect 는 비싸므로 가벼운 값으로 먼저 비교)
      const sig = JSON.stringify([App.sites.map(s => [s.name, s.area, s.opacity, s.category]), App.eczmCount, App.protRows ? App.protRows().map(r => r.key + r.arrow) : 0, App.opts, App.layout && App.layout.getL ? App.layout.getL() : 0, App.src.arrows.getFeatures().map(f => f.get('key') + f.get('on')), App.ecvamResult ? !!App.ecvamResult() : 0]);
      if (sig === lastSig) return; lastSig = sig;
      try { await saveProject(true); } catch (e) { /* 저장 공간 부족 등은 무시 */ }
    }, 4000);
  }
  async function offerRestore() {
    const box = $('#restoreBanner'); if (!box) return;
    let last = null;
    try { const all = await pAll() || []; last = all.sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0))[0]; } catch (e) { last = null; }
    // 예전 자동 저장(kv:last) 옮기기
    try { const old = await tx('kv', 'readonly', st => st.get('last')); if (old && (old.sites || []).length) { old.name = old.name || (old.sites[0].name || '이전 작업').replace(/\.[^.]+$/, ''); await pPut(old.name, old); await tx('kv', 'readwrite', st => st.delete('last')); if (!last) last = old; } } catch (e) { /* 무시 */ }
    if (!last || App.sites.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div>최근 작업 : <b>${esc(last.name)}</b></div><ul class="bullets"><li>저장 ${new Date(last.savedAt).toLocaleString('ko-KR')}</li></ul>
      <div class="row"><button class="btn primary small" type="button" id="btnResume">이어서 하기</button><button class="btn small" type="button" id="btnHideResume">닫기</button></div>`;
    $('#btnResume').onclick = async () => { box.hidden = true; try { await restore(last); setName(last.name); renderList(); App.toast && App.toast(`'${last.name}' 을(를) 이어서 엽니다.`, 'ok'); } catch (e) { App.toast && App.toast('불러오기 실패: ' + e.message, 'error'); } };
    $('#btnHideResume').onclick = () => { box.hidden = true; };
  }

  async function build() {
    // 새로 열면 사업명은 비워 둠 (지난 사업 이름으로 새 도면이 덮어써지지 않도록). '이어서 하기'나 목록에서 열면 그 이름으로 바뀜
    setName('', false);
    nameInput().addEventListener('change', async () => {
      const old = curName, wasAuto = autoNamed, n = nameInput().value.trim();
      setName(n);
      // 자동 이름으로 저장되던 작업에 사업명을 붙이면 자동 이름 항목은 지우고 새 이름으로 저장
      if (n && old && old !== n && App.sites.some(s => s.geometry)) { if (wasAuto) { try { await pDel(old); } catch (e) { /* 무시 */ } } lastSig = ''; saveProject(true).catch(() => {}); }
    });
    $('#btnSaveWork').addEventListener('click', () => saveProject(false));
    $('#btnNewWork').addEventListener('click', newProject);
    $('#btnExportWork').addEventListener('click', exportFile);
    const fi = $('#workFile');
    $('#btnOpenWork').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { const f = fi.files[0]; fi.value = ''; if (f) openFile(f); });
    App.listeners.push(scheduleAuto);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ready && curName && App.sites.some(s => s.geometry)) { lastSig = ''; saveProject(true).catch(() => {}); } });
    await loadFolderHandle(); renderFolder();
    await offerRestore(); renderList();
    ready = true;
  }
  App.project = { collect, restore, saveProject };
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
