/* ============================================================
   Survey Insight — crosstab & correlation pages
   ============================================================ */
(function () {
  const App = window.App;
  const S = () => App.state;
  const charts = App.charts;
  App.pages = App.pages || {};

  const crossCache = new Map();

  function e(v) { return App.escape(v); }
  function cardHead(title, sub, tools = '') {
    return `<div class="card-head"><div><h3 class="card-title">${e(title)}</h3>${sub ? `<p class="card-sub">${e(sub)}</p>` : ''}</div>${tools ? `<div class="card-tools">${tools}</div>` : ''}</div>`;
  }
  function statTile(label, value, sub = '') {
    return `<div class="stat-tile"><div class="k">${e(label)}</div><div class="v">${value}${sub ? `<small>${e(sub)}</small>` : ''}</div></div>`;
  }
  function banner(text, right) {
    return `<div class="analysis-banner"><div><div class="verdict-label">VERDICT / 结论</div><p>${text}</p></div>${right ? `<div class="significant-num">${right}</div>` : ''}</div>`;
  }
  function empty(message) {
    return `<div class="panel-empty"><h3>暂时无法分析</h3><p>${e(message)}</p></div>`;
  }

  /* ================================================================ crosstab */
  let crossBuilt = false;

  App.pages.crosstab = {
    async load() {
      const root = document.getElementById('page-crosstab');
      if (!root) return;
      if (!S().surveyId) { root.innerHTML = empty('请先导入问卷数据。'); return; }
      if (!S().questions.length) await App.loadQuestions();
      const allowed = S().questions.filter((q) => ['single', 'scale', 'numeric'].includes(q.type));
      if (allowed.length < 2) {
        root.innerHTML = `<div class="panel-empty"><h3>可用于交叉分析的题目不足</h3><p>交叉分析至少需要两道单选题、量表题或数值题。</p></div>`;
        return;
      }
      if (!crossBuilt) {
        root.innerHTML = `
          <div class="control-bar">
            <div class="field"><label>题目 A / 分组变量</label><select id="cross-q1"></select></div>
            <button class="swap-btn" id="cross-swap" title="交换两个题目" type="button">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4.5h8M8.5 2l2.5 2.5L8.5 7M11 9.5H3M5.5 7L3 9.5 5.5 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="field"><label>题目 B / 分析变量</label><select id="cross-q2"></select></div>
            <button class="btn primary" id="cross-run" type="button">分析</button>
          </div>
          <div class="note-box" style="margin-bottom:14px">
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6.2" stroke="currentColor" stroke-width="1.2"/><path d="M7.5 4.5v3.6M7.5 10.4v.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            <span>单选 × 单选 → 列联表与卡方检验；分类 × 数值 → 组均值比较（t 检验 / ANOVA）；数值 × 数值 → 相关与散点。多选题与文本题暂不支持。</span>
          </div>
          <div id="cross-result" class="cross-result"></div>`;
        document.getElementById('cross-swap').addEventListener('click', () => {
          const a = document.getElementById('cross-q1');
          const b = document.getElementById('cross-q2');
          const tmp = a.value;
          a.value = b.value;
          b.value = tmp;
          S().cross.q1 = a.value;
          S().cross.q2 = b.value;
          runCross();
        });
        document.getElementById('cross-run').addEventListener('click', runCross);
        document.getElementById('cross-q1').addEventListener('change', () => {
          S().cross.q1 = document.getElementById('cross-q1').value;
          runCross();
        });
        document.getElementById('cross-q2').addEventListener('change', () => {
          S().cross.q2 = document.getElementById('cross-q2').value;
          runCross();
        });
        crossBuilt = true;
      }
      populateCrossControls(allowed);
      runCross();
    },
    reset() { crossBuilt = false; crossCache.clear(); },
  };

  function populateCrossControls(allowed) {
    const sel1 = document.getElementById('cross-q1');
    const sel2 = document.getElementById('cross-q2');
    if (!sel1 || !sel2) return;
    const names = allowed.map((q) => q.name);
    let q1 = S().cross.q1 && names.includes(S().cross.q1) ? S().cross.q1
      : (names.includes('性别') ? '性别' : names[0]);
    let q2 = S().cross.q2 && names.includes(S().cross.q2) && S().cross.q2 !== q1 ? S().cross.q2
      : (names.includes('年龄段') && q1 !== '年龄段' ? '年龄段' : names.find((n) => n !== q1));
    S().cross.q1 = q1;
    S().cross.q2 = q2;
    sel1.innerHTML = App.questionOptions(allowed, null, q1);
    sel2.innerHTML = App.questionOptions(allowed, null, q2);
  }

  async function runCross() {
    const result = document.getElementById('cross-result');
    if (!result) return;
    const q1 = S().cross.q1;
    const q2 = S().cross.q2;
    if (!q1 || !q2) return;
    if (q1 === q2) {
      result.innerHTML = `<div class="panel-empty"><h3>请选择两个不同的题目</h3><p>系统需要两个不同的变量才能进行交叉分析。</p></div>`;
      return;
    }
    const key = `${q1}|||${q2}`;
    if (crossCache.has(key)) {
      renderCross(result, crossCache.get(key));
      return;
    }
    result.innerHTML = App.loadingHTML('正在进行交叉分析与显著性检验…', 2);
    try {
      const data = await App.post('/api/crosstab', { dataset_id: S().surveyId, q1, q2 });
      crossCache.set(key, data);
      renderCross(result, data);
    } catch (err) {
      result.innerHTML = `<div class="panel-empty"><h3>分析未完成</h3><p>${e(err.message)}</p></div>`;
    }
  }

  function renderCross(result, data) {
    if (data.type === 'categorical') {
      renderCategorical(result, data);
    } else if (data.type === 'group') {
      renderGroup(result, data);
    } else {
      renderNumeric(result, data);
    }
  }

  function renderCategorical(result, data) {
    const mode = S().cross.mode || 'row';
    const rowMode = mode === 'row';
    const colMode = mode === 'col';
    const totalRow = data.row_totals.reduce((s, v) => s + v, 0);
    const headerCells = data.cols.map((c) => `<th>${e(c)}</th>`).join('');
    const bodyRows = data.rows.map((rowName, i) => {
      const cells = data.cols.map((colName, j) => {
        const count = data.counts[i][j];
        const rp = data.row_pct[i][j];
        const cp = data.col_pct[i][j];
        let main;
        let sub;
        let heatValue;
        if (colMode) {
          main = `${App.fmt(cp, 1)}%`;
          sub = `n=${count}`;
          heatValue = cp;
        } else if (mode === 'count') {
          main = App.fmtInt(count);
          sub = `${App.fmt(rp, 1)}%`;
          heatValue = data.row_totals[i] ? (count / data.row_totals[i]) * 100 : 0;
        } else {
          main = `${App.fmt(rp, 1)}%`;
          sub = `n=${count}`;
          heatValue = rp;
        }
        const color = charts.heatColor(heatValue);
        const tip = `<strong>${e(rowName)} × ${e(colName)}</strong><br>频数 ${count} · 行占比 ${App.fmt(rp, 1)}% · 列占比 ${App.fmt(cp, 1)}%`;
        return `<td style="background:${color.bg};color:${color.fg}" data-tip="${e(tip)}"><span class="cell-main">${main}</span><span class="cell-sub">${sub}</span></td>`;
      }).join('');
      const total = App.fmtInt(data.row_totals[i]);
      return `<tr><td class="row-head">${e(rowName)}</td>${cells}<td class="total-col">${total}</td></tr>`;
    }).join('');
    const totalCells = data.cols.map((_, j) => `<td>${App.fmtInt(data.col_totals[j])}</td>`).join('');
    const highlight = data.highlight;
    result.innerHTML = `
      <div class="stat-row">
        ${statTile('有效样本', App.fmtInt(data.n))}
        ${statTile('卡方值 χ²', App.fmt(data.chi2, 2))}
        ${statTile('自由度', data.dof)}
        ${statTile('显著性', data.p_text, ' ' + data.stars)}
        ${statTile("Cramér's V", App.fmt(data.cramers_v, 3))}
        ${statTile('关联强度', data.association)}
      </div>
      ${banner(`${e(data.interpretation)} <span class="stars">${e(data.stars)}</span>`, data.p < 0.05 ? '显著' : '不显著')}
      <div class="card">
        <div class="card-head">
          <div><h3 class="card-title">列联表</h3><p class="card-sub">行：${e(data.q1)} · 列：${e(data.q2)} · 单元格显示占比，附频数</p></div>
          <div class="heat-toolbar">
            <div class="seg" id="heat-mode">
              <button data-mode="row" class="${rowMode ? 'active' : ''}">行 %</button>
              <button data-mode="col" class="${colMode ? 'active' : ''}">列 %</button>
              <button data-mode="count" class="${mode === 'count' ? 'active' : ''}">频数</button>
            </div>
          </div>
        </div>
        <div class="heat-wrap">
          <table class="heat">
            <thead><tr><th class="corner">${colMode ? '列 %' : mode === 'count' ? '频数' : '行 %'}</th>${headerCells}<th class="total-col">合计</th></tr></thead>
            <tbody>${bodyRows}</tbody>
            <tfoot><tr><td class="row-head total-row">合计</td>${totalCells}<td class="total-col total-row">${App.fmtInt(totalRow)}</td></tr></tfoot>
          </table>
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:10px;align-items:center">
          <div class="heat-legend"><span>0%</span><span class="heat-scale"></span><span>100%</span><span style="margin-left:5px">颜色越深，占比越高</span></div>
          <div class="small faint">单元格 n = 频数；合计列 / 合计行显示对应样本量</div>
        </div>
        <div class="highlight-note">
          <span>◆</span>
          <span>观察值/期望值最高的单元格为 <strong>「${e(highlight.row)} × ${e(highlight.col)}」</strong>：实际 ${highlight.count} 份，期望 ${highlight.expected} 份，为期望的 ${highlight.ratio} 倍。</span>
        </div>
        ${(data.warnings || []).map((w) => `<div class="warn-note">${e(w)}</div>`).join('')}
      </div>`;

    result.querySelectorAll('#heat-mode button').forEach((btn) => {
      btn.addEventListener('click', () => {
        S().cross.mode = btn.dataset.mode;
        renderCategorical(result, data);
      });
    });
    charts.initTip();
  }

  function renderGroup(result, data) {
    const test = data.test;
    result.innerHTML = `
      <div class="stat-row">
        ${statTile('有效样本', App.fmtInt(data.n))}
        ${statTile('检验方法', test.name.replace('单因素方差分析 (ANOVA)', 'ANOVA'))}
        ${statTile('检验统计量', App.fmt(test.stat, 2))}
        ${statTile('显著性', test.p_text, ' ' + test.stars)}
        ${statTile('效应量 η²', App.fmt(data.eta_squared, 3))}
        ${statTile('效应判断', data.effect)}
      </div>
      ${banner(`${e(data.interpretation)} <span class="stars">${e(test.stars)}</span>`, test.p < 0.05 ? '显著' : '不显著')}
      <div class="result-grid">
        <div class="card group-chart-card">
          ${cardHead('组均值比较', `按「${e(data.group_question)}」分组 · 误差线为 ±1 标准误`)}
          <div id="group-chart"></div>
        </div>
        <div class="card">
          ${cardHead('分组描述统计', '按均值从高到低排序')}
          <div class="table-wrap" style="max-height:390px">
            <table class="data">
              <thead><tr><th>分组</th><th class="num">N</th><th class="num">均值</th><th class="num">中位数</th><th class="num">标准差</th></tr></thead>
              <tbody>${data.groups.map((g) => `<tr><td class="label-cell">${e(g.group)}</td><td class="num">${App.fmtInt(g.n)}</td><td class="num strong">${App.fmt(g.mean, 2)}</td><td class="num">${App.fmt(g.median, 2)}</td><td class="num">${App.fmt(g.std, 2)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="chart-note">${test.name}${test.dof1 != null ? `，F(${test.dof1}, ${test.dof2}) = ${App.fmt(test.stat, 2)}` : ''}，${e(test.p_text)}。η² = ${App.fmt(data.eta_squared, 3)}，${e(data.effect)}。</div>
        </div>
      </div>`;
    charts.barV(document.getElementById('group-chart'), {
      items: data.groups.map((g) => ({ label: g.group, value: g.mean, count: g.n, se: g.se })),
      suffix: '',
      height: 300,
      errorKey: 'se',
      color: (d, i) => charts.greens[Math.min(i + 1, charts.greens.length - 1)],
      tipPrefix: '均值',
      rotateLabels: data.groups.length > 5,
    });
  }

  function renderNumeric(result, data) {
    result.innerHTML = `
      <div class="stat-row">
        ${statTile('有效样本', App.fmtInt(data.n))}
        ${statTile('Pearson r', App.fmt(data.pearson_r, 3))}
        ${statTile('Spearman ρ', App.fmt(data.spearman_r, 3))}
        ${statTile('显著性', data.p_text, ' ' + data.stars)}
        ${statTile('回归斜率', App.fmt(data.slope, 3))}
      </div>
      ${banner(`${e(data.interpretation)} <span class="stars">${e(data.stars)}</span>`, Math.abs(data.pearson_r) >= 0.5 ? '强相关' : Math.abs(data.pearson_r) >= 0.3 ? '中等相关' : '弱相关')}
      <div class="result-grid">
        <div class="card">
          ${cardHead('散点图', `${e(data.q1)} × ${e(data.q2)}，虚线为最小二乘趋势线`)}
          <div id="scatter-chart"></div>
        </div>
        <div class="card">
          ${cardHead('相关摘要', '相关不等于因果，需结合研究设计解读')}
          <div class="table-wrap" style="max-height:none">
            <table class="data">
              <tbody>
                <tr><td class="muted-cell">Pearson r</td><td class="num strong">${App.fmt(data.pearson_r, 3)}</td></tr>
                <tr><td class="muted-cell">Spearman ρ</td><td class="num strong">${App.fmt(data.spearman_r, 3)}</td></tr>
                <tr><td class="muted-cell">p 值</td><td class="num">${e(data.p_text)}</td></tr>
                <tr><td class="muted-cell">有效样本</td><td class="num">${App.fmtInt(data.n)}</td></tr>
                <tr><td class="muted-cell">趋势线</td><td class="num">y = ${App.fmt(data.slope, 3)}x ${data.intercept >= 0 ? '+' : '−'} ${App.fmt(Math.abs(data.intercept), 2)}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="freq-summary-note">${Math.abs(data.pearson_r) >= 0.5 ? '两变量存在较强线性关联，可进一步考虑回归建模或控制混杂变量。' : Math.abs(data.pearson_r) >= 0.3 ? '存在中等程度关联，建议结合散点形态判断是否受异常值影响。' : '线性关联较弱；若理论上存在非线性关系，可尝试分组或平滑曲线。'}</div>
        </div>
      </div>`;
    charts.scatter(document.getElementById('scatter-chart'), {
      points: data.scatter.x.map((x, i) => ({ x, y: data.scatter.y[i] })),
      line: { slope: data.slope, intercept: data.intercept },
      xLabel: data.q1,
      yLabel: data.q2,
    });
  }

  /* ================================================================ correlation */

  App.pages.correlation = {
    async load(force = false) {
      const root = document.getElementById('page-correlation');
      if (!root) return;
      if (!S().surveyId) { root.innerHTML = empty('请先导入问卷数据。'); return; }
      if (S().caches.correlation && !force) {
        renderCorrelation(root, S().caches.correlation);
        return;
      }
      root.innerHTML = App.loadingHTML('正在计算相关矩阵与量表信度…', 3);
      try {
        const data = await App.get('/api/correlation', { dataset_id: S().surveyId });
        S().caches.correlation = data;
        renderCorrelation(root, data);
      } catch (err) {
        root.innerHTML = `<div class="panel-empty"><h3>计算失败</h3><p>${e(err.message)}</p></div>`;
      }
    },
    reset() {},
  };

  function renderCorrelation(root, data) {
    if (!data.available) {
      root.innerHTML = `<div class="panel-empty"><h3>相关分析需要数值型题目</h3><p>${e(data.message || '当前数据缺少足够的数值题或量表题。')}</p>
        <div class="pe-actions"><button class="btn ghost" data-goto="frequency">查看题目类型 →</button></div></div>`;
      return;
    }
    const matrix = data.matrix;
    const names = data.names;
    const head = `<tr><th></th>${names.map((n, i) => `<th title="${e(n)}">${e(n)}<br><span class="faint" style="font-weight:400">${e(data.types[i])}</span></th>`).join('')}</tr>`;
    const body = names.map((row, i) => {
      const cells = names.map((col, j) => {
        const r = matrix[i][j];
        if (r === null || r === undefined) return `<td class="diag">—</td>`;
        if (i === j) return `<td class="diag">1.00</td>`;
        const color = charts.corrColor(r);
        const p = data.p_matrix[i][j];
        const n = data.n_matrix[i][j];
        const pText = p == null ? 'p 值不可计算' : p < 0.001 ? 'p < 0.001' : `p = ${Number(p).toFixed(3)}`;
        return `<td style="background:${color.bg};color:${color.fg}" data-tip="${e(`<strong>${row} × ${col}</strong><br>Spearman ρ = ${Number(r).toFixed(3)}<br>${pText} · N = ${n}`)}">${Number(r).toFixed(2)}</td>`;
      }).join('');
      return `<tr><th class="row-head" title="${e(row)}">${e(row)}</th>${cells}</tr>`;
    }).join('');
    const pairs = (data.pairs || []).filter((p) => p.abs >= 0.3).slice(0, 10);
    const rel = data.reliability;

    root.innerHTML = `
      <div class="corr-layout">
        <div class="card corr-matrix-card">
          ${cardHead('Spearman 相关矩阵', `${data.summary} 相关使用成对完整数据计算。`)}
          <div class="corr-matrix-scroll">
            <table class="corr-table"><thead>${head}</thead><tbody>${body}</tbody></table>
          </div>
          <div class="corr-legend">
            <span>负相关</span><span class="corr-gradient"></span><span>正相关</span>
            <span style="margin-left:8px">色深表示 |ρ| 越大；悬停查看 p 值与样本量</span>
          </div>
        </div>
        <div class="card">
          ${cardHead('显著相关对', '|ρ| ≥ 0.3 且 p < 0.05 的关系优先展示')}
          ${pairs.length ? `<div class="pair-list">${pairs.map((p) => `
            <div class="pair-row">
              <div class="pair-names" title="${e(p.q1)} × ${e(p.q2)}">${e(p.q1)}<span>×</span>${e(p.q2)}<div class="faint" style="margin-top:2px">${e(p.p_text)} · N=${p.n}</div></div>
              <div class="pair-bar"><span style="width:${Math.min(100, p.abs * 100)}%;${p.r < 0 ? 'background:#C97B5F' : ''}"></span></div>
              <div class="pair-r">${p.r.toFixed(2)}<em>${e(p.stars)}</em></div>
            </div>`).join('')}</div>` : App.emptyHTML('未发现 |ρ| ≥ 0.3 的显著相关对')}
          <div class="chart-note">相关仅描述线性/秩次关联，不代表因果关系。样本量较小时，需结合置信区间谨慎判断。</div>
        </div>
      </div>
      <div class="card rel-card">
        ${cardHead('量表信度', rel && rel.note ? rel.note : 'Cronbach\'s α 衡量同一构念下题目的内部一致性')}
        ${renderReliability(rel)}
      </div>`;
    charts.initTip();
  }

  function renderReliability(rel) {
    if (!rel || !rel.available) {
      return `<div class="chart-empty" style="border:0;background:transparent">${e(rel && rel.message ? rel.message : '量表题不足 2 道，暂无法估计 Cronbach\'s α。')}</div>`;
    }
    const blocks = rel.blocks || [rel];
    return `<div class="rel-blocks">${blocks.map((b) => {
      const alpha = b.alpha;
      const isLow = alpha != null && alpha < 0.6;
      const segCount = 10;
      const filled = alpha == null ? 0 : Math.max(1, Math.round(alpha * segCount));
      const scaleLevel = alpha == null ? 'low' : alpha >= 0.7 ? 'on' : alpha >= 0.6 ? 'mid' : 'low';
      return `<div class="rel-block">
        <div class="rel-block-head">
          <div>
            <h3>「${e(b.label)}」内部一致性</h3>
            <p>${b.k} 道题 · 完整回答样本 ${App.fmtInt(b.n)} 份 · ${e(b.alpha_level)}</p>
          </div>
          <div class="rel-alpha">${alpha == null ? '—' : alpha.toFixed(3)}<small>CRONBACH'S α</small></div>
        </div>
        <div class="rel-grid">
          <div>
            <div class="chart-box" id="alpha-ring-${blocks.indexOf(b)}"></div>
            <div class="alpha-scale">${Array.from({ length: segCount }, (_, i) => `<div class="alpha-seg ${i < filled ? scaleLevel : ''}"></div>`).join('')}</div>
          </div>
          <div class="table-wrap" style="max-height:320px">
            <table class="data">
              <thead><tr><th>题目</th><th class="num">均值</th><th class="num">标准差</th><th class="num">校正后题总相关</th><th class="num">删除后 α</th></tr></thead>
              <tbody>${b.items.map((it) => `<tr><td class="label-cell">${e(it.name)}</td><td class="num">${App.fmt(it.mean, 2)}</td><td class="num">${App.fmt(it.std, 2)}</td><td class="num">${App.fmt(it.item_total_r, 3)}</td><td class="num ${it.alpha_if_deleted > alpha + 0.02 ? 'terra' : ''}">${App.fmt(it.alpha_if_deleted, 3)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
        <div class="alpha-note">${e(b.interpretation)}</div>
        ${isLow ? `<div class="warn-note">α 低于 0.6，量表内部一致性不足；建议检查题目表述、反向计分设置，或删减区分度不足的题目后重新估计。</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  // 在 DOM 更新后绘制 α 环（延迟到下一帧，等待元素存在）
  const origRenderCorrelation = renderCorrelation;
  renderCorrelation = function (root, data) {
    origRenderCorrelation(root, data);
    if (data.available && data.reliability && data.reliability.available) {
      const blocks = data.reliability.blocks || [data.reliability];
      blocks.forEach((b, idx) => {
        const el = document.getElementById(`alpha-ring-${idx}`);
        if (el) {
          charts.ring(el, {
            value: b.alpha != null ? b.alpha * 100 : 0,
            max: 100,
            display: b.alpha != null ? b.alpha.toFixed(2) : '—',
            label: 'Cronbach α',
          });
        }
      });
    }
  };

}());
