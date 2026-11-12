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
      catStyle: App.catStyle,
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

  // ------------------------------------------------------------ 파일 저장 / 열기
  function baseName() {
    const s = App.sites.find(x => x.geometry);
    return (s ? s.name.replace(/\.[^.]+$/, '') : '작업') + '_' + new Date().toISOString().slice(0, 10);
  }
  function saveFile() {
    if (!App.sites.some(s => s.geometry)) { App.toast && App.toast('저장할 도면이 없습니다.', 'warn'); return; }
    const blob = new Blob([JSON.stringify(collect())], { type: 'application/json' });
    App.downloadBlob(blob, baseName() + '.ecozm');
    App.toast && App.toast('작업 파일을 저장했습니다. 다음에 "작업 열기"로 불러오세요.', 'ok');
  }
  async function openFile(file) {
    try {
      const d = JSON.parse(await file.text());
      if (App.sites.length && !confirm('지금 작업을 지우고 작업 파일을 불러올까요?')) return;
      await restore(d);
      App.toast && App.toast(`작업을 불러왔습니다 (${(d.sites || []).length}개 도면, 저장 ${new Date(d.savedAt).toLocaleString('ko-KR')})`, 'ok');
    } catch (e) { App.toast && App.toast('작업 파일을 열지 못했습니다: ' + e.message, 'error'); }
  }

  // ------------------------------------------------------------ 자동 저장 (IndexedDB)
  const DB = 'ecozm', STORE = 'kv', KEY = 'last';
  const idb = () => new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  async function idbSet(v) { const db = await idb(); await new Promise((ok, no) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, KEY); t.oncomplete = ok; t.onerror = () => no(t.error); }); db.close(); }
  async function idbGet() { const db = await idb(); const v = await new Promise((ok, no) => { const t = db.transaction(STORE, 'readonly'); const q = t.objectStore(STORE).get(KEY); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); db.close(); return v; }
  async function idbDel() { const db = await idb(); await new Promise(ok => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(KEY); t.oncomplete = ok; t.onerror = ok; }); db.close(); }

  let timer = null, ready = false, lastSig = '';
  function scheduleAuto() {
    if (!ready) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!App.sites.some(s => s.geometry)) return;
      try {
        const d = collect();
        const sig = JSON.stringify([d.sites.length, d.sites.map(s => s.area), d.eco && d.eco.eczmCount, d.prot && d.prot.rows.length, d.opts, d.layout, d.arrows.features.length]);
        if (sig === lastSig) return; lastSig = sig;
        await idbSet(d);
        const el = $('#autoSaveInfo'); if (el) el.textContent = '자동 저장됨 ' + new Date().toLocaleTimeString('ko-KR');
      } catch (e) { /* 저장 공간 부족 등은 무시 */ }
    }, 4000);
  }

  async function offerRestore() {
    let d = null; try { d = await idbGet(); } catch (e) { d = null; }
    const box = $('#restoreBanner'); if (!box) return;
    if (!d || !(d.sites || []).length || App.sites.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div>지난 작업이 있습니다</div>
      <ul class="bullets"><li>${d.sites.map(s => s.name).join(', ')}</li><li>저장 ${new Date(d.savedAt).toLocaleString('ko-KR')}</li></ul>
      <div class="row"><button class="btn primary small" type="button" id="btnResume">이어서 하기</button><button class="btn small" type="button" id="btnDropLast">지우기</button></div>`;
    $('#btnResume').onclick = async () => { box.hidden = true; try { await restore(d); App.toast && App.toast('지난 작업을 불러왔습니다.', 'ok'); } catch (e) { App.toast && App.toast('불러오기 실패: ' + e.message, 'error'); } };
    $('#btnDropLast').onclick = async () => { await idbDel(); box.hidden = true; };
  }

  function build() {
    $('#btnSaveWork').addEventListener('click', saveFile);
    const fi = $('#workFile');
    $('#btnOpenWork').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { const f = fi.files[0]; fi.value = ''; if (f) openFile(f); });
    App.listeners.push(scheduleAuto);
    offerRestore().finally(() => { ready = true; });
    // 창을 닫거나 다른 탭으로 갈 때 바로 저장 (설정만 바꾼 경우도 포함)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ready && App.sites.some(s => s.geometry)) { lastSig = ''; idbSet(collect()).catch(() => {}); } });
    setInterval(() => { if (ready) scheduleAuto(); }, 30000);
  }
  App.project = { collect, restore, saveFile };
  const origInit = App.init;
  App.init = async function () { await origInit.apply(this, arguments); build(); };
})();
