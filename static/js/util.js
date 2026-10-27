/* ============================================================
   Survey Insight — shared utilities & state
   ============================================================ */
window.App = window.App || {};

(function () {
  const App = window.App;

  App.state = {
    surveyId: null,
    surveyName: '',
    rows: 0,
    questions: [],
    overview: null,
    baselineId: null,
    baselineName: '',
    baselineSummary: null,
    page: 'overview',
    freqQuestion: null,
    cross: { q1: null, q2: null, mode: 'row' },
    compare: { bq: null, sq: null, result: null },
    insightFilter: 'all',
    caches: {
      overview: null,
      frequency: {},
      correlation: null,
      comparisonMeta: null,
      insights: null,
      comparisons: {},
    },
    loaded: {},
  };

  App.$ = (sel, root) => (root || document).querySelector(sel);
  App.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  App.escape = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  };

  App.fmt = function (value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    return Number.isInteger(n) ? n.toLocaleString('zh-CN') : n.toFixed(digits);
  };

  App.fmtInt = function (value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return Math.round(Number(value)).toLocaleString('zh-CN');
  };

  App.signed = function (value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    return (n > 0 ? '+' : '') + n.toFixed(digits);
  };

  App.debounce = function (fn, wait = 180) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  App.levelLabel = { warn: '需关注', good: '良好', info: '提示' };
  App.typeClass = { 单选题: 'single', 多选题: 'multi', 量表题: 'scale', 数值题: 'numeric', 文本题: 'text' };

  App.typeBadge = function (metaOrType, label) {
    if (metaOrType && typeof metaOrType === 'object') {
      const cls = App.typeClass[metaOrType.type_label] || '';
      return `<span class="type-badge ${cls}">${App.escape(metaOrType.type_label || '')}</span>`;
    }
    const cls = App.typeClass[metaOrType] || '';
    return `<span class="type-badge ${cls}">${App.escape(label || metaOrType || '')}</span>`;
  };

  App.getQuestion = function (name) {
    return (App.state.questions || []).find((q) => q.name === name) || null;
  };

  App.questionOptions = function (questions, allowedTypes, selected) {
    const list = (questions || []).filter((q) => !allowedTypes || allowedTypes.includes(q.type));
    return list.map((q) => {
      const sel = q.name === selected ? ' selected' : '';
      return `<option value="${App.escape(q.name)}"${sel}>${App.escape(q.name)} · ${App.escape(q.type_label)}</option>`;
    }).join('');
  };

  App.qs = function (params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') search.append(k, v);
    });
    const str = search.toString();
    return str ? `?${str}` : '';
  };

  async function request(path, options) {
    let res;
    try {
      res = await fetch(path, options);
    } catch (err) {
      throw new Error('无法连接本地分析服务，请确认 Flask 已启动。');
    }
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `请求失败（HTTP ${res.status}）`);
    }
    return data;
  }

  App.get = (path, params) => request(path + App.qs(params));
  App.post = (path, body) => request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  App.upload = (path, formData) => request(path, { method: 'POST', body: formData });

  App.toast = function (message, type = 'info', ms = 3800) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const mark = type === 'error' ? '!' : type === 'success' ? '✓' : '·';
    el.innerHTML = `<span class="toast-mark">${mark}</span><span>${App.escape(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 240);
    }, ms);
  };

  App.loadingHTML = function (label = '正在计算…', rows = 2) {
    let bars = '';
    for (let i = 0; i < rows; i += 1) {
      bars += `<div class="loading-line" style="width:${88 - i * 18}%"></div>`;
    }
    return `<div class="loading"><div class="spinner"></div><div>${App.escape(label)}</div>${bars}</div>`;
  };

  App.emptyHTML = function (message) {
    return `<div class="chart-empty">${App.escape(message)}</div>`;
  };

  App.persist = function () {
    try {
      if (App.state.surveyId) localStorage.setItem('si.surveyId', App.state.surveyId);
      else localStorage.removeItem('si.surveyId');
      if (App.state.baselineId) localStorage.setItem('si.baselineId', App.state.baselineId);
      else localStorage.removeItem('si.baselineId');
    } catch (err) { /* 本地存储不可用时忽略 */ }
  };

  App.restoreIds = function () {
    try {
      App.state.surveyId = localStorage.getItem('si.surveyId');
      App.state.baselineId = localStorage.getItem('si.baselineId');
    } catch (err) { /* ignore */ }
  };

  App.clearCaches = function () {
    App.state.caches = {
      overview: null,
      frequency: {},
      correlation: null,
      comparisonMeta: null,
      insights: null,
      comparisons: {},
    };
    App.state.loaded = {};
    App.state.freqQuestion = null;
    App.state.cross = { q1: null, q2: null, mode: 'row' };
    App.state.compare = { bq: null, sq: null, result: null };
    App.state.insightFilter = 'all';
  };

  App.resetData = function () {
    App.state.surveyId = null;
    App.state.surveyName = '';
    App.state.rows = 0;
    App.state.questions = [];
    App.state.overview = null;
    App.state.baselineId = null;
    App.state.baselineName = '';
    App.state.baselineSummary = null;
    App.clearCaches();
    App.persist();
  };

  App.sameOptions = function (a, b) {
    if (!a || !b) return false;
    const sa = new Set(a), sb = new Set(b);
    if (sa.size !== sb.size) return false;
    for (const x of sa) if (!sb.has(x)) return false;
    return true;
  };

  App.safeExternal = function (url) {
    return /^https?:\/\//i.test(url) ? url : '#';
  };
}());
