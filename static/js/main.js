/* ============================================================
   Survey Insight — app shell, navigation, data intake
   ============================================================ */
(function () {
  const App = window.App;
  const S = () => App.state;

  const PAGE_META = {
    overview: {
      title: '数据概览',
      eyebrow: 'ANALYSIS WORKSPACE / 01',
      subtitle: '从答卷明细到可读结论，一张工作台完成全部分析。',
    },
    frequency: {
      title: '单题分析',
      eyebrow: 'ANALYSIS WORKSPACE / 02',
      subtitle: '逐题查看频数、集中趋势与开放题高频词，先理解每一道题。',
    },
    crosstab: {
      title: '交叉分析',
      eyebrow: 'ANALYSIS WORKSPACE / 03',
      subtitle: '比较两个变量的关系，并给出可直接引用的统计检验结果。',
    },
    correlation: {
      title: '相关与信度',
      eyebrow: 'ANALYSIS WORKSPACE / 04',
      subtitle: '查看量表内部一致性与数值指标之间的关联结构。',
    },
    compare: {
      title: '大数据对比',
      eyebrow: 'ANALYSIS WORKSPACE / 05',
      subtitle: '把问卷样本与大数据统计结果对齐，量化偏差与显著性。',
    },
    insights: {
      title: '洞察与导出',
      eyebrow: 'ANALYSIS WORKSPACE / 06',
      subtitle: '汇总可引用的结论，导出 Excel 工作簿或打印分析报告。',
    },
  };

  let sampleBusy = false;
  let modalOpen = false;

  /* ---------------------------------------------------------------- boot */
  function init() {
    bindShell();
    bindModal();
    App.restoreIds();
    App.refreshDatasetBar = refreshDatasetBar;
    App.loadQuestions = loadQuestions;
    App.go = go;
    App.setBaseline = setBaseline;
    App.clearBaseline = clearBaseline;
    App.openImport = openImport;
    App.closeImport = closeImport;
    App.exportExcel = exportExcel;
    refreshDatasetBar();
    bootExisting();
  }

  async function bootExisting() {
    if (!S().surveyId) return;
    try {
      const [overview, qs] = await Promise.all([
        App.get('/api/overview', { dataset_id: S().surveyId }),
        App.get('/api/questions', { dataset_id: S().surveyId }),
      ]);
      S().surveyName = overview.dataset.name;
      S().rows = overview.kpi.rows;
      S().questions = qs.questions || [];
      S().caches.overview = overview;
      if (S().baselineId) await validateBaseline();
      refreshDatasetBar();
      App.persist();
      await go('overview');
    } catch (err) {
      App.resetData();
      refreshDatasetBar();
      App.toast('上次载入的数据已失效，请重新导入。', 'error');
    }
  }

  async function validateBaseline() {
    try {
      const meta = await App.get('/api/comparison/meta', {
        survey_id: S().surveyId,
        baseline_id: S().baselineId,
      });
      S().baselineName = meta.baseline.name;
      S().baselineSummary = meta.baseline;
      S().caches.comparisonMeta = meta;
    } catch (err) {
      S().baselineId = null;
      S().baselineName = '';
      S().baselineSummary = null;
      App.persist();
    }
  }

  async function loadQuestions() {
    const res = await App.get('/api/questions', { dataset_id: S().surveyId });
    S().questions = res.questions || [];
    if (res.dataset && res.dataset.name) S().surveyName = res.dataset.name;
    if (res.dataset && res.dataset.rows) S().rows = res.dataset.rows;
    refreshDatasetBar();
    return res;
  }

  /* ---------------------------------------------------------------- shell */
  function bindShell() {
    document.getElementById('nav').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.nav-item');
      if (!btn) return;
      go(btn.dataset.page);
    });
    document.getElementById('btn-import').addEventListener('click', () => openImport());
    document.getElementById('btn-change-data').addEventListener('click', () => openImport());
    document.getElementById('btn-export').addEventListener('click', exportExcel);
    document.getElementById('btn-empty-import').addEventListener('click', () => openImport());
    document.getElementById('btn-empty-sample').addEventListener('click', loadSample);

    document.addEventListener('click', (ev) => {
      const nav = ev.target.closest('[data-goto]');
      if (nav) {
        ev.preventDefault();
        go(nav.dataset.goto);
        return;
      }
      if (ev.target.closest('[data-import]')) {
        ev.preventDefault();
        openImport();
        return;
      }
      if (ev.target.closest('[data-sample]')) {
        ev.preventDefault();
        loadSample();
      }
    });
  }

  async function go(page) {
    if (!PAGE_META[page]) page = 'overview';
    if (!S().surveyId) {
      openImport();
      App.toast('请先导入问卷数据。');
      return;
    }
    S().page = page;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === page));
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('page-root').classList.remove('hidden');
    const meta = PAGE_META[page];
    document.getElementById('page-title').textContent = meta.title;
    document.getElementById('page-eyebrow').textContent = meta.eyebrow;
    document.getElementById('page-subtitle').textContent = meta.subtitle;
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
    const tip = document.getElementById('chart-tip');
    if (tip) tip.classList.add('hidden');
    const loader = App.pages[page];
    if (loader && loader.load) {
      try {
        await loader.load();
      } catch (err) {
        const root = document.getElementById(`page-${page}`);
        if (root) root.innerHTML = `<div class="panel-empty"><h3>页面加载失败</h3><p>${App.escape(err.message)}</p><div class="pe-actions"><button class="btn ghost" data-import>重新导入数据</button></div></div>`;
        App.toast(err.message, 'error');
      }
    }
  }

  function refreshDatasetBar() {
    const bar = document.getElementById('dataset-bar');
    const empty = document.getElementById('empty-state');
    const root = document.getElementById('page-root');
    const sidebar = document.getElementById('sidebar-dataset');
    const exportBtn = document.getElementById('btn-export');
    const hasData = Boolean(S().surveyId);
    if (!hasData) {
      bar.classList.add('hidden');
      empty.classList.remove('hidden');
      root.classList.add('hidden');
      exportBtn.disabled = true;
      sidebar.innerHTML = `<div class="sd-label">当前数据集</div><div class="sd-empty">尚未导入数据</div>`;
      return;
    }
    bar.classList.remove('hidden');
    empty.classList.add('hidden');
    root.classList.remove('hidden');
    exportBtn.disabled = false;
    const overview = S().caches.overview;
    const completion = overview && overview.kpi ? overview.kpi.completion : null;
    const quality = overview && overview.kpi ? overview.kpi.quality_score : null;
    document.getElementById('dataset-name').textContent = S().surveyName || '未命名数据集';
    document.getElementById('dataset-name').title = S().surveyName || '';
    document.getElementById('dataset-meta').textContent = `${App.fmtInt(S().rows)} 份答卷 · ${S().questions.length} 道分析题${completion != null ? ` · 完成率 ${App.fmt(completion, 1)}%` : ''}`;
    const pill = document.getElementById('baseline-pill');
    if (S().baselineId) {
      pill.textContent = `基准：${S().baselineName || '大数据统计结果'}`;
      pill.title = S().baselineName || '';
      pill.classList.add('on');
    } else {
      pill.textContent = '未载入基准数据';
      pill.title = '';
      pill.classList.remove('on');
    }
    sidebar.innerHTML = `
      <div class="sd-label">当前数据集</div>
      <div class="sd-name" title="${App.escape(S().surveyName)}">${App.escape(S().surveyName || '未命名数据集')}</div>
      <div class="sd-stats"><span><strong>${App.fmtInt(S().rows)}</strong> 份</span><span><strong>${S().questions.length}</strong> 题</span>${quality != null ? `<span><strong>${quality}</strong> 分</span>` : ''}</div>
      <div class="sd-baseline ${S().baselineId ? 'on' : ''}">${S().baselineId ? `大数据基准已接入` : '未接入大数据基准'}</div>`;
  }

  function exportExcel() {
    if (!S().surveyId) {
      App.toast('请先导入问卷数据。', 'error');
      return;
    }
    const params = { dataset_id: S().surveyId, baseline_id: S().baselineId || undefined };
    if (S().baselineId && S().compare.bq && S().compare.sq) {
      params.bq = S().compare.bq;
      params.sq = S().compare.sq;
    }
    App.toast('Excel 报告正在生成，下载将自动开始…');
    const a = document.createElement('a');
    a.href = `/api/export/excel${App.qs(params)}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------------------------------------------------------------- import modal */
  function bindModal() {
    const backdrop = document.getElementById('modal-backdrop');
    document.getElementById('modal-close').addEventListener('click', () => closeImport());
    document.getElementById('modal-done').addEventListener('click', () => {
      closeImport();
      if (S().surveyId) go('overview');
    });
    document.getElementById('btn-sample').addEventListener('click', loadSample);
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) closeImport();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modalOpen) closeImport();
    });

    ['survey', 'baseline'].forEach((kind) => {
      const zone = document.getElementById(`drop-${kind}`);
      const input = document.getElementById(`file-${kind}`);
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) handleFile(kind, input.files[0]);
        input.value = '';
      });
      ['dragenter', 'dragover'].forEach((name) => {
        zone.addEventListener(name, (ev) => {
          ev.preventDefault();
          zone.classList.add('dragover');
        });
      });
      ['dragleave', 'dragend'].forEach((name) => {
        zone.addEventListener(name, () => zone.classList.remove('dragover'));
      });
      zone.addEventListener('drop', (ev) => {
        ev.preventDefault();
        zone.classList.remove('dragover');
        const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (file) handleFile(kind, file);
      });
    });
  }

  function openImport() {
    const backdrop = document.getElementById('modal-backdrop');
    backdrop.classList.remove('hidden');
    modalOpen = true;
    document.body.style.overflow = 'hidden';
    renderImportStatuses();
  }

  function closeImport() {
    const backdrop = document.getElementById('modal-backdrop');
    backdrop.classList.add('hidden');
    modalOpen = false;
    document.body.style.overflow = '';
  }

  function renderImportStatuses() {
    const surveyStatus = document.getElementById('status-survey');
    const baselineStatus = document.getElementById('status-baseline');
    if (S().surveyId) {
      surveyStatus.innerHTML = `<div class="file-ok"><span>✓</span><div><strong>${App.escape(S().surveyName)}</strong><br><span class="small muted">${App.fmtInt(S().rows)} 份答卷 · ${S().questions.length} 道分析题</span></div></div>`;
    } else {
      surveyStatus.innerHTML = '';
    }
    if (S().baselineId) {
      const summary = S().baselineSummary || {};
      baselineStatus.innerHTML = `<div class="file-ok"><span>✓</span><div><strong>${App.escape(S().baselineName || '大数据基准')}</strong><br><span class="small muted">${App.fmtInt(summary.questions)} 道基准题目 · ${App.fmtInt(summary.rows)} 行记录</span></div></div>`;
    } else {
      baselineStatus.innerHTML = '';
    }
  }

  async function handleFile(kind, file) {
    const zone = document.getElementById(`drop-${kind}`);
    const status = document.getElementById(`status-${kind}`);
    zone.classList.add('busy');
    status.innerHTML = `<div class="small muted">正在解析「${App.escape(file.name)}」…</div>`;
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      const res = await App.upload('/api/upload', fd);
      if (kind === 'survey') {
        applySurvey(res, { navigate: true });
        App.toast('问卷数据已导入。', 'success');
      } else {
        setBaseline(res.dataset_id, res.summary);
        App.toast('大数据基准已导入。', 'success');
        if (S().page === 'compare') App.pages.compare.load(true);
        if (S().page === 'insights') App.pages.insights.load(true);
      }
      renderImportStatuses();
    } catch (err) {
      status.innerHTML = `<div class="file-err">${App.escape(err.message)}</div>`;
      App.toast(err.message, 'error', 5200);
    } finally {
      zone.classList.remove('busy');
    }
  }

  async function loadSample() {
    if (sampleBusy) return;
    sampleBusy = true;
    App.toast('正在载入示例数据…');
    try {
      const res = await App.post('/api/sample', {});
      applySurvey({
        dataset_id: res.survey_id,
        name: res.survey_name,
        rows: res.rows,
        questions: res.questions || [],
      }, { navigate: false });
      if (res.baseline_id) {
        setBaseline(res.baseline_id, res.baseline_summary);
      }
      closeImport();
      await go('overview');
      App.toast('示例数据已载入，包含问卷明细与大数据基准。', 'success');
    } catch (err) {
      App.toast(err.message, 'error', 5200);
    } finally {
      sampleBusy = false;
    }
  }

  function applySurvey(res, opts = { navigate: true }) {
    S().surveyId = res.dataset_id;
    S().surveyName = res.name || '未命名数据集';
    S().rows = res.rows || 0;
    S().questions = res.questions || [];
    App.clearCaches();
    S().freqQuestion = null;
    ['frequency', 'crosstab', 'correlation', 'compare'].forEach((p) => {
      if (App.pages[p] && App.pages[p].reset) App.pages[p].reset();
    });
    App.persist();
    refreshDatasetBar();
    if (opts.navigate !== false) go('overview');
  }

  function setBaseline(datasetId, summary) {
    S().baselineId = datasetId;
    S().baselineName = (summary && summary.name) || '大数据基准';
    S().baselineSummary = summary || null;
    S().caches.comparisonMeta = null;
    S().caches.comparisons = {};
    S().caches.insights = null;
    if (App.pages.compare && App.pages.compare.reset) App.pages.compare.reset();
    App.persist();
    refreshDatasetBar();
    renderImportStatuses();
  }

  function clearBaseline() {
    S().baselineId = null;
    S().baselineName = '';
    S().baselineSummary = null;
    S().caches.comparisonMeta = null;
    S().caches.comparisons = {};
    S().caches.insights = null;
    if (App.pages.compare && App.pages.compare.reset) App.pages.compare.reset();
    App.persist();
    refreshDatasetBar();
    renderImportStatuses();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
