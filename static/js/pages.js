/* ============================================================
   Survey Insight — overview & single-question pages
   ============================================================ */
(function () {
  const App = window.App;
  const S = () => App.state;
  const charts = App.charts;
  App.pages = App.pages || {};

  function e(v) { return App.escape(v); }
  function metric(label, value, note, cls = '') {
    return `<div class="metric ${cls}">
      <div class="metric-label">${e(label)}</div>
      <div class="metric-value">${value}</div>
      ${note ? `<div class="metric-note">${e(note)}</div>` : ''}
    </div>`;
  }
  function cardHead(title, sub, tools = '') {
    return `<div class="card-head"><div><h3 class="card-title">${e(title)}</h3>${sub ? `<p class="card-sub">${e(sub)}</p>` : ''}</div>${tools ? `<div class="card-tools">${tools}</div>` : ''}</div>`;
  }
  function qualityBand(score) {
    if (score >= 90) return '数据质量优秀';
    if (score >= 80) return '数据质量良好';
    if (score >= 70) return '质量尚可，建议核查';
    return '质量偏低，需重点清洗';
  }

  /* ================================================================ overview */
  App.pages.overview = {
    async load(force = false) {
      const root = document.getElementById('page-overview');
      if (!root) return;
      if (!S().surveyId) { root.innerHTML = notReady(); return; }
      if (S().caches.overview && !force) {
        renderOverview(root, S().caches.overview);
        return;
      }
      root.innerHTML = App.loadingHTML('正在读取数据画像…', 3);
      try {
        const data = await App.get('/api/overview', { dataset_id: S().surveyId });
        S().caches.overview = data;
        if (App.refreshDatasetBar) App.refreshDatasetBar();
        renderOverview(root, data);
      } catch (err) {
        root.innerHTML = `<div class="panel-empty"><h3>分析失败</h3><p>${e(err.message)}</p></div>`;
      }
    },
  };

  function notReady() {
    return `<div class="panel-empty"><h3>还没有可分析的数据</h3><p>请先导入问卷明细数据，或载入示例数据体验完整流程。</p>
      <div class="pe-actions"><button class="btn primary" data-import>导入数据</button><button class="btn ghost" data-sample>载入示例数据</button></div></div>`;
  }

  function renderOverview(root, data) {
    const kpi = data.kpi;
    const types = data.type_counts || [];
    const typeSummary = types.map((t) => `${t.name.replace('题', '')} ${t.value}`).join(' · ');
    const dateRange = data.date_range;
    const lowCount = (data.low_completion || []).length;
    const insights = data.insights || [];
    const comps = data.completion_by_question || [];
    const minComp = comps.length ? comps[0] : null;
    const avgComp = comps.length ? comps.reduce((sum, q) => sum + q.completion, 0) / comps.length : 0;
    const under90 = comps.filter((q) => q.completion < 90).length;

    root.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-index">01 / SAMPLE</div>
          <div class="kpi-label">有效样本</div>
          <div class="kpi-value">${App.fmtInt(kpi.rows)}<small>份</small></div>
          <div class="kpi-sub"><span>${dateRange ? `覆盖 ${dateRange.days} 天` : '未识别时间列'}</span><span class="sep"></span><span>${kpi.questions} 道分析题</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-index">02 / ITEMS</div>
          <div class="kpi-label">分析题目</div>
          <div class="kpi-value">${App.fmtInt(kpi.questions)}<small>道</small></div>
          <div class="kpi-sub"><span>${e(typeSummary)}</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-index">03 / COMPLETE</div>
          <div class="kpi-label">整体完成率</div>
          <div class="kpi-value">${App.fmt(kpi.completion, 1)}<small>%</small></div>
          <div class="kpi-sub"><span class="${kpi.completion >= 90 ? 'good' : 'warn'}">${kpi.completion >= 90 ? '缺失控制良好' : '存在一定缺失'}</span><span class="sep"></span><span>${App.fmtInt(kpi.missing_cells)} 个缺失单元格</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-index">04 / QUALITY</div>
          <div class="kpi-label">数据质量分</div>
          <div class="kpi-value">${kpi.quality_score}<small>/ 100</small></div>
          <div class="kpi-sub"><span class="${kpi.quality_score >= 80 ? 'good' : 'warn'}">${qualityBand(kpi.quality_score)}</span><span class="sep"></span><span>${kpi.duplicates} 重复 · ${kpi.straight_liners} 直线</span></div>
        </div>
      </div>

      <div class="grid g-overview">
        <div class="card completion-card">
          ${cardHead('各题答题率', '按完成率从低到高排列；低于 80% 的题目以赭色标记。', `<button class="link-btn" data-goto="frequency">单题分析 →</button>`)}
          <div class="completion-scroll" id="completion-chart"></div>
          <div class="chart-note">答题率 = 该题非空回答数 ÷ 有效样本量。可滚动查看全部 ${comps.length} 道题。</div>
          <div class="completion-stats">
            <div class="cs-item"><span>最低答题率</span><strong>${minComp ? App.fmt(minComp.completion, 1) : '—'}%</strong><em>${minComp ? e(minComp.name) : ''}</em></div>
            <div class="cs-item"><span>平均答题率</span><strong>${App.fmt(avgComp, 1)}%</strong><em>全部 ${comps.length} 道题</em></div>
            <div class="cs-item"><span>低于 90% 题目</span><strong>${under90} 道</strong><em>${under90 ? '建议检查必填设置' : '完成情况良好'}</em></div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
          <div class="card">
            ${cardHead('数据质量', '缺失、重复与作答模式综合评估')}
            <div class="quality-flex">
              <div class="quality-ring" id="quality-ring"></div>
              <div class="quality-list">
                <div class="quality-row"><span>重复答卷</span><strong class="${kpi.duplicates ? 'warn' : ''}">${kpi.duplicates} 份</strong></div>
                <div class="quality-row"><span>直线作答</span><strong class="${kpi.straight_liners ? 'warn' : ''}">${kpi.straight_liners} 份</strong></div>
                <div class="quality-row"><span>缺失单元格</span><strong>${App.fmtInt(kpi.missing_cells)} 个</strong></div>
                <div class="quality-row"><span>低完成题目</span><strong class="${lowCount ? 'warn' : ''}">${lowCount} 道</strong></div>
                <div class="quality-row"><span>采集周期</span><strong>${dateRange ? `${e(dateRange.start)} → ${e(dateRange.end)}` : '—'}</strong></div>
                <div class="quality-band">${qualityBand(kpi.quality_score)} · ${kpi.quality_score} / 100</div>
              </div>
            </div>
          </div>

          <div class="card">
            ${cardHead('题型构成', '系统自动识别，可在单题分析中逐题查看')}
            <div id="type-donut"></div>
          </div>
        </div>
      </div>

      <div class="overview-bottom">
        <div class="card">
          <div class="card-head">
            <div><h3 class="card-title">关键发现</h3><p class="card-sub">从数据质量、分布结构与作答模式中自动提取</p></div>
            <div class="card-tools">${insights.filter((i) => i.level === 'warn').length ? `<span class="chip warn">${insights.filter((i) => i.level === 'warn').length} 项需关注</span>` : ''}<button class="link-btn" data-goto="insights">查看全部 →</button></div>
          </div>
          <div class="insight-list">
            ${insights.slice(0, 6).map((ins) => `
              <div class="insight ${ins.level}">
                <span class="level-dot ${ins.level} insight-mark"></span>
                <div><p class="insight-title">${e(ins.title)}</p><p class="insight-text">${e(ins.text)}</p></div>
                <span class="insight-tag">${e(ins.tag)}</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="card">
          ${cardHead('下一步', '沿着分析路径继续深入')}
          <div class="next-steps">
            <button class="next-step" data-goto="frequency"><span class="ns-num">02</span><span class="ns-copy"><h4>逐题拆解</h4><p>频数、均值与开放题高频词</p></span><span class="ns-arrow">→</span></button>
            <button class="next-step" data-goto="crosstab"><span class="ns-num">03</span><span class="ns-copy"><h4>交叉分析</h4><p>组间差异与卡方检验</p></span><span class="ns-arrow">→</span></button>
            <button class="next-step" data-goto="correlation"><span class="ns-num">04</span><span class="ns-copy"><h4>相关与信度</h4><p>量表一致性、指标关联</p></span><span class="ns-arrow">→</span></button>
            <button class="next-step" data-goto="compare"><span class="ns-num">05</span><span class="ns-copy"><h4>大数据对比</h4><p>与外部基准的偏差和显著性</p></span><span class="ns-arrow">→</span></button>
          </div>
        </div>
      </div>`;

    charts.ring(document.getElementById('quality-ring'), {
      value: kpi.quality_score,
      max: 100,
      label: '质量分',
      display: String(kpi.quality_score),
    });
    charts.donut(document.getElementById('type-donut'), {
      items: types.map((t) => ({ label: t.name, value: t.value })),
      centerValue: String(kpi.questions),
      centerLabel: '道分析题',
      suffix: ' 道',
      maxSlices: 6,
    });
    charts.barH(document.getElementById('completion-chart'), {
      items: (data.completion_by_question || []).map((q) => ({ label: q.name, value: q.completion })),
      suffix: '%',
      rowH: 32,
      color: (d) => charts.completionColor(d.value),
    });
  }

  /* ================================================================ frequency */
  let freqLayoutBuilt = false;

  App.pages.frequency = {
    async load() {
      const root = document.getElementById('page-frequency');
      if (!root) return;
      if (!S().surveyId) { root.innerHTML = notReady(); return; }
      if (!S().questions.length) {
        await App.loadQuestions();
      }
      if (!freqLayoutBuilt) {
        buildFrequencyLayout(root);
        freqLayoutBuilt = true;
      }
      const first = S().freqQuestion || (S().questions.find((q) => q.type === 'single') || S().questions[0] || {}).name;
      if (first) {
        await loadFrequency(first);
      } else {
        document.getElementById('freq-main').innerHTML = `<div class="panel-empty"><h3>没有可分析的题目</h3></div>`;
      }
    },
  };

  function buildFrequencyLayout(root) {
    root.innerHTML = `
      <div class="workbench">
        <aside class="q-panel">
          <div class="q-panel-head">
            <div class="q-panel-title">题目<span>${S().questions.length} ITEMS</span></div>
            <div class="q-search">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="5" r="3.6" stroke="currentColor" stroke-width="1.2"/><path d="M8 8l2.6 2.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              <input type="text" id="q-search" placeholder="搜索题目…" autocomplete="off">
            </div>
          </div>
          <div class="q-list" id="q-list"></div>
        </aside>
        <div class="q-main" id="freq-main"></div>
      </div>`;
    renderQuestionList();
    document.getElementById('q-search').addEventListener('input', App.debounce((ev) => {
      renderQuestionList(ev.target.value.trim());
    }, 120));
    document.getElementById('q-list').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.q-item');
      if (!btn) return;
      loadFrequency(btn.dataset.name);
    });
  }

  function renderQuestionList(keyword = '') {
    const list = document.getElementById('q-list');
    if (!list) return;
    const groups = [
      ['single', '单选 SINGLE'],
      ['multi', '多选 MULTI'],
      ['scale', '量表 SCALE'],
      ['numeric', '数值 NUMERIC'],
      ['text', '文本 TEXT'],
    ];
    const kw = keyword.toLowerCase();
    let html = '';
    let total = 0;
    groups.forEach(([type, label]) => {
      const qs = S().questions.filter((q) => q.type === type && (!kw || q.name.toLowerCase().includes(kw)));
      if (!qs.length) return;
      total += qs.length;
      html += `<div class="q-group-label"><span>${label}</span><span>${qs.length}</span></div>`;
      html += qs.map((q) => `<button class="q-item ${S().freqQuestion === q.name ? 'active' : ''}" data-name="${e(q.name)}" data-type="${q.type}">
        <span class="q-dot"></span><span class="q-name">${e(q.name)}</span></button>`).join('');
    });
    list.innerHTML = total ? html : `<div class="q-empty">没有匹配的题目</div>`;
  }

  async function loadFrequency(name) {
    if (!name) return;
    S().freqQuestion = name;
    renderQuestionList(document.getElementById('q-search') ? document.getElementById('q-search').value.trim() : '');
    const main = document.getElementById('freq-main');
    const cached = S().caches.frequency[name];
    if (cached) {
      renderFrequency(main, cached);
      return;
    }
    main.innerHTML = App.loadingHTML('正在计算该题分布…', 2);
    try {
      const data = await App.get('/api/frequency', { dataset_id: S().surveyId, question: name });
      S().caches.frequency[name] = data;
      renderFrequency(main, data);
    } catch (err) {
      main.innerHTML = `<div class="panel-empty"><h3>读取失败</h3><p>${e(err.message)}</p></div>`;
    }
  }

  function renderFrequency(main, data) {
    const q = data.question;
    const type = q.type;
    let strip = '';
    let body = '';

    if (data.kind === 'categorical') {
      strip = `<div class="metric-strip">
        ${metric('最多选项', e(data.top_option || '—'), '选择人数最多的类别')}
        ${metric('最高占比', `${App.fmt(data.top_share, 1)}%`, `共 ${data.category_count} 个选项`)}
        ${metric('累计覆盖', `${App.fmt((data.items || []).slice(0, 3).reduce((s, x) => s + x.pct, 0), 1)}%`, '前 3 项合计', 'accent')}
        ${metric('集中度 HHI', App.fmt(data.concentration, 1), '越高说明答案越集中')}
      </div>`;
      body = `<div class="freq-grid">
        <div class="card">
          ${cardHead('分布结构', '环形图展示前 5 个选项，其余合并为「其他」')}
          <div id="freq-donut"></div>
          <div class="chart-note">百分比以该题有效回答数为分母，四舍五入后合计可能略有偏差。</div>
        </div>
        <div class="card freq-insight">
          ${cardHead('主要选项', '按选择人数排序')}
          <div class="top-option-list">
            ${(data.items || []).slice(0, 6).map((it, i) => `
              <div class="top-option">
                <span class="rank">${String(i + 1).padStart(2, '0')}</span>
                <div><div class="to-label">${e(it.label)}</div><div class="to-bar"><span style="width:${Math.min(100, it.pct)}%"></span></div></div>
                <span class="to-pct">${App.fmt(it.pct, 1)}%</span>
              </div>`).join('')}
          </div>
          <div class="freq-summary-note">集中度 HHI = ${App.fmt(data.concentration, 1)}，${data.concentration > 40 ? '答案分布较集中，主流选择清晰。' : data.concentration > 25 ? '答案分布中等，存在主要倾向但仍有分化。' : '答案较分散，需关注不同群体的细分偏好。'}</div>
        </div>
      </div>
      <div class="card">
        ${cardHead('完整频数表', `有效回答 ${App.fmtInt(data.n_valid)} 份 · 缺失 ${data.missing} 份`)}
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th class="col-option">选项</th><th class="num">频数</th><th class="num">占比</th><th class="col-bar">分布</th><th class="num">累计占比</th></tr></thead>
            <tbody>${(data.items || []).map((it) => `
              <tr>
                <td class="label-cell">${e(it.label)}</td>
                <td class="num">${App.fmtInt(it.count)}</td>
                <td class="num">${App.fmt(it.pct, 2)}%</td>
                <td><div class="pct-pair"><div class="mini-bar"><span style="width:${Math.min(100, it.pct)}%"></span></div></div></td>
                <td class="num">${App.fmt(it.cum_pct, 2)}%</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
    } else if (data.kind === 'multi') {
      const topItems = (data.items || []).slice(0, 12);
      strip = `<div class="metric-strip">
        ${metric('有效受访者', App.fmtInt(data.n_respondents), '至少选择 1 项的答卷')}
        ${metric('平均选择', `${App.fmt(data.avg_selected, 1)} 项`, '人均勾选数量', 'accent')}
        ${metric('选择最多', e(data.top_option || '—'), '按选择人数')}
        ${metric('应答率峰值', `${App.fmt(data.top_share, 1)}%`, '该项选择人数 ÷ 受访者', 'warn')}
      </div>`;
      body = `<div class="freq-grid">
        <div class="card">
          ${cardHead('选项应答率', '展示前 12 项；应答率 = 选择该项人数 ÷ 有效受访者')}
          <div id="freq-bars"></div>
          <div class="chart-note">多选题各选项相互独立，占比合计大于 100% 属正常现象。</div>
        </div>
        <div class="card freq-insight">
          ${cardHead('选择结构', '按应答率排序')}
          <div class="top-option-list">
            ${(data.items || []).slice(0, 6).map((it, i) => `
              <div class="top-option">
                <span class="rank">${String(i + 1).padStart(2, '0')}</span>
                <div><div class="to-label">${e(it.label)}</div><div class="to-bar"><span style="width:${Math.min(100, it.pct)}%"></span></div></div>
                <span class="to-pct">${App.fmt(it.pct, 1)}%</span>
              </div>`).join('')}
          </div>
          <div class="freq-summary-note">共产生 ${App.fmtInt(data.total_mentions)} 次选择，人均 ${App.fmt(data.avg_selected, 2)} 项。提及率以总选择次数为分母，更适合观察选项间的相对热度。</div>
        </div>
      </div>
      <div class="card">
        ${cardHead('完整频数表', `有效受访者 ${App.fmtInt(data.n_respondents)} 人 · 总选择 ${App.fmtInt(data.total_mentions)} 次`)}
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th class="col-option">选项</th><th class="num">选择人数</th><th class="num">应答率</th><th class="num">提及率</th><th class="col-bar">分布</th></tr></thead>
            <tbody>${(data.items || []).map((it) => `
              <tr>
                <td class="label-cell">${e(it.label)}</td>
                <td class="num">${App.fmtInt(it.count)}</td>
                <td class="num">${App.fmt(it.pct, 2)}%</td>
                <td class="num">${App.fmt(it.pct_mentions, 2)}%</td>
                <td><div class="pct-pair"><div class="mini-bar terra"><span style="width:${Math.min(100, it.pct)}%"></span></div></div></td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
    } else if (data.kind === 'scale') {
      const st = data.stats || {};
      const topT = data.top2_threshold != null ? App.fmt(data.top2_threshold, 0) : '—';
      const bottomT = data.bottom2_threshold != null ? App.fmt(data.bottom2_threshold, 0) : '—';
      strip = `<div class="metric-strip">
        ${metric('平均分', `${App.fmt(st.mean, 2)}`, `中位数 ${App.fmt(st.median, 2)}`, 'accent')}
        ${metric('标准差', App.fmt(st.std, 2), `95% CI ${App.fmt(st.ci_low, 2)} – ${App.fmt(st.ci_high, 2)}`)}
        ${metric(`高分组 ≥${topT}`, `${App.fmt(data.top2_pct, 1)}%`, `选择 ${topT} 分及以上`)}
        ${metric(`低分组 ≤${bottomT}`, `${App.fmt(data.bottom2_pct, 1)}%`, `中间档 ${App.fmt(data.neutral_pct, 1)}%`, 'warn')}
      </div>`;
      body = `<div class="freq-grid">
        <div class="card">
          ${cardHead('得分分布', `量表范围 ${App.fmt(data.scale_min, 0)} – ${App.fmt(data.scale_max, 0)} 分`)}
          <div id="scale-chart"></div>
          <div class="chart-note">分数越高表示该维度评价越积极；柱上数字为各分值的占比。</div>
        </div>
        <div class="card">
          ${cardHead('评分结构', '均值与高低分组占比')}
          <div class="scale-big">${App.fmt(st.mean, 2)}<small>/ ${App.fmt(data.scale_max, 0)}</small></div>
          <div class="scale-bars">
            ${[[`高分组 ≥${topT} 分`, data.top2_pct, '#5B8C7B'], ['中间档', data.neutral_pct, '#C8A558'], [`低分组 ≤${bottomT} 分`, data.bottom2_pct, '#C97B5F']].map(([label, val, color]) => `
              <div class="scale-bar-row"><span>${label}</span><div class="sb-track"><span style="width:${Math.min(100, val)}%;background:${color}"></span></div><span class="sb-pct">${App.fmt(val, 1)}%</span></div>`).join('')}
          </div>
          <div class="freq-summary-note">均值标准误 ${App.fmt(st.se, 3)}，95% 置信区间 ${App.fmt(st.ci_low, 2)} – ${App.fmt(st.ci_high, 2)}。${data.top2_pct > 60 ? '整体评价偏正向。' : data.bottom2_pct > 30 ? '负向评价比例偏高，值得进一步交叉分析。' : '评价分布相对均衡。'}</div>
        </div>
      </div>
      <div class="card">
        ${cardHead('完整频数表', `有效回答 ${App.fmtInt(data.n_valid)} 份`)}
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>分值</th><th class="num">频数</th><th class="num">占比</th><th class="col-bar">分布</th></tr></thead>
            <tbody>${(data.items || []).map((it) => `
              <tr><td class="label-cell">${e(it.label)} 分</td><td class="num">${App.fmtInt(it.count)}</td><td class="num">${App.fmt(it.pct, 2)}%</td>
              <td><div class="mini-bar amber"><span style="width:${Math.min(100, it.pct)}%"></span></div></td></tr>`).join('')}</tbody>
            <tfoot><tr><td>合计</td><td class="num">${App.fmtInt(data.n_valid)}</td><td class="num">100%</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>`;
    } else if (data.kind === 'numeric') {
      const st = data.stats || {};
      strip = `<div class="metric-strip">
        ${metric('均值', App.fmt(st.mean, 2), `中位数 ${App.fmt(st.median, 2)}`, 'accent')}
        ${metric('标准差', App.fmt(st.std, 2), `范围 ${App.fmt(st.min, 0)} – ${App.fmt(st.max, 0)}`)}
        ${metric('四分位距', App.fmt(st.iqr, 2), `${App.fmt(st.q1, 1)} – ${App.fmt(st.q3, 1)}`)}
        ${metric('异常值', App.fmtInt(st.outliers), st.outliers ? '按 1.5×IQR 规则识别' : '未发现明显异常', st.outliers ? 'warn' : '')}
      </div>`;
      body = `<div class="freq-grid">
        <div class="card">
          ${cardHead('分布直方图', '数值型题目的区间频数分布')}
          <div id="numeric-hist"></div>
          <div style="margin-top:14px;border-top:1px dashed var(--line);padding-top:12px">
            <div class="section-label">BOX PLOT / 箱线图</div>
            <div id="numeric-box"></div>
          </div>
        </div>
        <div class="card">
          ${cardHead('描述统计', '集中趋势与离散程度')}
          <div class="table-wrap" style="max-height:none">
            <table class="data">
              <tbody>
                ${[
                  ['有效样本', App.fmtInt(st.n)], ['均值', App.fmt(st.mean, 2)], ['中位数', App.fmt(st.median, 2)],
                  ['标准差', App.fmt(st.std, 2)], ['标准误', App.fmt(st.se, 3)], ['最小值', App.fmt(st.min, 2)],
                  ['下四分位 Q1', App.fmt(st.q1, 2)], ['上四分位 Q3', App.fmt(st.q3, 2)], ['最大值', App.fmt(st.max, 2)],
                  ['偏度', App.fmt(st.skew, 2)], ['峰度', App.fmt(st.kurtosis, 2)], ['异常值个数', App.fmtInt(st.outliers)],
                ].map(([k, v]) => `<tr><td class="muted-cell">${k}</td><td class="num strong">${v}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="freq-summary-note">${Math.abs(st.skew) > 1 ? (st.skew > 0 ? '分布明显右偏，存在较高数值的长尾。' : '分布明显左偏，存在较低数值的长尾。') : '分布形态接近对称。'} ${st.outliers ? `共识别 ${st.outliers} 个异常值，建议结合原始答卷核实。` : ''}</div>
        </div>
      </div>`;
    } else {
      strip = `<div class="metric-strip">
        ${metric('有效回答', App.fmtInt(data.n_answers), `占样本 ${data.n_total ? App.fmt(data.n_answers / data.n_total * 100, 1) : 0}%`, 'accent')}
        ${metric('独立表述', App.fmtInt(data.unique_answers), '去重后的答案数')}
        ${metric('平均字数', `${App.fmt(data.avg_length, 1)}`, '每条回答的平均长度')}
        ${metric('高频词', (data.words || []).length, '词频统计结果')}
      </div>`;
      body = `<div class="text-grid">
        <div class="card">
          ${cardHead('高频词', '基于中文分词，已过滤虚词与标点')}
          ${(data.words || []).length ? '<div id="text-words"></div>' : App.emptyHTML('分词结果为空，可参考右侧高频原句')}
          <div class="chart-note">关键词基于 jieba 分词与停用词过滤，用于快速把握主题；结论请结合右侧原句阅读。</div>
        </div>
        <div class="card">
          ${cardHead('高频原句', '按出现次数排序')}
          <div class="text-answers">
            ${(data.top_answers || []).slice(0, 10).map((it, i) => `
              <div class="text-answer"><span class="ta-rank">${String(i + 1).padStart(2, '0')}</span><span class="ta-label">${e(it.label)}</span><span class="ta-count">${it.count} 次</span></div>`).join('') || '<div class="chart-empty">暂无有效文本回答</div>'}
          </div>
        </div>
      </div>
      <div class="card mt-14">
        ${cardHead('原始回答样本', '展示部分典型表述，保留原始语义')}
        <div class="samples">${(data.samples || []).map((s) => `<span class="sample-chip">${e(s)}</span>`).join('') || '<span class="muted">暂无回答</span>'}</div>
      </div>`;
    }

    main.innerHTML = `
      <div class="q-header">
        <div>
          <h2>${e(q.name)}</h2>
          <div class="q-meta">
            ${App.typeBadge(q)}
            <span>有效 <strong>${App.fmtInt(data.n_valid)}</strong> 份</span>
            <span>缺失 <strong>${data.missing}</strong> 份（${App.fmt(data.missing_rate, 1)}%）</span>
            ${q.unique ? `<span>唯一值 <strong>${q.unique}</strong></span>` : ''}
          </div>
        </div>
        <div class="q-header-side"><button class="btn subtle sm" data-cross-jump="${e(q.name)}">用于交叉分析 →</button></div>
      </div>
      ${strip}
      ${body}`;

    // 图表渲染
    if (data.kind === 'categorical') {
      charts.donut(document.getElementById('freq-donut'), {
        items: (data.items || []).map((it) => ({ label: it.label, value: it.pct, count: it.count })),
        centerValue: `${App.fmt(data.top_share, 1)}%`,
        centerLabel: '最高占比',
        suffix: '%',
        maxSlices: 6,
      });
    } else if (data.kind === 'multi') {
      charts.barH(document.getElementById('freq-bars'), {
        items: (data.items || []).slice(0, 12).map((it) => ({ label: it.label, value: it.pct, count: it.count })),
        suffix: '%',
        color: (d, i) => charts.greens[Math.min(i, charts.greens.length - 1)],
      });
    } else if (data.kind === 'scale') {
      charts.barV(document.getElementById('scale-chart'), {
        items: (data.items || []).map((it) => ({ label: `${it.label} 分`, value: it.pct, count: it.count })),
        suffix: '%',
        height: 300,
        color: (d) => {
          const score = parseFloat(d.label);
          if (data.bottom2_threshold != null && score <= data.bottom2_threshold) return '#C97B5F';
          if (data.top2_threshold != null && score >= data.top2_threshold) return '#2F5D50';
          return '#C8A558';
        },
        tipPrefix: '占比',
      });
    } else if (data.kind === 'numeric') {
      charts.barV(document.getElementById('numeric-hist'), {
        items: (data.distribution || []).map((it) => ({ label: it.label, value: it.count })),
        suffix: '',
        height: 260,
        rotateLabels: true,
        color: '#5B8C7B',
        tipPrefix: '频数',
        axisSuffix: ' 人',
      });
      charts.box(document.getElementById('numeric-box'), data.stats);
    } else {
      const wordEl = document.getElementById('text-words');
      if (wordEl) {
        charts.barH(wordEl, {
          items: (data.words || []).slice(0, 15).map((w) => ({ label: w.label, value: w.count })),
          suffix: ' 次',
          color: (d, i) => charts.greens[Math.min(i, charts.greens.length - 1)],
          labelWidth: 120,
        });
      }
    }

    const jump = main.querySelector('[data-cross-jump]');
    if (jump) {
      jump.addEventListener('click', () => {
        S().cross.q1 = q.name;
        S().caches.crosstab = null;
        App.go('crosstab');
      });
    }
  }

  App.pages.frequency.loadQuestion = loadFrequency;
  App.pages.frequency.reset = function () { freqLayoutBuilt = false; };
}());
