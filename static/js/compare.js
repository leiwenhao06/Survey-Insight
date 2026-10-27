/* ============================================================
   Survey Insight — big-data benchmark comparison
   ============================================================ */
(function () {
  const App = window.App;
  const S = () => App.state;
  const charts = App.charts;
  App.pages = App.pages || {};

  const cmpCache = new Map();

  function e(v) { return App.escape(v); }
  function cardHead(title, sub, tools = '') {
    return `<div class="card-head"><div><h3 class="card-title">${e(title)}</h3>${sub ? `<p class="card-sub">${e(sub)}</p>` : ''}</div>${tools ? `<div class="card-tools">${tools}</div>` : ''}</div>`;
  }

  App.pages.compare = {
    async load(force = false) {
      const root = document.getElementById('page-compare');
      if (!root) return;
      if (!S().surveyId) {
        root.innerHTML = `<div class="panel-empty"><h3>还没有问卷数据</h3><p>请先导入问卷明细，再接入大数据统计基准进行对比。</p><div class="pe-actions"><button class="btn primary" data-import>导入问卷</button></div></div>`;
        return;
      }
      if (!S().baselineId) {
        renderPrompt(root);
        bindPrompt(root);
        return;
      }
      root.innerHTML = App.loadingHTML('正在对齐基准题目…', 2);
      try {
        let meta = S().caches.comparisonMeta;
        if (!meta || force) {
          meta = await App.get('/api/comparison/meta', { survey_id: S().surveyId, baseline_id: S().baselineId });
          S().caches.comparisonMeta = meta;
          if (meta.baseline && meta.baseline.name) S().baselineName = meta.baseline.name;
        }
        buildLayout(root, meta);
      } catch (err) {
        if (/不存在|过期/.test(err.message)) {
          App.clearBaseline();
          renderPrompt(root, '基准数据集已过期，请重新上传。');
          bindPrompt(root);
        } else {
          root.innerHTML = `<div class="panel-empty"><h3>基准数据读取失败</h3><p>${e(err.message)}</p><div class="pe-actions"><button class="btn ghost" data-import>重新导入</button></div></div>`;
        }
      }
    },
    onBaselineChange() {
      this.load(true);
    },
    reset() {
      cmpCache.clear();
    },
  };

  /* ---------------------------------------------------------------- no baseline */
  function renderPrompt(root, note) {
    root.innerHTML = `
      <div class="panel-empty">
        <div class="pe-icon">
          <svg width="42" height="42" viewBox="0 0 42 42" fill="none"><path d="M7 33V21m9 12V11m9 22V17m9 16V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 37h34" stroke="currentColor" stroke-width="1.2" opacity=".4"/></svg>
        </div>
        <h3>接入大数据基准，看看你的样本偏差</h3>
        <p>上传一份聚合后的统计结果（题目 / 选项 / 比例或频数），系统会自动对齐题目口径，计算分布重合度、逐项偏差与显著性检验。${note ? `<br><strong class="terra">${e(note)}</strong>` : ''}</p>
        <div class="pe-actions">
          <label class="btn primary" for="cmp-file">上传基准数据</label>
          <input type="file" id="cmp-file" hidden accept=".csv,.tsv,.xlsx,.xls">
          <button class="btn ghost" id="cmp-sample" type="button">载入示例基准</button>
          <a class="btn ghost" href="/api/template/baseline">下载格式示例 ↓</a>
        </div>
        <label class="dz-mini" id="cmp-drop">也可以将 CSV / Excel 文件拖拽到这里</label>
        <div class="note-box" style="max-width:560px;margin:16px auto 0;text-align:left">
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6.2" stroke="currentColor" stroke-width="1.2"/><path d="M7.5 4.5v3.6M7.5 10.4v.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span>基准数据至少需要「题目」「选项」两列，以及「比例(%) / 占比 / 百分比」或「频数 / 人数」中的一列。若比例是 0–1 小数，系统会自动换算为百分数。</span>
        </div>
      </div>`;
  }

  function bindPrompt(root) {
    const input = document.getElementById('cmp-file');
    const drop = document.getElementById('cmp-drop');
    if (input) input.addEventListener('change', () => {
      if (input.files && input.files[0]) uploadBaseline(input.files[0]);
    });
    const sample = document.getElementById('cmp-sample');
    if (sample) sample.addEventListener('click', loadSampleBaseline);
    if (drop) {
      drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.style.borderColor = 'var(--green-3)'; });
      drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
      drop.addEventListener('drop', (ev) => {
        ev.preventDefault();
        drop.style.borderColor = '';
        const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (file) uploadBaseline(file);
      });
    }
    if (root) { /* 绑定完成 */ }
  }

  async function uploadBaseline(file) {
    const fd = new FormData();
    fd.append('kind', 'baseline');
    fd.append('file', file);
    App.toast('正在解析基准数据…');
    try {
      const res = await App.upload('/api/upload', fd);
      App.setBaseline(res.dataset_id, res.summary);
      App.toast('基准数据已导入，正在对齐题目。', 'success');
      App.pages.compare.onBaselineChange();
    } catch (err) {
      App.toast(err.message, 'error', 5200);
    }
  }

  async function loadSampleBaseline() {
    App.toast('正在载入示例基准…');
    try {
      const res = await App.post('/api/sample-baseline', {});
      App.setBaseline(res.dataset_id, res.summary);
      App.toast('示例基准已载入。', 'success');
      App.pages.compare.onBaselineChange();
    } catch (err) {
      App.toast(err.message, 'error', 5200);
    }
  }

  /* ---------------------------------------------------------------- layout */
  function buildLayout(root, meta) {
    const matches = meta.matches || [];
    const surveyQs = meta.survey_questions || [];
    if (!matches.length || !surveyQs.length) {
      root.innerHTML = `<div class="panel-empty"><h3>无法建立对比</h3><p>基准数据中没有题目，或问卷中没有可用于对比的单选题/多选题/量表题。</p><div class="pe-actions"><button class="btn ghost" data-import>重新导入</button></div></div>`;
      return;
    }
    let bq = S().compare.bq && matches.some((m) => m.baseline_question === S().compare.bq)
      ? S().compare.bq
      : ((matches.find((m) => m.suggested) || matches[0]).baseline_question);
    let match = matches.find((m) => m.baseline_question === bq) || matches[0];
    let sq = S().compare.sq && surveyQs.some((q) => q.name === S().compare.sq) && S().compare.bq === bq
      ? S().compare.sq
      : (match.suggested || surveyQs[0].name);
    S().compare.bq = bq;
    S().compare.sq = sq;

    const baseline = meta.baseline || {};
    root.innerHTML = `
      <div class="baseline-info">
        <div class="bi-mark">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 14V9m4 5V5m4 9V7m4 7V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </div>
        <div class="bi-copy">
          <h4>${e(baseline.name || S().baselineName || '大数据基准')}</h4>
          <p>${App.fmtInt(baseline.questions || 0)} 道基准题目 · ${App.fmtInt(baseline.rows || 0)} 行记录 · 自动匹配 ${meta.matched_count} / ${matches.length} 道${baseline.has_count ? ' · 含频数信息' : ''}</p>
        </div>
        <div class="chip-row">
          ${meta.matched_count ? `<span class="chip good"><span class="dot"></span>已自动对齐 ${meta.matched_count} 题</span>` : `<span class="chip warn">题目名称未自动匹配，请手动选择</span>`}
          <button class="btn subtle sm" id="cmp-change">更换基准</button>
        </div>
      </div>
      <div class="compare-layout">
        <aside class="match-panel">
          <div class="match-head">
            <h3>基准题目</h3>
            <p>点击切换；箭头指向自动匹配的问卷题目</p>
          </div>
          <div class="match-list">
            ${matches.map((m) => `
              <button class="match-item ${m.baseline_question === bq ? 'active' : ''}" data-bq="${e(m.baseline_question)}">
                <div class="match-name"><span class="level-dot ${m.suggested ? 'good' : 'warn'}"></span>${e(m.baseline_question)}</div>
                <div class="match-sub">
                  <span class="${m.suggested ? 'ok' : 'none'}">${m.suggested ? `→ ${e(m.suggested)}` : '未匹配，需手动选择'}</span>
                  <span>${m.options_count} 项</span>
                  <span>${App.fmt(m.sum_pct, 1)}%</span>
                </div>
              </button>`).join('')}
          </div>
        </aside>
        <div class="compare-main">
          <div class="compare-selects">
            <div class="field"><label>基准题目</label><select id="cmp-bq">${matches.map((m) => `<option value="${e(m.baseline_question)}"${m.baseline_question === bq ? ' selected' : ''}>${e(m.baseline_question)}</option>`).join('')}</select></div>
            <div class="field"><label>对应问卷题目</label><select id="cmp-sq">${surveyQs.map((q) => `<option value="${e(q.name)}"${q.name === sq ? ' selected' : ''}>${e(q.name)} · ${e(q.type_label)}</option>`).join('')}</select></div>
            <button class="btn primary" id="cmp-run" type="button">重新对比</button>
          </div>
          <div id="cmp-result"></div>
        </div>
      </div>`;

    const bqSel = document.getElementById('cmp-bq');
    const sqSel = document.getElementById('cmp-sq');
    const change = document.getElementById('cmp-change');
    if (change) change.addEventListener('click', () => App.openImport());
    document.getElementById('cmp-run').addEventListener('click', () => runCompare());
    bqSel.addEventListener('change', () => {
      S().compare.bq = bqSel.value;
      const m = matches.find((x) => x.baseline_question === S().compare.bq);
      if (m && m.suggested) {
        S().compare.sq = m.suggested;
        sqSel.value = m.suggested;
      }
      updateActiveMatch(matches, S().compare.bq);
      runCompare();
    });
    sqSel.addEventListener('change', () => {
      S().compare.sq = sqSel.value;
      runCompare();
    });
    document.querySelector('.match-list').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.match-item');
      if (!btn) return;
      const nextBq = btn.dataset.bq;
      const m = matches.find((x) => x.baseline_question === nextBq);
      S().compare.bq = nextBq;
      bqSel.value = nextBq;
      if (m && m.suggested) {
        S().compare.sq = m.suggested;
        sqSel.value = m.suggested;
      }
      updateActiveMatch(matches, nextBq);
      runCompare();
    });
    runCompare();
  }

  function updateActiveMatch(matches, bq) {
    document.querySelectorAll('.match-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.bq === bq);
    });
  }

  /* ---------------------------------------------------------------- compare */
  async function runCompare() {
    const result = document.getElementById('cmp-result');
    if (!result) return;
    const bq = S().compare.bq;
    const sq = S().compare.sq;
    if (!bq || !sq) return;
    const key = `${bq}|||${sq}`;
    if (cmpCache.has(key)) {
      renderCompare(result, cmpCache.get(key));
      return;
    }
    result.innerHTML = App.loadingHTML('正在对齐选项并执行显著性检验…', 2);
    try {
      const data = await App.post('/api/compare', {
        dataset_id: S().surveyId,
        baseline_id: S().baselineId,
        baseline_question: bq,
        survey_question: sq,
      });
      cmpCache.set(key, data);
      renderCompare(result, data);
    } catch (err) {
      result.innerHTML = `<div class="panel-empty"><h3>对比未完成</h3><p>${e(err.message)}</p><div class="pe-actions"><button class="btn ghost" id="cmp-change-inline">更换基准数据</button></div></div>`;
      const b = document.getElementById('cmp-change-inline');
      if (b) b.addEventListener('click', () => App.openImport());
    }
  }

  function renderCompare(result, data) {
    const sim = data.similarity;
    const simColor = sim >= 90 ? '#2F5D50' : sim >= 80 ? '#C8A558' : '#B85C3E';
    const biggest = data.biggest;
    const overall = data.overall || {};
    const chartRows = data.rows.slice(0, 13).map((r) => ({ label: r.option, a: r.survey_pct, b: r.baseline_pct }));
    const diffCell = (v) => {
      const cls = v > 0 ? 'diff-positive' : v < 0 ? 'diff-negative' : 'diff-zero';
      return `<span class="${cls}">${App.signed(v, 1)}</span>`;
    };
    result.innerHTML = `
      <div class="similarity-hero">
        <div class="sim-ring" id="sim-ring"></div>
        <div class="sim-copy">
          <div class="sim-kicker">BENCHMARK MATCH / 大数据对照</div>
          <h3 class="sim-title">「${e(data.baseline_question)}」<span class="faint" style="font-weight:400">×</span> 「${e(data.survey_question)}」</h3>
          <p class="sim-desc">${e(data.interpretation)}</p>
          <div class="sim-badges">
            <span class="chip ${sim >= 80 ? 'good' : 'warn'}"><span class="dot"></span>${e(data.similarity_level)}</span>
            <span class="chip">${e(data.similarity_name)} ${App.fmt(sim, 1)}%</span>
            <span class="chip">问卷 N=${App.fmtInt(data.n_survey)}</span>
            ${overall.valid ? `<span class="chip ${overall.p < 0.05 ? 'warn' : ''}">整体分布 ${e(overall.p_text)}</span>` : ''}
            <span class="chip plain">${e(data.question_type_label)}</span>
          </div>
        </div>
      </div>

      <div class="stat-row">
        <div class="stat-tile"><div class="k">最大偏差选项</div><div class="v" style="font-size:13px">${biggest ? e(biggest.option) : '—'}</div></div>
        <div class="stat-tile"><div class="k">偏差幅度</div><div class="v">${biggest ? `<span class="${biggest.diff > 0 ? 'terra' : 'green'}">${App.signed(biggest.diff, 1)}</span><small> pp</small>` : '—'}</div></div>
        <div class="stat-tile"><div class="k">整体检验</div><div class="v" style="font-size:13px">${overall.valid ? e(overall.test) : '未执行'}</div></div>
        <div class="stat-tile"><div class="k">基准口径</div><div class="v" style="font-size:13px">${data.baseline_has_count ? '含频数' : '仅比例'}</div></div>
        <div class="stat-tile"><div class="k">仅问卷选项</div><div class="v">${data.only_survey}<small> 个</small></div></div>
        <div class="stat-tile"><div class="k">仅基准选项</div><div class="v">${data.only_base}<small> 个</small></div></div>
      </div>

      <div class="card">
        ${cardHead('分布对比', `问卷占比与大数据的逐项对照${data.rows.length > 13 ? '（图表展示前 13 项）' : ''}`)}
        <div id="cmp-chart"></div>
        <div class="chart-note">差异 = 问卷占比 − 基准占比（百分点）。正值表示问卷样本在该选项上更高；逐项 p 值来自比例差异的 z 检验，整体检验为卡方拟合优度。</div>
      </div>

      <div class="card compare-table-card">
        ${cardHead('逐项差异表', `基准合计 ${App.fmt(data.baseline_total, 1)}% · ${e(data.method_note)}`)}
        <div class="table-wrap tall">
          <table class="data">
            <thead><tr><th class="col-option">选项</th><th class="num">问卷占比</th><th class="num">基准占比</th><th class="num">差异 (pp)</th><th class="num">显著性</th><th>状态</th></tr></thead>
            <tbody>${data.rows.map((r) => `
              <tr>
                <td class="label-cell">${e(r.option)}</td>
                <td class="num">${App.fmt(r.survey_pct, 2)}%</td>
                <td class="num">${App.fmt(r.baseline_pct, 2)}%</td>
                <td class="num strong">${diffCell(r.diff)}</td>
                <td class="num">${r.p != null ? `${e(r.p_text)} <span class="stars">${e(r.stars || '')}</span>` : '—'}</td>
                <td>${r.status === 'survey_only' ? '<span class="chip warn">仅问卷</span>' : r.status === 'baseline_only' ? '<span class="chip plain">仅基准</span>' : '<span class="faint">—</span>'}</td>
              </tr>`).join('')}</tbody>
            ${overall.valid ? `<tfoot><tr><td>整体分布检验</td><td colspan="2" class="num">${e(overall.test)}</td><td class="num">χ²=${App.fmt(overall.stat, 2)}</td><td class="num">${e(overall.p_text)}</td><td></td></tr></tfoot>` : ''}
          </table>
        </div>
        ${overall.warning ? `<div class="warn-note">${e(overall.warning)}</div>` : ''}
        ${(data.caveats || []).length ? `<div class="caveats">${data.caveats.map((c) => `<div class="caveat">${e(c)}</div>`).join('')}</div>` : ''}
      </div>`;

    charts.ring(document.getElementById('sim-ring'), {
      value: sim,
      max: 100,
      display: `${App.fmt(sim, 1)}%`,
      label: data.similarity_name.replace('分布', ''),
      color: simColor,
    });
    charts.groupedBarH(document.getElementById('cmp-chart'), {
      rows: chartRows,
      series: [
        { name: '问卷样本', color: '#2F5D50' },
        { name: '大数据基准', color: '#C8A558' },
      ],
      suffix: '%',
      max: 100,
    });
  }
}());
