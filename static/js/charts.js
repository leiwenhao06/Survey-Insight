/* ============================================================
   Survey Insight — dependency-free SVG charts
   ============================================================ */
(function () {
  const App = window.App;
  const C = {};

  const PALETTE = ['#2F5D50', '#C2603E', '#C8A558', '#4A708B', '#77647F', '#8A9A5B', '#B08968', '#5B8C7B', '#9BBFAD', '#A7ADA5'];
  const GREENS = ['#1B4332', '#2F5D50', '#3F6F5F', '#5B8C7B', '#7FA797', '#9BBFAD', '#B7D2C5'];
  const INK = '#47544c';
  const MUTED = '#8b948c';
  const GRID = '#eee8dc';
  const TRACK = '#f1ece1';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function niceStep(raw) {
    const value = Math.max(raw, 1e-9);
    const exp = Math.floor(Math.log10(value));
    const f = value / Math.pow(10, exp);
    let nf;
    if (f <= 1.5) nf = 1;
    else if (f <= 3) nf = 2;
    else if (f <= 7) nf = 5;
    else nf = 10;
    return nf * Math.pow(10, exp);
  }

  function niceTicks(max, n = 4) {
    const step = niceStep(Math.max(max, 1e-9) / n);
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
  }

  function rangeTicks(min, max, n = 4) {
    const step = niceStep((max - min || 1) / n);
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
  }

  function charWidth(ch) {
    return /[⺀-鿿＀-￯]/.test(ch) ? 10 : 5.8;
  }
  function textWidth(s) {
    return Array.from(String(s)).reduce((sum, ch) => sum + charWidth(ch), 0);
  }
  function truncate(s, maxPx) {
    s = String(s);
    if (textWidth(s) <= maxPx) return s;
    let out = '';
    let w = 0;
    for (const ch of s) {
      const cw = charWidth(ch);
      if (w + cw > maxPx - 10) break;
      out += ch;
      w += cw;
    }
    return out + '…';
  }
  function wrapLines(s, maxPx, maxLines = 2) {
    s = String(s);
    if (textWidth(s) <= maxPx) return [s];
    const lines = [];
    let current = '';
    let w = 0;
    for (const ch of s) {
      const cw = charWidth(ch);
      if (w + cw > maxPx) {
        lines.push(current);
        current = ch;
        w = cw;
        if (lines.length === maxLines - 1) break;
      } else {
        current += ch;
        w += cw;
      }
    }
    if (lines.length < maxLines && current) {
      const used = lines.join('').length;
      lines.push(used < s.length ? current + '…' : current);
    }
    return lines.length ? lines : [s];
  }
  function valueFmt(v, digits = 1) {
    const n = num(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(digits);
  }
  function tint(index, list = GREENS) {
    return list[index % list.length];
  }
  function chartWidth(el, fallback = 720) {
    const w = el && el.clientWidth ? el.clientWidth : fallback;
    return Math.max(280, Math.round(w));
  }

  function initTip() {
    const tip = document.getElementById('chart-tip');
    if (!tip || initTip.done) return;
    initTip.done = true;
    const place = (e) => {
      const x = Math.max(80, Math.min(window.innerWidth - 80, e.clientX));
      tip.style.left = `${x}px`;
      tip.style.top = `${e.clientY - 14}px`;
    };
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[data-tip]');
      if (!target) return;
      const content = target.getAttribute('data-tip');
      tip.innerHTML = content;
      tip.classList.remove('hidden');
      tip.classList.toggle('multi', content.length > 34);
      if (e.clientX || e.clientY) place(e);
    });
    document.addEventListener('mousemove', (e) => {
      if (tip.classList.contains('hidden')) return;
      place(e);
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-tip]')) tip.classList.add('hidden');
    });
  }

  C.palette = PALETTE;
  C.greens = GREENS;

  /* ------------------------------------------------------------ horizontal bars */
  C.barH = function (el, opts) {
    if (!el) return;
    const items = (opts.items || []).filter((d) => d && d.label !== undefined);
    if (!items.length) {
      el.innerHTML = `<div class="chart-empty">暂无可展示的数据</div>`;
      return;
    }
    const W = chartWidth(el);
    const rowH = opts.rowH || 34;
    const maxLabelW = Math.min(opts.labelWidth || 190, Math.max(90, W * 0.36));
    let labelW = Math.min(maxLabelW, Math.max(80, ...items.map((d) => textWidth(d.label) + 8)));
    const left = labelW + 14;
    const right = 58;
    const areaW = W - left - right;
    const height = items.length * rowH + 16;
    const maxVal = Math.max(opts.max || 0, ...items.map((d) => num(d.value)));
    const scaleMax = maxVal > 0 ? maxVal : 1;
    const colorFn = opts.color || ((d, i) => tint(i));
    const suffix = opts.suffix == null ? '%' : opts.suffix;
    const rows = items.map((d, i) => {
      const y = 8 + i * rowH + rowH / 2;
      const ratio = Math.max(0, Math.min(1, num(d.value) / scaleMax));
      const barW = Math.max(1.5, ratio * areaW);
      const lines = wrapLines(d.label, labelW, 2);
      const labelSvg = lines.map((line, li) => {
        const ty = y + (li - (lines.length - 1) / 2) * 12 + 3.5;
        return `<text x="${left - 14}" y="${ty}" text-anchor="end" class="chart-axis-text">${esc(line)}</text>`;
      }).join('');
      const color = typeof colorFn === 'function' ? colorFn(d, i) : colorFn;
      const valText = `${valueFmt(d.value, 1)}${suffix}`;
      const tip = [`<strong>${esc(d.label)}</strong>`, `${esc(valText)}${d.count != null ? ` · ${App.fmtInt(d.count)} 份` : ''}`].join('<br>');
      return `<g>
        ${labelSvg}
        <rect x="${left}" y="${y - 6}" width="${areaW}" height="12" rx="6" fill="${TRACK}"/>
        <rect class="chart-bar" data-tip="${esc(tip)}" x="${left}" y="${y - 6}" width="${barW}" height="12" rx="6" fill="${color}"/>
        <text x="${left + barW + 7}" y="${y + 3.5}" class="chart-value-text">${esc(valText)}</text>
      </g>`;
    }).join('');
    el.innerHTML = `<div class="chart-box"><svg viewBox="0 0 ${W} ${height}" role="img" aria-label="条形图">${rows}</svg></div>`;
    initTip();
  };

  /* ------------------------------------------------------------ vertical bars */
  C.barV = function (el, opts) {
    if (!el) return;
    const items = (opts.items || []);
    if (!items.length) {
      el.innerHTML = `<div class="chart-empty">暂无可展示的数据</div>`;
      return;
    }
    const W = chartWidth(el);
    const H = opts.height || 300;
    const hasError = items.some((d) => opts.errorKey && Number.isFinite(Number(d[opts.errorKey])));
    const values = items.map((d) => num(d.value));
    const errs = items.map((d) => (opts.errorKey ? num(d[opts.errorKey]) : 0));
    const rawMax = Math.max(...values.map((v, i) => v + errs[i]), ...values) * 1.08;
    const ticks = opts.ticks || niceTicks(rawMax, 4);
    const yMax = opts.yMax || (opts.nice === false ? Math.max(1, rawMax) : ticks[ticks.length - 1]);
    const top = 18;
    const bottom = opts.rotateLabels ? 66 : 40;
    const left = 46;
    const right = 14;
    const plotW = W - left - right;
    const plotH = H - top - bottom;
    const band = plotW / items.length;
    const barW = Math.min(opts.barWidth || 64, band * 0.58);
    const suffix = opts.suffix == null ? '%' : opts.suffix;
    const colorFn = opts.color || ((d, i) => tint(i));

    const grid = ticks.map((t) => {
      const y = top + plotH - (t / yMax) * plotH;
      return `<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="${GRID}" stroke-width="1"/>
        <text x="${left - 8}" y="${y + 3.5}" text-anchor="end" class="chart-axis-text">${esc(valueFmt(t, 1))}${opts.axisSuffix || ''}</text>`;
    }).join('');

    const bars = items.map((d, i) => {
      const v = num(d.value);
      const xCenter = left + band * i + band / 2;
      const barH = Math.max(1.5, (v / yMax) * plotH);
      const x = xCenter - barW / 2;
      const y = top + plotH - barH;
      const color = typeof colorFn === 'function' ? colorFn(d, i) : colorFn;
      const label = truncate(d.label, band * 0.92);
      const labelY = top + plotH + 16;
      const rotate = opts.rotateLabels || textWidth(label) > band * 0.9;
      const labelSvg = rotate
        ? `<text x="${xCenter}" y="${labelY}" text-anchor="end" class="chart-axis-text" transform="rotate(-32 ${xCenter} ${labelY})">${esc(label)}</text>`
        : `<text x="${xCenter}" y="${labelY}" text-anchor="middle" class="chart-axis-text">${esc(label)}</text>`;
      const valSvg = items.length <= 14
        ? `<text x="${xCenter}" y="${y - 6}" text-anchor="middle" class="chart-value-text">${esc(valueFmt(v, 1))}${suffix}</text>`
        : '';
      let errorSvg = '';
      if (hasError && errs[i] > 0) {
        const ey1 = top + plotH - ((v + errs[i]) / yMax) * plotH;
        const ey2 = top + plotH - ((Math.max(0, v - errs[i])) / yMax) * plotH;
        errorSvg = `<line x1="${xCenter}" y1="${ey1}" x2="${xCenter}" y2="${ey2}" stroke="#1e2a23" stroke-width="1" opacity=".55"/>
          <line x1="${xCenter - 5}" y1="${ey1}" x2="${xCenter + 5}" y2="${ey1}" stroke="#1e2a23" stroke-width="1" opacity=".55"/>
          <line x1="${xCenter - 5}" y1="${ey2}" x2="${xCenter + 5}" y2="${ey2}" stroke="#1e2a23" stroke-width="1" opacity=".55"/>`;
      }
      const tipParts = [`<strong>${esc(d.label)}</strong>`, `${esc(opts.tipPrefix || '数值')}：${esc(valueFmt(v, 2))}${esc(suffix)}`];
      if (d.count != null) tipParts.push(`样本：${App.fmtInt(d.count)}`);
      if (hasError && errs[i] > 0) tipParts.push(`标准误：±${esc(valueFmt(errs[i], 2))}`);
      return `<g>
        <rect class="chart-bar" data-tip="${esc(tipParts.join('<br>'))}" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}"/>
        ${errorSvg}
        ${valSvg}
        ${labelSvg}
      </g>`;
    }).join('');
    el.innerHTML = `<div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="柱状图">
      ${grid}<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#d8d0c0" stroke-width="1"/>${bars}
    </svg></div>`;
    initTip();
  };

  /* ------------------------------------------------------------ donut */
  C.donut = function (el, opts) {
    if (!el) return;
    let items = (opts.items || []).filter((d) => d && num(d.value) > 0);
    if (!items.length) {
      el.innerHTML = `<div class="chart-empty">暂无可展示的数据</div>`;
      return;
    }
    const maxSlices = opts.maxSlices || 6;
    if (items.length > maxSlices) {
      const head = items.slice(0, maxSlices - 1);
      const rest = items.slice(maxSlices - 1);
      head.push({ label: '其他', value: rest.reduce((s, d) => s + num(d.value), 0), _other: true });
      items = head;
    }
    const total = items.reduce((s, d) => s + num(d.value), 0) || 1;
    const W = chartWidth(el);
    const H = 280;
    const compact = W < 430;
    const cx = compact ? Math.max(78, Math.min(104, W * 0.28)) : Math.min(150, W * 0.27);
    const cy = H / 2;
    const r = compact ? Math.max(56, Math.min(70, W * 0.2)) : Math.min(88, W * 0.22);
    const sw = Math.max(22, Math.round(r * 0.39));
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const arcs = items.map((d, i) => {
      const ratio = num(d.value) / total;
      const len = Math.max(0, ratio * circ - 2);
      const dashOffset = -offset;
      offset += ratio * circ;
      const color = d._other ? '#b9b1a1' : PALETTE[i % PALETTE.length];
      const tip = `<strong>${esc(d.label)}</strong><br>${valueFmt(d.value, 2)}${opts.suffix == null ? '%' : opts.suffix}${d.count != null ? ` · ${App.fmtInt(d.count)} 份` : ''}`;
      return `<circle class="chart-bar" data-tip="${esc(tip)}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
        stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    }).join('');
    const legendX = cx + r + (compact ? 20 : 30);
    const legendW = W - legendX - 12;
    const rowGap = compact ? 29 : 32;
    const startY = cy - ((items.length - 1) * rowGap) / 2;
    const rows = items.map((d, i) => {
      const y = startY + i * rowGap;
      const color = d._other ? '#b9b1a1' : PALETTE[i % PALETTE.length];
      const pct = (num(d.value) / total) * 100;
      return `<g>
        <rect x="${legendX}" y="${y - 8}" width="8" height="8" rx="2" fill="${color}"/>
        <text x="${legendX + 13}" y="${y}" class="chart-axis-text" style="font-size:10.5px">${esc(truncate(d.label, legendW - 42))}</text>
        <text x="${W - 8}" y="${y}" text-anchor="end" class="chart-value-text" style="font-size:10.5px">${pct.toFixed(1)}%</text>
      </g>`;
    }).join('');
    const centerValue = opts.centerValue != null ? opts.centerValue : `${valueFmt(items[0].value, 1)}%`;
    const centerLabel = opts.centerLabel || truncate(items[0].label, r * 1.5);
    const centerFont = compact ? 22 : 28;
    el.innerHTML = `<div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="环形图">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${sw}"/>
      ${arcs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" style="font-family:var(--serif);font-size:${centerFont}px;fill:#1b4332">${esc(centerValue)}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" class="chart-axis-text" style="font-size:9.5px">${esc(centerLabel)}</text>
      ${rows}
    </svg></div>`;
    initTip();
  };

  /* ------------------------------------------------------------ grouped horizontal */
  C.groupedBarH = function (el, opts) {
    if (!el) return;
    const rowsData = opts.rows || [];
    if (!rowsData.length) {
      el.innerHTML = `<div class="chart-empty">暂无可对比的数据</div>`;
      return;
    }
    const W = chartWidth(el);
    const series = opts.series || [
      { name: '问卷样本', color: '#2F5D50' },
      { name: '大数据基准', color: '#C8A558' },
    ];
    const rowH = 46;
    const top = 52;
    const H = top + rowsData.length * rowH + 8;
    const maxLabelW = Math.min(190, Math.max(90, W * 0.32));
    const labelW = Math.min(maxLabelW, Math.max(84, ...rowsData.map((d) => textWidth(d.label) + 10)));
    const left = labelW + 14;
    const right = 60;
    const areaW = W - left - right;
    const maxVal = Math.max(opts.max || 100, ...rowsData.flatMap((d) => [num(d.a), num(d.b)]));
    const scaleMax = maxVal > 0 ? maxVal : 100;
    const suffix = opts.suffix == null ? '%' : opts.suffix;
    const legend = series.map((s, i) => `
      <g transform="translate(${left + i * 118}, 22)">
        <rect width="9" height="9" rx="2" fill="${s.color}"/>
        <text x="15" y="8.5" class="chart-axis-text">${esc(s.name)}</text>
      </g>`).join('');
    const rows = rowsData.map((d, i) => {
      const y = top + i * rowH + rowH / 2;
      const lines = wrapLines(d.label, labelW, 2);
      const labelSvg = lines.map((line, li) => `
        <text x="${left - 14}" y="${y + 3.5 + (li - (lines.length - 1) / 2) * 12 + 2}" text-anchor="end" class="chart-axis-text">${esc(line)}</text>`).join('');
      const vals = [num(d.a), num(d.b)];
      const tracks = vals.map((v, si) => {
        const yy = y - 11 + si * 12;
        return `<rect x="${left}" y="${yy}" width="${areaW}" height="9" rx="4.5" fill="#f4efe5"/>`;
      }).join('');
      const barSvg = vals.map((v, si) => {
        const w = Math.max(1.5, (v / scaleMax) * areaW);
        const yy = y - 11 + si * 12;
        return `<rect class="chart-bar" x="${left}" y="${yy}" width="${w}" height="9" rx="4.5" fill="${series[si].color}"
          data-tip="${esc(`<strong>${esc(d.label)}</strong><br>${esc(series[si].name)}：${esc(valueFmt(v, 2))}${esc(suffix)}`)}"/>
          <text x="${left + w + 5}" y="${yy + 8}" class="chart-axis-text" style="font-size:9px">${esc(valueFmt(v, 1))}${esc(suffix)}</text>`;
      }).join('');
      return `<g>${labelSvg}${tracks}${barSvg}</g>`;
    }).join('');
    el.innerHTML = `<div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="分组条形图">
      ${legend}${rows}
    </svg></div>`;
    initTip();
  };

  /* ------------------------------------------------------------ scatter */
  C.scatter = function (el, opts) {
    if (!el) return;
    const pts = (opts.points || []).filter((p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
    if (pts.length < 2) {
      el.innerHTML = `<div class="chart-empty">有效数据点不足，无法绘制散点图</div>`;
      return;
    }
    const W = chartWidth(el), H = 340;
    const ml = 46, mr = 16, mt = 18, mb = 46;
    const pw = W - ml - mr;
    const ph = H - mt - mb;
    const xs = pts.map((p) => num(p.x));
    const ys = pts.map((p) => num(p.y));
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padX = (x1 - x0) * 0.06 || 1;
    const padY = (y1 - y0) * 0.08 || 1;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    const sx = (v) => ml + ((v - x0) / (x1 - x0)) * pw;
    const sy = (v) => mt + ph - ((v - y0) / (y1 - y0)) * ph;
    const xTicks = rangeTicks(x0, x1, 5);
    const yTicks = rangeTicks(y0, y1, 4);
    const grid = xTicks.map((t) => `<line x1="${sx(t)}" y1="${mt}" x2="${sx(t)}" y2="${mt + ph}" stroke="${GRID}"/><text x="${sx(t)}" y="${mt + ph + 16}" text-anchor="middle" class="chart-axis-text">${valueFmt(t, 0)}</text>`).join('')
      + yTicks.map((t) => `<line x1="${ml}" y1="${sy(t)}" x2="${ml + pw}" y2="${sy(t)}" stroke="${GRID}"/><text x="${ml - 8}" y="${sy(t) + 3.5}" text-anchor="end" class="chart-axis-text">${valueFmt(t, 0)}</text>`).join('');
    const points = pts.map((p) => `<circle cx="${sx(num(p.x))}" cy="${sy(num(p.y))}" r="2.6" fill="#2F5D50" opacity=".4"/>`).join('');
    let line = '';
    if (opts.line && Number.isFinite(Number(opts.line.slope))) {
      const a = Number(opts.line.slope);
      const b = Number(opts.line.intercept);
      const lx0 = x0, lx1 = x1;
      line = `<line x1="${sx(lx0)}" y1="${sy(a * lx0 + b)}" x2="${sx(lx1)}" y2="${sy(a * lx1 + b)}" stroke="#B85C3E" stroke-width="1.6" stroke-dasharray="5 5" opacity=".8"/>`;
    }
    const xLabel = esc(opts.xLabel || 'X');
    const yLabel = esc(opts.yLabel || 'Y');
    el.innerHTML = `<div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="散点图">
      ${grid}${line}${points}
      <line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="#d8d0c0"/>
      <text x="${ml + pw / 2}" y="${H - 8}" text-anchor="middle" class="chart-axis-text">${esc(truncate(opts.xLabel || '', W - 130))}</text>
      <text x="14" y="${mt + ph / 2}" text-anchor="middle" transform="rotate(-90 14 ${mt + ph / 2})" class="chart-axis-text">${yLabel}</text>
    </svg></div>`;
    initTip();
  };

  /* ------------------------------------------------------------ box plot */
  C.box = function (el, stats) {
    if (!el) return;
    if (!stats || stats.n === 0) {
      el.innerHTML = `<div class="chart-empty">暂无有效数值</div>`;
      return;
    }
    const W = chartWidth(el), H = 134;
    const ml = 30, mr = 30, cy = 54;
    const lo = num(stats.min), hi = num(stats.max);
    const span = hi - lo || 1;
    const sx = (v) => ml + ((v - lo) / span) * (W - ml - mr);
    const q1 = num(stats.q1), q3 = num(stats.q3), median = num(stats.median), mean = num(stats.mean);
    const axisTicks = rangeTicks(lo, hi, 4);
    const ticks = axisTicks.map((t) => `<line x1="${sx(t)}" y1="${cy + 56}" x2="${sx(t)}" y2="${cy + 64}" stroke="#cfc5b1"/><text x="${sx(t)}" y="${cy + 78}" text-anchor="middle" class="chart-axis-text">${valueFmt(t, 0)}</text>`).join('');
    el.innerHTML = `<div class="chart-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="箱线图">
      <line x1="${sx(lo)}" y1="${cy}" x2="${sx(hi)}" y2="${cy}" stroke="#b9b1a1" stroke-width="1.2"/>
      <line x1="${sx(lo)}" y1="${cy - 12}" x2="${sx(lo)}" y2="${cy + 12}" stroke="#b9b1a1"/>
      <line x1="${sx(hi)}" y1="${cy - 12}" x2="${sx(hi)}" y2="${cy + 12}" stroke="#b9b1a1"/>
      <rect x="${sx(q1)}" y="${cy - 17}" width="${Math.max(2, sx(q3) - sx(q1))}" height="34" rx="3" fill="rgba(91,140,123,.16)" stroke="#5B8C7B"/>
      <line x1="${sx(median)}" y1="${cy - 17}" x2="${sx(median)}" y2="${cy + 17}" stroke="#1B4332" stroke-width="2"/>
      <path d="M ${sx(mean)} ${cy - 4} L ${sx(mean) + 4} ${cy} L ${sx(mean)} ${cy + 4} L ${sx(mean) - 4} ${cy} Z" fill="#B85C3E"/>
      <text x="${sx(lo)}" y="${cy - 20}" text-anchor="middle" class="chart-axis-text">${esc(valueFmt(lo, 0))}</text>
      <text x="${sx(hi)}" y="${cy - 20}" text-anchor="middle" class="chart-axis-text">${esc(valueFmt(hi, 0))}</text>
      ${ticks}
    </svg></div>`;
  };

  /* ------------------------------------------------------------ ring / gauge */
  C.ring = function (el, opts) {
    if (!el) return;
    const value = num(opts.value);
    const max = num(opts.max) || 100;
    const ratio = Math.max(0, Math.min(1, value / max));
    const W = 170, cx = 85, cy = 85, r = 64, sw = 11;
    const circ = 2 * Math.PI * r;
    const color = opts.color || (ratio >= 0.8 ? '#2F5D50' : ratio >= 0.6 ? '#C8A558' : '#B85C3E');
    const display = opts.display != null ? opts.display : valueFmt(value, 0);
    const sub = opts.label || '';
    el.innerHTML = `<div class="chart-box"><svg viewBox="0 0 ${W} ${W}" role="img" aria-label="${esc(sub)}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${sw}"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${ratio * circ} ${circ}" transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy + 2}" text-anchor="middle" style="font-family:var(--serif);font-size:30px;fill:#1e2a23">${esc(display)}</text>
      <text x="${cx}" y="${cy + 23}" text-anchor="middle" class="chart-axis-text">${esc(sub)}</text>
    </svg></div>`;
  };

  /* ------------------------------------------------------------ color helpers */
  C.corrColor = function (r) {
    const a = Math.min(Math.abs(num(r)), 1);
    if (num(r) >= 0) {
      return { bg: `rgba(47,93,80,${(0.05 + a * 0.8).toFixed(3)})`, fg: a > 0.56 ? '#fffdf8' : '#1e2a23' };
    }
    return { bg: `rgba(184,92,62,${(0.05 + a * 0.75).toFixed(3)})`, fg: a > 0.5 ? '#fffdf8' : '#6b3324' };
  };

  C.heatColor = function (pct) {
    const a = Math.max(0, Math.min(1, num(pct) / 100));
    return {
      bg: `rgba(47,93,80,${(0.04 + a * 0.72).toFixed(3)})`,
      fg: a > 0.55 ? '#fffdf8' : '#1e2a23',
    };
  };

  C.completionColor = function (value) {
    const v = num(value);
    if (v < 80) return '#B85C3E';
    if (v < 95) return '#C8A558';
    return '#5B8C7B';
  };

  C.initTip = initTip;
  App.charts = C;
}());
