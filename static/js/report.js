/* ============================================================
   Survey Insight — insight page, Excel export & print report
   ============================================================ */
(function () {
  const App = window.App;
  const S = () => App.state;
  App.pages = App.pages || {};

  function e(v) { return App.escape(v); }
  function cardHead(title, sub, tools = '') {
    return `<div class="card-head"><div><h3 class="card-title">${e(title)}</h3>${sub ? `<p class="card-sub">${e(sub)}</p>` : ''}</div>${tools ? `<div class="card-tools">${tools}</div>` : ''}</div>`;
  }

  App.pages.insights = {
    async load(force = false) {
      const root = document.getElementById('page-insights');
      if (!root) return;
      if (!S().surveyId) {
        root.innerHTML = `<div class="panel-empty"><h3>还没有分析结果</h3><p>导入问卷数据后，这里会自动汇总关键结论并支持导出。</p><div class="pe-actions"><button class="btn primary" data-import>导入数据</button></div></div>`;
        return;
      }
      if (S().caches.insights && !force) {
        renderInsights(root, S().caches.insights);
        return;
      }
      root.innerHTML = App.loadingHTML('正在汇总结论并生成导出选项…', 3);
      try {
        const data = await App.get('/api/insights', {
          dataset_id: S().surveyId,
          baseline_id: S().baselineId || undefined,
        });
        S().caches.insights = data;
        renderInsights(root, data);
      } catch (err) {
        root.innerHTML = `<div class="panel-empty"><h3>汇总失败</h3><p>${e(err.message)}</p></div>`;
      }
    },
  };

  function renderInsights(root, data) {
    const insights = data.insights || [];
    const counts = data.counts || { warn: 0, good: 0, info: 0 };
    const overview = data.overview || S().caches.overview || {};
    const comparisons = data.comparisons || [];
    root.innerHTML = `
      <div class="insights-summary">
        <span class="chip warn"><span class="dot"></span>需关注 <strong style="font-family:var(--serif);margin-left:3px">${counts.warn || 0}</strong></span>
        <span class="chip good"><span class="dot"></span>良好 <strong style="font-family:var(--serif);margin-left:3px">${counts.good || 0}</strong></span>
        <span class="chip"><span class="dot" style="background:var(--blue)"></span>提示 <strong style="font-family:var(--serif);margin-left:3px">${counts.info || 0}</strong></span>
        ${comparisons.length ? `<span class="chip amber">已接入大数据基准 · ${comparisons.length} 题对比</span>` : ''}
      </div>
      <div class="insights-layout">
        <div class="insights-main">
          <div class="card" style="padding-bottom:14px">
            <div class="card-head" style="margin-bottom:8px">
              <div><h3 class="card-title">分析结论</h3><p class="card-sub">由数据质量、分布结构、统计检验与基准偏差自动生成</p></div>
              <div class="insight-filter" id="insight-filter">
                <button data-level="all" class="active">全部 <span class="count">${insights.length}</span></button>
                <button data-level="warn">需关注 <span class="count">${counts.warn || 0}</span></button>
                <button data-level="good">良好 <span class="count">${counts.good || 0}</span></button>
                <button data-level="info">提示 <span class="count">${counts.info || 0}</span></button>
              </div>
            </div>
            <div class="insight-cards" id="insight-cards">
              ${insights.map((ins, i) => `
                <div class="insight-card ${ins.level}" data-level="${ins.level}">
                  <span class="idx">${String(i + 1).padStart(2, '0')}</span>
                  <div class="tag"><span class="level-dot ${ins.level}"></span>${e(App.levelLabel[ins.level] || ins.level)} · ${e(ins.tag)}</div>
                  <h3>${e(ins.title)}</h3>
                  <p>${e(ins.text)}</p>
                </div>`).join('')}
            </div>
          </div>
          <div class="card">
            ${cardHead('方法与口径', '所有统计量均由当前上传数据实时计算')}
            <ul class="method-list">
              <li><span class="n">01</span><span>题型识别：结合 pandas 数据类型、唯一值数量、多选分隔符与开放题文本特征自动判定。</span></li>
              <li><span class="n">02</span><span>描述统计：单选题按有效回答计算频数与占比；多选按应答率与提及率分别统计；量表/数值题给出均值、标准差、四分位数与极值。</span></li>
              <li><span class="n">03</span><span>交叉分析：分类 × 分类使用 Pearson 卡方检验（不做 Yates 校正）、Cramér's V；分类 × 数值使用 Welch t 检验或单因素 ANOVA，并给出 η²。</span></li>
              <li><span class="n">04</span><span>相关与信度：Spearman 秩相关基于成对完整数据；Cronbach's α 按题目名称前缀自动分组，避免跨构念合并。</span></li>
              <li><span class="n">05</span><span>大数据对比：按选项对齐后计算占比差；逐项采用双比例 z 检验，整体采用卡方拟合优度；多选题相似度使用余弦相似度。</span></li>
              <li><span class="n">06</span><span>数据质量：重复答卷为分析字段完全一致的记录；直线作答定义为两道及以上量表题选择同一分值。</span></li>
            </ul>
          </div>
        </div>

        <div>
          <div class="export-panel">
            <div class="eyebrow">DELIVERABLES / 交付</div>
            <h3>把分析<br>带走。</h3>
            <p>Excel 工作簿包含概览、题目说明、全部频数表、相关矩阵、信度、大数据对比与原始数据；洞察报告可直接打印为 PDF。</p>
            <div class="export-actions">
              <button class="btn solid" id="btn-excel" type="button">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 9.5v-8m0 0L4.6 4.4M7.5 1.5l2.9 2.9M2 10v2.5h11V10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                下载 Excel 工作簿
              </button>
              <button class="btn" id="btn-print" type="button">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4 5.5V1.5h7v4M4 11.5H2.5v-6h10v6H11M4 9h7v4.5H4V9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
                打印洞察报告
              </button>
              <button class="btn" type="button" data-goto="llm">AI 解读相关结果 →</button>
              <a class="btn" href="/api/template/baseline">下载基准数据模板 ↓</a>
            </div>
            <div class="export-divider"></div>
            <div class="export-meta">
              <span>数据集 <strong>${e(S().surveyName || '—')}</strong></span>
              <span>样本量 <strong>${App.fmtInt((overview.kpi || {}).rows || S().rows)} 份</strong></span>
              <span>基准状态 <strong>${S().baselineId ? '已接入' : '未接入'}</strong></span>
              <span>生成时间 <strong>${new Date().toLocaleString('zh-CN', { hour12: false })}</strong></span>
            </div>
          </div>
        </div>
      </div>`;

    const filter = document.getElementById('insight-filter');
    if (filter) {
      filter.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        const level = btn.dataset.level;
        filter.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('#insight-cards .insight-card').forEach((card) => {
          card.style.display = level === 'all' || card.dataset.level === level ? '' : 'none';
        });
      });
    }
    const btnExcel = document.getElementById('btn-excel');
    if (btnExcel) btnExcel.addEventListener('click', downloadExcel);
    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) btnPrint.addEventListener('click', printReport);
  }

  /* ---------------------------------------------------------------- Excel */
  function downloadExcel() {
    const params = {
      dataset_id: S().surveyId,
      baseline_id: S().baselineId || undefined,
    };
    if (S().baselineId && S().compare.bq && S().compare.sq) {
      params.bq = S().compare.bq;
      params.sq = S().compare.sq;
    }
    App.toast('Excel 报告正在生成，下载将自动开始…');
    const url = `/api/export/excel${App.qs(params)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------------------------------------------------------------- print report */
  async function printReport() {
    const win = window.open('', '_blank');
    if (!win) {
      App.toast('浏览器拦截了新窗口，请允许弹出窗口后重试。', 'error');
      return;
    }
    win.document.write('<!doctype html><meta charset="utf-8"><title>正在生成报告…</title><body style="font-family:sans-serif;padding:40px;color:#555">正在汇总数据并生成报告…</body>');
    win.document.close();

    try {
      const [overview, corr, insights] = await Promise.all([
        S().caches.overview ? Promise.resolve(S().caches.overview) : App.get('/api/overview', { dataset_id: S().surveyId }),
        S().caches.correlation || App.get('/api/correlation', { dataset_id: S().surveyId }),
        S().caches.insights || App.get('/api/insights', { dataset_id: S().surveyId, baseline_id: S().baselineId || undefined }),
      ]);
      S().caches.overview = overview;
      S().caches.correlation = corr;
      S().caches.insights = insights;
      if (!S().questions.length) await App.loadQuestions();

      const pickQs = [
        S().questions.find((q) => q.type === 'single'),
        S().questions.find((q) => q.type === 'multi'),
        S().questions.find((q) => q.type === 'scale'),
      ].filter(Boolean);
      const freqs = await Promise.all(pickQs.map((q) => App.get('/api/frequency', {
        dataset_id: S().surveyId,
        question: q.name,
      }).catch(() => null)));

      const html = buildReportHTML(overview, corr, insights, freqs.filter(Boolean));
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => { try { win.print(); } catch (err) { /* 忽略打印异常 */ } }, 500);
    } catch (err) {
      win.document.open();
      win.document.write(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;color:#7a2e20">报告生成失败：${e(err.message)}</body>`);
      win.document.close();
    }
  }

  function layoutBar(label, pct, count) {
    const w = Math.max(0, Math.min(100, Number(pct) || 0));
    return `<div class="bar-row"><span>${e(label)}</span><span class="track"><i style="width:${w}%"></i></span><span class="pct">${App.fmt(pct, 1)}%${count != null ? `<em>n=${count}</em>` : ''}</span></div>`;
  }

  function distributionBlock(freq) {
    if (!freq) return '';
    const q = freq.question;
    let content = '';
    if (freq.kind === 'categorical' || freq.kind === 'multi') {
      const items = (freq.items || []).slice(0, 5);
      content = items.map((it) => layoutBar(it.label, it.pct, it.count)).join('');
    } else if (freq.kind === 'scale') {
      const st = freq.stats || {};
      content = `<div class="inline-stats"><span>均值 <strong>${App.fmt(st.mean, 2)}</strong></span><span>中位数 <strong>${App.fmt(st.median, 2)}</strong></span><span>高分组 <strong>${App.fmt(freq.top2_pct, 1)}%</strong></span></div>`
        + (freq.items || []).map((it) => layoutBar(`${it.label} 分`, it.pct, it.count)).join('');
    } else if (freq.kind === 'numeric') {
      const st = freq.stats || {};
      content = `<div class="inline-stats"><span>均值 <strong>${App.fmt(st.mean, 2)}</strong></span><span>中位数 <strong>${App.fmt(st.median, 2)}</strong></span><span>标准差 <strong>${App.fmt(st.std, 2)}</strong></span><span>范围 <strong>${App.fmt(st.min, 0)} – ${App.fmt(st.max, 0)}</strong></span></div>`;
    } else {
      content = `<p class="note">有效回答 ${App.fmtInt(freq.n_answers)} 条，平均 ${App.fmt(freq.avg_length, 1)} 字。</p>`;
      content += (freq.top_answers || []).slice(0, 4).map((it) => `<div class="quote">“${e(it.label)}” <span>× ${it.count}</span></div>`).join('');
    }
    return `<div class="dist-block">
      <h3>${e(q.name)} <span class="type">${e(q.type_label)} · N=${App.fmtInt(freq.n_valid)}</span></h3>
      ${content}
    </div>`;
  }

  function buildReportHTML(overview, corr, insights, freqs) {
    const kpi = overview.kpi || {};
    const dataset = overview.dataset || {};
    const insightsList = (insights.insights || []).slice(0, 8);
    const comparisons = insights.comparisons || [];
    const rel = insights.reliability;
    const dateRange = overview.date_range;
    const generated = new Date().toLocaleString('zh-CN', { hour12: false });
    const typeText = (overview.type_counts || []).map((t) => `${t.name} ${t.value}`).join(' · ');
    const pairs = (corr.pairs || []).filter((p) => p.abs >= 0.3).slice(0, 4);
    const relBlocks = rel && rel.available ? (rel.blocks || [rel]) : [];

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${e(dataset.name || '问卷分析报告')} · 洞察报告</title>
<style>
  :root { --green:#1b4332; --green2:#2f5d50; --terra:#b85c3e; --amber:#b5842c; --line:#e3dbcb; --muted:#7b857d; }
  * { box-sizing: border-box; }
  body { margin:0; color:#1e2a23; background:#f3efe6; font-family:"Microsoft YaHei","PingFang SC",sans-serif; font-size:10pt; line-height:1.65; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { width:190mm; margin:0 auto; background:#fff; padding:16mm 15mm 12mm; }
  .cover { border-top:3px solid var(--green); padding-top:8mm; margin-bottom:8mm; }
  .eyebrow { font-size:6.5pt; letter-spacing:3px; color:var(--muted); text-transform:uppercase; }
  h1 { font-family:"SimSun","Songti SC",serif; font-size:27pt; line-height:1.25; font-weight:600; margin:4mm 0 3mm; letter-spacing:.5px; }
  .subtitle { font-size:11pt; color:#47544c; margin:0 0 5mm; }
  .meta-row { display:flex; flex-wrap:wrap; gap:4mm 10mm; font-size:8pt; color:var(--muted); border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:3mm 0; }
  .meta-row strong { color:#1e2a23; font-weight:600; }
  section { margin-top:8mm; break-inside:avoid; }
  h2 { font-family:"SimSun","Songti SC",serif; font-size:14pt; letter-spacing:1px; margin:0 0 4mm; padding-bottom:2mm; border-bottom:1px solid var(--green); color:var(--green); }
  h3 { font-size:10.5pt; margin:0 0 2mm; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid var(--line); }
  .kpi { padding:4mm; border-right:1px solid var(--line); }
  .kpi:last-child { border-right:0; }
  .kpi .k { font-size:7pt; color:var(--muted); letter-spacing:1px; }
  .kpi .v { font-family:Georgia,serif; font-size:22pt; line-height:1.15; margin-top:1mm; }
  .kpi .s { font-size:7pt; color:var(--muted); }
  .insight { display:grid; grid-template-columns:8mm 1fr; gap:3mm; padding:2.6mm 0; border-bottom:1px dashed var(--line); }
  .insight:last-child { border-bottom:0; }
  .insight .idx { font-family:Georgia,serif; font-size:8pt; color:#a7ada5; padding-top:1mm; }
  .insight .tag { font-size:6.5pt; letter-spacing:.6px; color:var(--muted); }
  .insight .tag.warn { color:var(--terra); }
  .insight .tag.good { color:var(--green2); }
  .insight h3 { font-size:10pt; font-weight:600; line-height:1.5; margin:.5mm 0; }
  .insight p { margin:0; font-size:8.5pt; color:#5f6b63; line-height:1.65; }
  .two-col { display:grid; grid-template-columns:1fr 1fr; gap:6mm; }
  .panel { border:1px solid var(--line); padding:4mm; }
  .panel h3 { font-family:"SimSun",serif; font-size:11pt; border-bottom:1px solid var(--line); padding-bottom:2mm; margin-bottom:3mm; }
  .bar-row { display:grid; grid-template-columns:32mm 1fr 17mm; gap:2.5mm; align-items:center; font-size:8pt; margin:1.6mm 0; }
  .bar-row > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#47544c; }
  .track { height:2.4mm; border-radius:2mm; background:#ece6d9; overflow:hidden; }
  .track i { display:block; height:100%; background:var(--green2); border-radius:2mm; }
  .pct { text-align:right; font-variant-numeric:tabular-nums; }
  .pct em { display:block; font-style:normal; font-size:6.5pt; color:#a7ada5; }
  .dist-block { padding:3mm 0; border-bottom:1px dashed var(--line); break-inside:avoid; }
  .dist-block:last-child { border-bottom:0; }
  .dist-block h3 { font-size:9.5pt; }
  .dist-block .type { font-size:7pt; color:var(--muted); font-weight:400; margin-left:2mm; }
  .inline-stats { display:flex; gap:6mm; flex-wrap:wrap; font-size:8pt; color:var(--muted); margin-bottom:2mm; }
  .inline-stats strong { color:#1e2a23; font-family:Georgia,serif; font-size:10pt; }
  .quote { font-size:8pt; color:#47544c; padding:1mm 0; border-bottom:1px solid #f3efe6; }
  .quote span { color:#a7ada5; font-size:7pt; }
  table { width:100%; border-collapse:collapse; font-size:8pt; }
  th { background:#f7f2e8; font-weight:600; text-align:left; padding:2mm; border-bottom:1px solid var(--line); color:#5f6b63; }
  td { padding:2mm; border-bottom:1px solid #f0eadf; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .note { font-size:7.5pt; color:var(--muted); line-height:1.6; margin-top:2mm; }
  .tag-cell { display:inline-block; padding:.4mm 2mm; border-radius:2mm; font-size:6.5pt; }
  .tag-cell.warn { background:#f6e3da; color:#b85c3e; }
  .tag-cell.good { background:#eef4f0; color:#2f5d50; }
  .footer { margin-top:9mm; padding-top:3mm; border-top:1px solid var(--line); display:flex; justify-content:space-between; font-size:7pt; color:#a7ada5; }
  @page { size:A4; margin:12mm; }
  @media print { body { background:#fff; } .page { width:auto; padding:0; } section { break-inside:avoid; } }
</style></head><body><div class="page">
  <div class="cover">
    <div class="eyebrow">SURVEY INSIGHT / 问卷洞察报告</div>
    <h1>${e(dataset.name || '问卷数据分析')}</h1>
    <p class="subtitle">问卷统计与大数据基准对比 · 自动分析报告</p>
    <div class="meta-row">
      <span>样本量 <strong>${App.fmtInt(kpi.rows)} 份</strong></span>
      <span>分析题目 <strong>${App.fmtInt(kpi.questions)} 道</strong></span>
      <span>完成率 <strong>${App.fmt(kpi.completion, 1)}%</strong></span>
      <span>质量分 <strong>${kpi.quality_score} / 100</strong></span>
      ${dateRange ? `<span>采集周期 <strong>${e(dateRange.start)} 至 ${e(dateRange.end)}</strong></span>` : ''}
      <span>生成时间 <strong>${e(generated)}</strong></span>
    </div>
  </div>

  <section>
    <h2>核心指标</h2>
    <div class="kpis">
      <div class="kpi"><div class="k">有效样本</div><div class="v">${App.fmtInt(kpi.rows)}</div><div class="s">${dateRange ? `覆盖 ${dateRange.days} 天` : '未识别时间列'}</div></div>
      <div class="kpi"><div class="k">分析题目</div><div class="v">${App.fmtInt(kpi.questions)}</div><div class="s">${e(typeText)}</div></div>
      <div class="kpi"><div class="k">整体完成率</div><div class="v">${App.fmt(kpi.completion, 1)}%</div><div class="s">缺失 ${App.fmtInt(kpi.missing_cells)} 个单元格</div></div>
      <div class="kpi"><div class="k">数据质量分</div><div class="v">${kpi.quality_score}</div><div class="s">重复 ${kpi.duplicates} · 直线 ${kpi.straight_liners}</div></div>
    </div>
  </section>

  <section>
    <h2>关键发现</h2>
    ${insightsList.map((ins, i) => `<div class="insight">
      <div class="idx">${String(i + 1).padStart(2, '0')}</div>
      <div><div class="tag ${ins.level}">${e(App.levelLabel[ins.level] || '提示')} · ${e(ins.tag)}</div>
      <h3>${e(ins.title)}</h3><p>${e(ins.text)}</p></div>
    </div>`).join('') || '<p class="note">暂无自动洞察。</p>'}
  </section>

  <section>
    <h2>关键题目分布</h2>
    ${freqs.map(distributionBlock).join('') || '<p class="note">未获取到题目分布。</p>'}
  </section>

  <section>
    <h2>相关与信度</h2>
    <div class="two-col">
      <div class="panel">
        <h3>显著相关对</h3>
        ${pairs.length ? `<table><thead><tr><th>变量关系</th><th style="text-align:right">Spearman ρ</th><th>显著性</th></tr></thead><tbody>
          ${pairs.map((p) => `<tr><td>${e(p.q1)} × ${e(p.q2)}</td><td class="num">${p.r.toFixed(2)}</td><td>${e(p.p_text)} <span class="tag-cell ${p.p < 0.05 ? 'good' : 'warn'}">${e(p.stars)}</span></td></tr>`).join('')}
        </tbody></table>` : '<p class="note">未发现 |ρ| ≥ 0.3 的显著相关对。</p>'}
        <p class="note">相关反映秩次关联，不代表因果关系。共同方法偏差与样本构成都可能影响相关系数。</p>
      </div>
      <div class="panel">
        <h3>量表信度</h3>
        ${relBlocks.length ? `<table><thead><tr><th>量表组</th><th style="text-align:right">α</th><th>判断</th><th style="text-align:right">题数</th></tr></thead><tbody>
          ${relBlocks.map((b) => `<tr><td>${e(b.label)}</td><td class="num">${b.alpha == null ? '—' : b.alpha.toFixed(3)}</td><td>${e(b.alpha_level)}</td><td class="num">${b.k}</td></tr>`).join('')}
        </tbody></table>` : '<p class="note">当前数据没有足够的同组量表题，未估计 Cronbach\'s α。</p>'}
        <p class="note">α ≥ 0.7 通常视为可接受；α 过高（>0.95）亦需警惕题目冗余。</p>
      </div>
    </div>
  </section>

  ${comparisons.length ? `<section>
    <h2>大数据基准对比</h2>
    <table>
      <thead><tr><th>题目</th><th>基准题目</th><th style="text-align:right">重合度</th><th>整体检验</th><th>最大偏差</th></tr></thead>
      <tbody>${comparisons.map((c) => `<tr>
        <td>${e(c.survey_question)}</td>
        <td>${e(c.baseline_question)}</td>
        <td class="num">${App.fmt(c.similarity, 1)}%</td>
        <td>${c.overall && c.overall.valid ? e(c.overall.p_text) : '未执行'}</td>
        <td>${c.biggest ? `${e(c.biggest.option)} ${App.signed(c.biggest.diff, 1)} pp` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>
    <p class="note">重合度：单选/量表题为分布重合度（1 − 总变差距离），多选题为余弦相似度。逐项与整体检验结果受基准口径、样本量与选项对齐方式影响，解读时应结合数据来源差异。</p>
  </section>` : ''}

  <section>
    <h2>方法与说明</h2>
    <p class="note">题型由数据类型、唯一值、分隔符及文本特征自动识别。单选题按有效回答计算频数与占比；多选题按应答率（选择人数 ÷ 有效受访者）与提及率分别统计。交叉分析采用 Pearson 卡方检验（Cramér's V 衡量关联强度）或 Welch t 检验 / 单因素 ANOVA（η² 衡量效应量）。相关分析采用 Spearman 秩相关，量表信度采用 Cronbach's α。大数据对比按选项对齐后计算占比差，逐项采用双比例 z 检验，整体采用卡方拟合优度检验。所有缺失值按分析需要成对剔除，未做插补。
    </p>
    <p class="note">本报告由问卷洞察平台自动生成；统计显著性不等同于业务重要性，建议结合研究设计、抽样方式与基准数据口径综合判断。</p>
  </section>

  <div class="footer"><span>问卷洞察 · Survey Insight</span><span>${e(dataset.name || '')} · ${e(generated)}</span></div>
</div></body></html>`;
  }
}());
