/* ============================================================
   Survey Insight — AI interpretation & follow-up Q&A
   ============================================================ */
(function () {
  const App = window.App;
  const S = () => App.state;
  App.pages = App.pages || {};

  const state = {
    status: null,
    configOpen: false,
    summary: '',
    summaryError: '',
    summaryStreaming: false,
    summaryAbort: null,
    summaryFocus: 'default',
    summaryMeta: '',
    chat: [],
    chatStreaming: false,
    chatAbort: null,
    contextText: null,
    contextOpen: false,
    contextLoading: false,
    testBusy: false,
    agent: readAgentPref(),
  };

  function readAgentPref() {
    try {
      const value = localStorage.getItem('si.llmAgent');
      return value === null ? true : value === '1';
    } catch (err) {
      return true;
    }
  }

  const FOCUS = {
    default: { label: '综合解读', text: '' },
    structure: { label: '关系结构', text: '重点解释相关关系的整体结构、可能的潜在维度与聚类模式。' },
    risk: { label: '风险与局限', text: '重点分析相关结果的替代解释、共同方法偏差、样本量与统计局限。' },
    action: { label: '行动建议', text: '重点给出后续问卷设计、补充分析与业务决策建议。' },
  };

  const SUGGESTIONS = [
    '请用通俗语言解释最值得关注的相关关系。',
    '请做一次完整的相关与信度诊断，并给出后续分析计划。',
    '哪些相关关系可能是虚假相关或受第三变量影响？',
    'Cronbach\'s α 偏低时应该怎么处理？',
    '样本量会怎样影响这些相关性的显著性？',
  ];

  function e(v) { return App.escape(v); }

  function empty(msg) {
    return `<div class="panel-empty"><h3>还没有可解读的数据</h3><p>${e(msg)}</p><div class="pe-actions"><button class="btn primary" data-import>导入问卷数据</button></div></div>`;
  }

  /* ================================================================ page */
  App.pages.llm = {
    async load() {
      const root = document.getElementById('page-llm');
      if (!root) return;
      if (!S().surveyId) { root.innerHTML = empty('导入问卷后，AI 可以汇总相关分析结果并回答问题。'); return; }

      if (!state.status) {
        root.innerHTML = App.loadingHTML('正在读取 AI 配置…', 2);
        try {
          state.status = await App.get('/api/llm/status');
        } catch (err) {
          root.innerHTML = `<div class="panel-empty"><h3>无法读取 AI 配置</h3><p>${e(err.message)}</p></div>`;
          return;
        }
      }
      renderPage(root);
      refreshStatus();

      if (!S().caches.overview || !S().caches.correlation) loadFacts();
    },
    reset() {
      abortStreams();
      state.summary = '';
      state.summaryError = '';
      state.summaryMeta = '';
      state.chat = [];
      state.summaryFocus = 'default';
      state.contextText = null;
      state.contextOpen = false;
    },
  };

  function abortStreams() {
    if (state.summaryAbort) {
      try { state.summaryAbort.abort(); } catch (err) { /* ignore */ }
      state.summaryAbort = null;
    }
    if (state.chatAbort) {
      try { state.chatAbort.abort(); } catch (err) { /* ignore */ }
      state.chatAbort = null;
    }
    state.summaryStreaming = false;
    state.chatStreaming = false;
  }

  async function refreshStatus() {
    try {
      const fresh = await App.get('/api/llm/status');
      const changed = Boolean(state.status && fresh.configured !== state.status.configured);
      state.status = fresh;
      updateStatusChip();
      updateConfigHint();
      updateActionAvailability();
      if (changed && !state.summaryStreaming && !state.chatStreaming) {
        const root = document.getElementById('page-llm');
        if (root) renderPage(root);
      }
    } catch (err) { /* 保持已有状态 */ }
  }

  /* ---------------------------------------------------------------- render */
  function renderPage(root) {
    const cfg = state.status || {};
    const configured = Boolean(cfg.configured);
    const showConfig = state.configOpen || !configured;
    const activeFocus = FOCUS[state.summaryFocus] ? state.summaryFocus : 'default';

    root.innerHTML = `
      <div class="llm-hero">
        <div class="llm-hero-copy">
          <div class="llm-avatar" aria-hidden="true">AI</div>
          <div>
            <div class="eyebrow">LLM INSIGHT / 智能解读</div>
            <h2>让模型读懂你的相关分析</h2>
            <p>基于当前数据的 Spearman 相关矩阵、显著相关对与 Cronbach's α 生成解读，并可以继续追问统计方法与数据含义。</p>
          </div>
        </div>
        <div class="llm-hero-side">
          <span class="chip ${configured ? 'good' : 'warn'}" id="llm-status-chip">${statusChipHTML()}</span>
          <button class="btn sm ghost" id="llm-config-toggle" type="button">${showConfig ? '收起配置' : '配置模型'}</button>
        </div>
      </div>

      <div class="card llm-config ${showConfig ? '' : 'hidden'}" id="llm-config-card">
        <div class="card-head">
          <div>
            <h3 class="card-title">模型服务配置</h3>
            <p class="card-sub">支持 OpenAI 兼容接口与 Anthropic Messages API；配置仅保存在本地进程内存，不写入磁盘。</p>
          </div>
        </div>
        <div class="llm-form-grid">
          <div class="field">
            <label for="llm-provider">服务类型</label>
            <select id="llm-provider">
              <option value="openai" ${cfg.provider !== 'anthropic' ? 'selected' : ''}>OpenAI 兼容接口</option>
              <option value="anthropic" ${cfg.provider === 'anthropic' ? 'selected' : ''}>Anthropic Messages API</option>
            </select>
          </div>
          <div class="field">
            <label for="llm-base-url">接口地址 Base URL</label>
            <input type="text" id="llm-base-url" value="${e(cfg.base_url || '')}" autocomplete="off" spellcheck="false">
          </div>
          <div class="field">
            <label for="llm-model">模型名称</label>
            <input type="text" id="llm-model" value="${e(cfg.model || '')}" placeholder="例如 gpt-4o-mini / deepseek-chat / claude-sonnet-5" autocomplete="off" spellcheck="false">
          </div>
          <div class="field">
            <label for="llm-key">API Key</label>
            <input type="password" id="llm-key" value="" placeholder="${cfg.api_key_set ? `已配置 ${e(cfg.api_key_hint)}，留空保持不变` : '本地模型服务可留空'}" autocomplete="off">
          </div>
        </div>
        <div class="llm-form-foot">
          <span class="llm-form-hint">${configHintHTML()}</span>
          <div class="spacer"></div>
          ${cfg.api_key_set ? '<button class="btn sm subtle" id="llm-clear-key" type="button">清除密钥</button>' : ''}
          <button class="btn sm subtle" id="llm-deepseek" type="button" title="填入成本优先的 DeepSeek 配置">DeepSeek 预设</button>
          <button class="btn sm subtle" id="llm-reset-config" type="button">恢复本地配置</button>
          <button class="btn sm ghost" id="llm-test" type="button">${state.testBusy ? '测试中…' : '测试连接'}</button>
          <button class="btn sm primary" id="llm-save" type="button">保存配置</button>
        </div>
      </div>

      <div class="llm-layout">
        <div class="llm-main">
          <div class="card llm-summary-card">
            <div class="card-head">
              <div>
                <h3 class="card-title">相关分析总结</h3>
                <p class="card-sub">基于 Spearman 相关矩阵、显著相关对、量表信度与数据质量自动生成</p>
              </div>
              <div class="card-tools">
                <div class="seg llm-focus" id="llm-focus">
                  ${Object.entries(FOCUS).map(([key, item]) => `<button type="button" data-focus="${key}" class="${key === activeFocus ? 'active' : ''}" ${state.summaryStreaming ? 'disabled' : ''}>${e(item.label)}</button>`).join('')}
                </div>
                <button class="btn sm ghost hidden" id="llm-copy" type="button">复制</button>
                <button class="btn sm primary" id="llm-summary-btn" type="button">${summaryButtonLabel()}</button>
              </div>
            </div>
            <div id="llm-summary-content" class="llm-summary-content"></div>
          </div>

          <div class="card llm-chat-card">
            <div class="card-head">
              <div>
                <h3 class="card-title">追问与知识问答</h3>
                <p class="card-sub">可以问当前数据的相关关系，也可以问相关、显著性、信度等研究方法知识${agentSupported() ? '；Agent 模式下模型会按需调用本地分析工具' : ''}</p>
              </div>
              <div class="card-tools">
                <label class="llm-agent-switch" title="${agentSupported() ? '允许模型按需调用频数、交叉分析、分组比较等本地工具；会增加少量 token 消耗' : '当前服务类型不支持工具调用'}">
                  <input type="checkbox" id="llm-agent" ${state.agent ? 'checked' : ''} ${agentSupported() ? '' : 'disabled'}>
                  <span>Agent 分析</span>
                </label>
                <button class="link-btn" id="llm-clear-chat" type="button" ${state.chat.length ? '' : 'disabled'}>清空对话</button>
              </div>
            </div>
            <div class="llm-suggest" id="llm-suggest">
              ${SUGGESTIONS.map((text) => `<button type="button" class="llm-suggest-chip" data-suggest="${e(text)}">${e(text)}</button>`).join('')}
            </div>
            <div class="llm-chat-log" id="llm-chat-log"></div>
            <div class="llm-composer">
              <textarea id="llm-input" rows="2" placeholder="例如：这几对相关关系可能有哪些替代解释？" ${state.chatStreaming ? 'disabled' : ''}></textarea>
              <div class="llm-composer-foot">
                <span class="small faint">Enter 发送 · Shift + Enter 换行 · 回答由模型生成，请核对后使用</span>
                <button class="btn primary sm" id="llm-send" type="button">${state.chatStreaming ? '停止' : '发送'}</button>
              </div>
            </div>
          </div>
        </div>

        <aside class="llm-side">
          <div class="card llm-facts-card">
            <div class="card-head">
              <div>
                <h3 class="card-title">本次分析摘要</h3>
                <p class="card-sub">AI 解读所依据的统计口径</p>
              </div>
            </div>
            <div id="llm-facts" class="llm-facts">${factsHTML()}</div>
          </div>
          <div class="card llm-privacy-card">
            <div class="card-head">
              <div>
                <h3 class="card-title">发送给模型的内容</h3>
                <p class="card-sub">聚合统计摘要，不含原始答卷</p>
              </div>
            </div>
            <p class="llm-privacy-text">只会发送题目清单、相关矩阵/相关对、信度、数据质量与基准对比等汇总信息。题目名称与统计值会离开本机，请勿在题名或开放题中放入敏感信息。</p>
            <button class="btn sm ghost" id="llm-context-btn" type="button">${state.contextOpen ? '收起上下文' : '预览将要发送的上下文'}</button>
            <pre class="llm-context ${state.contextOpen ? '' : 'hidden'}" id="llm-context">${state.contextOpen && state.contextText ? e(state.contextText) : ''}</pre>
          </div>
        </aside>
      </div>`;

    bindPage(root);
    renderSummary();
    renderChat();
    updateActionAvailability();
  }

  function sourceLabel(source) {
    return {
      runtime: '界面配置', env: '环境变量', file: '本地配置文件 .secrets/llm.json', default: '默认配置',
    }[source] || '默认配置';
  }

  function agentSupported() {
    const cfg = state.status || {};
    if (cfg.provider === 'anthropic') return false;
    return cfg.agent_supported !== false;
  }

  function configHintHTML() {
    return `也支持环境变量 <code>SI_LLM_PROVIDER</code> / <code>SI_LLM_BASE_URL</code> / <code>SI_LLM_MODEL</code> / <code>SI_LLM_API_KEY</code>，或本地文件 <code>.secrets/llm.json</code>（已忽略提交）。当前来源：${e(sourceLabel((state.status || {}).source))}。`;
  }

  function statusChipHTML() {
    const cfg = state.status || {};
    if (!cfg.configured) return '<span class="dot"></span>未配置模型服务';
    return `<span class="dot"></span>${e(cfg.provider_label || cfg.provider)} · ${e(cfg.model)}`;
  }

  function summaryButtonLabel() {
    if (state.summaryStreaming) return '停止生成';
    if (state.summary) return '重新生成';
    return '生成 AI 解读';
  }

  function updateStatusChip() {
    const chip = document.getElementById('llm-status-chip');
    if (!chip) return;
    const configured = state.status && state.status.configured;
    chip.className = `chip ${configured ? 'good' : 'warn'}`;
    chip.innerHTML = statusChipHTML();
  }

  function updateConfigHint() {
    const hint = document.querySelector('#llm-config-card .llm-form-hint');
    if (hint && state.status) hint.innerHTML = configHintHTML();
  }

  function updateActionAvailability() {
    const configured = Boolean(state.status && state.status.configured);
    const summaryBtn = document.getElementById('llm-summary-btn');
    if (summaryBtn) {
      summaryBtn.textContent = summaryButtonLabel();
      summaryBtn.classList.toggle('primary', !state.summaryStreaming);
      summaryBtn.classList.toggle('ghost', state.summaryStreaming);
    }
    const send = document.getElementById('llm-send');
    if (send) send.textContent = state.chatStreaming ? '停止' : '发送';
    const input = document.getElementById('llm-input');
    if (input) input.disabled = state.chatStreaming;
    const copy = document.getElementById('llm-copy');
    if (copy) copy.classList.toggle('hidden', !(state.summary && !state.summaryStreaming));
    document.querySelectorAll('#llm-focus button').forEach((btn) => { btn.disabled = state.summaryStreaming; });
    const clearChat = document.getElementById('llm-clear-chat');
    if (clearChat) clearChat.disabled = !state.chat.length || state.chatStreaming;
    if (!configured) {
      const chip = document.getElementById('llm-status-chip');
      if (chip) { chip.className = 'chip warn'; chip.innerHTML = statusChipHTML(); }
    }
  }

  /* ---------------------------------------------------------------- bind */
  function bindPage(root) {
    const toggle = document.getElementById('llm-config-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const card = document.getElementById('llm-config-card');
        const visible = card && !card.classList.contains('hidden');
        state.configOpen = !visible;
        if (card) card.classList.toggle('hidden', visible);
        toggle.textContent = state.configOpen ? '收起配置' : '配置模型';
      });
    }

    const provider = document.getElementById('llm-provider');
    if (provider) {
      provider.addEventListener('change', () => {
        const base = document.getElementById('llm-base-url');
        if (!base) return;
        const knownDefaults = ['https://api.openai.com/v1', 'https://api.anthropic.com', ''];
        if (knownDefaults.includes(base.value.trim())) {
          base.value = provider.value === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
        }
      });
    }

    const deepseek = document.getElementById('llm-deepseek');
    if (deepseek) {
      deepseek.addEventListener('click', () => {
        const provider = document.getElementById('llm-provider');
        const base = document.getElementById('llm-base-url');
        const model = document.getElementById('llm-model');
        if (provider) provider.value = 'openai';
        if (base) base.value = 'https://api.deepseek.com';
        if (model) model.value = 'deepseek-chat';
        App.toast('已填入 DeepSeek 配置（deepseek-chat，成本优先）。补充 API Key 后保存。', 'info', 5200);
      });
    }

    const agentBox = document.getElementById('llm-agent');
    if (agentBox) {
      agentBox.addEventListener('change', () => {
        state.agent = agentBox.checked;
        try { localStorage.setItem('si.llmAgent', state.agent ? '1' : '0'); } catch (err) { /* ignore */ }
        App.toast(state.agent ? '已开启 Agent 分析模式。' : '已关闭 Agent 分析模式，仅使用上下文问答。', 'info', 3200);
      });
    }

    const save = document.getElementById('llm-save');
    if (save) save.addEventListener('click', () => saveConfig(true));
    const test = document.getElementById('llm-test');
    if (test) test.addEventListener('click', testConnection);
    const reset = document.getElementById('llm-reset-config');
    if (reset) reset.addEventListener('click', resetConfig);
    const clearKey = document.getElementById('llm-clear-key');
    if (clearKey) clearKey.addEventListener('click', clearApiKey);

    const summaryBtn = document.getElementById('llm-summary-btn');
    if (summaryBtn) {
      summaryBtn.addEventListener('click', () => {
        if (state.summaryStreaming) stopSummary();
        else generateSummary();
      });
    }
    const copy = document.getElementById('llm-copy');
    if (copy) copy.addEventListener('click', copySummary);

    const focus = document.getElementById('llm-focus');
    if (focus) {
      focus.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-focus]');
        if (!btn || state.summaryStreaming) return;
        state.summaryFocus = btn.dataset.focus;
        focus.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      });
    }

    const send = document.getElementById('llm-send');
    if (send) {
      send.addEventListener('click', () => {
        if (state.chatStreaming) stopChat();
        else sendChat();
      });
    }
    const input = document.getElementById('llm-input');
    if (input) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          if (!state.chatStreaming) sendChat();
        }
      });
    }
    const suggest = document.getElementById('llm-suggest');
    if (suggest) {
      suggest.addEventListener('click', (ev) => {
        const chip = ev.target.closest('[data-suggest]');
        if (!chip || state.chatStreaming) return;
        const text = chip.dataset.suggest;
        const box = document.getElementById('llm-input');
        if (box) box.value = text;
        sendChat();
      });
    }
    const clearChat = document.getElementById('llm-clear-chat');
    if (clearChat) {
      clearChat.addEventListener('click', () => {
        if (state.chatStreaming) return;
        state.chat = [];
        renderChat();
        updateActionAvailability();
      });
    }
    const contextBtn = document.getElementById('llm-context-btn');
    if (contextBtn) contextBtn.addEventListener('click', toggleContext);
  }

  /* ---------------------------------------------------------------- config */
  function readConfigForm() {
    const provider = document.getElementById('llm-provider');
    const baseUrl = document.getElementById('llm-base-url');
    const model = document.getElementById('llm-model');
    const key = document.getElementById('llm-key');
    return {
      provider: provider ? provider.value : 'openai',
      base_url: baseUrl ? baseUrl.value.trim() : '',
      model: model ? model.value.trim() : '',
      api_key: key ? key.value.trim() : '',
    };
  }

  async function persistConfig() {
    const payload = readConfigForm();
    if (!payload.base_url || !payload.model) {
      throw new Error('请填写接口地址与模型名称。');
    }
    const st = await App.post('/api/llm/config', payload);
    state.status = st;
    updateStatusChip();
    updateConfigHint();
    updateActionAvailability();
    return st;
  }

  async function saveConfig(closePanel) {
    const btn = document.getElementById('llm-save');
    if (btn) btn.disabled = true;
    try {
      await persistConfig();
      const root = document.getElementById('page-llm');
      state.configOpen = !closePanel;
      if (root) renderPage(root);
      App.toast('模型配置已保存（仅保存在当前进程内存）。', 'success');
      if (state.status && !state.status.configured) {
        App.toast('配置不完整，请检查接口地址与模型名称。', 'error');
      }
    } catch (err) {
      App.toast(err.message, 'error', 5200);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function testConnection() {
    if (state.testBusy) return;
    state.testBusy = true;
    const btn = document.getElementById('llm-test');
    if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
    try {
      await persistConfig();
      const res = await App.post('/api/llm/test', {});
      App.toast(`连接成功：${res.reply || '模型已响应'}`, 'success', 5200);
    } catch (err) {
      App.toast(err.message, 'error', 7000);
    } finally {
      state.testBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '测试连接'; }
    }
  }

  async function resetConfig() {
    try {
      state.status = await App.post('/api/llm/config', { reset: true });
      const root = document.getElementById('page-llm');
      state.configOpen = !(state.status && state.status.configured);
      if (root) renderPage(root);
      App.toast('已恢复环境变量或默认配置。', 'success');
    } catch (err) {
      App.toast(err.message, 'error', 5200);
    }
  }

  async function clearApiKey() {
    try {
      state.status = await App.post('/api/llm/config', { clear_key: true });
      const root = document.getElementById('page-llm');
      if (root) renderPage(root);
      App.toast('已清除当前进程中的 API Key。', 'success');
    } catch (err) {
      App.toast(err.message, 'error', 5200);
    }
  }

  /* ---------------------------------------------------------------- summary */
  function renderSummary() {
    const box = document.getElementById('llm-summary-content');
    if (!box) return;
    if (state.summaryStreaming) {
      box.innerHTML = `<div class="llm-stream"><div class="md llm-stream-text" id="llm-stream-text"></div><div class="llm-cursor-row"><span class="llm-cursor"></span> 正在生成…</div></div>`;
      const text = document.getElementById('llm-stream-text');
      if (text) text.textContent = state.summary;
      return;
    }
    if (state.summary) {
      box.innerHTML = `
        <div class="md llm-summary-md">${markdown(state.summary)}</div>
        ${state.summaryError ? `<div class="llm-error"><strong>生成中断</strong><p>${e(state.summaryError)}</p><button class="btn sm ghost" id="llm-retry" type="button">重试</button></div>` : ''}
        ${state.summaryMeta ? `<div class="llm-meta">${e(state.summaryMeta)}</div>` : ''}`;
      const retry = document.getElementById('llm-retry');
      if (retry) retry.addEventListener('click', generateSummary);
      updateActionAvailability();
      return;
    }
    if (state.summaryError) {
      box.innerHTML = `<div class="llm-error"><strong>生成失败</strong><p>${e(state.summaryError)}</p><button class="btn sm ghost" id="llm-retry" type="button">重试</button></div>`;
      const retry = document.getElementById('llm-retry');
      if (retry) retry.addEventListener('click', generateSummary);
      return;
    }
    box.innerHTML = `
      <div class="llm-empty">
        <div class="llm-empty-mark">✦</div>
        <h3>把相关结果交给 AI 梳理</h3>
        <p>模型会读取当前数据的相关矩阵、显著相关对与信度结果，先给出一份结构化解读；随后你可以在下方继续追问。</p>
        <div class="llm-empty-points">
          <span>相关结构解读</span><span>替代解释与局限</span><span>信度改进建议</span><span>后续分析方向</span>
        </div>
      </div>`;
  }

  async function generateSummary() {
    if (state.summaryStreaming) return;
    if (!state.status || !state.status.configured) {
      state.configOpen = true;
      const root = document.getElementById('page-llm');
      if (root) renderPage(root);
      App.toast('请先配置模型服务。', 'error');
      return;
    }
    state.summary = '';
    state.summaryError = '';
    state.summaryMeta = '';
    state.summaryStreaming = true;
    state.summaryAbort = new AbortController();
    renderSummary();
    updateActionAvailability();

    const focus = FOCUS[state.summaryFocus] || FOCUS.default;
    const started = Date.now();
    try {
      await streamSSE('/api/llm/summary', {
        dataset_id: S().surveyId,
        baseline_id: S().baselineId || undefined,
        focus: focus.text,
      }, {
        signal: state.summaryAbort.signal,
        onDelta(delta) {
          state.summary += delta;
          const box = document.getElementById('llm-stream-text');
          if (box) box.textContent = state.summary;
        },
      });
      if (!state.summary.trim()) throw new Error('模型没有返回内容。');
      state.summaryMeta = `${modelLabel()} · 用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    } catch (err) {
      if (err.name === 'AbortError') {
        state.summaryError = state.summary ? '生成已停止，以下为未完成的内容。' : '生成已停止。';
      } else {
        state.summaryError = err.message;
        App.toast(err.message, 'error', 6000);
      }
    } finally {
      state.summaryStreaming = false;
      state.summaryAbort = null;
      renderSummary();
      updateActionAvailability();
    }
  }

  function stopSummary() {
    if (state.summaryAbort) state.summaryAbort.abort();
  }

  async function copySummary() {
    if (!state.summary) return;
    try {
      await navigator.clipboard.writeText(state.summary);
      App.toast('已复制 AI 解读。', 'success');
    } catch (err) {
      App.toast('复制失败，请手动选择文本。', 'error');
    }
  }

  /* ---------------------------------------------------------------- chat */
  function renderChat() {
    const log = document.getElementById('llm-chat-log');
    if (!log) return;
    if (!state.chat.length) {
      log.innerHTML = `<div class="llm-chat-empty">还没有对话。点击上方推荐问题，或直接输入你的问题。</div>`;
      return;
    }
    log.innerHTML = state.chat.map((msg, idx) => {
      if (msg.role === 'user') {
        return `<div class="llm-msg user"><div class="llm-bubble">${e(msg.content).replace(/\n/g, '<br>')}</div><div class="llm-msg-label">你</div></div>`;
      }
      const streaming = msg.streaming && idx === state.chat.length - 1;
      const body = streaming
        ? `<div class="llm-stream-text" id="llm-live-answer" style="white-space:pre-wrap">${e(msg.content)}</div><div class="llm-cursor-row"><span class="llm-cursor"></span> ${msg.tools && msg.tools.length ? '正在整理分析结果…' : '正在回答…'}</div>`
        : `<div class="md">${markdown(msg.content)}</div>`;
      const tools = (msg.tools && msg.tools.length)
        ? `<div class="llm-tool-log">${msg.tools.map((tool) => `<span class="llm-tool ${tool.ok ? 'ok' : 'err'}" title="${e(tool.detail || '')}">${tool.ok ? '◆' : '!'} ${e(tool.label || tool.name)}</span>`).join('')}</div>`
        : '';
      const notes = (msg.notes && msg.notes.length)
        ? `<div class="llm-note">${msg.notes.map((note) => `<span>${e(note)}</span>`).join('')}</div>`
        : '';
      const error = msg.error ? `<div class="llm-error slim"><p>${e(msg.error)}</p></div>` : '';
      return `<div class="llm-msg ai"><div class="llm-avatar sm" aria-hidden="true">AI</div><div class="llm-bubble"><div class="llm-msg-label">AI · ${e(modelLabel() || 'LLM')}</div>${tools}${notes}${body}${error}</div></div>`;
    }).join('');
    scrollChat();
  }

  function scrollChat() {
    const log = document.getElementById('llm-chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  async function sendChat() {
    if (state.chatStreaming) return;
    if (!state.status || !state.status.configured) {
      state.configOpen = true;
      const root = document.getElementById('page-llm');
      if (root) renderPage(root);
      App.toast('请先配置模型服务。', 'error');
      return;
    }
    const input = document.getElementById('llm-input');
    const text = input ? input.value.trim() : '';
    if (!text) {
      App.toast('请输入问题。', 'error');
      return;
    }
    if (input) input.value = '';

    state.chat.push({ role: 'user', content: text });
    const answer = { role: 'assistant', content: '', streaming: true, error: '', tools: [], notes: [] };
    state.chat.push(answer);
    state.chatStreaming = true;
    state.chatAbort = new AbortController();
    renderChat();
    updateActionAvailability();

    const history = state.chat
      .filter((m) => !m.streaming && m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      await streamSSE('/api/llm/chat', {
        dataset_id: S().surveyId,
        baseline_id: S().baselineId || undefined,
        history,
        agent: Boolean(state.agent && agentSupported()),
      }, {
        signal: state.chatAbort.signal,
        onDelta(delta) {
          answer.content += delta;
          const live = document.getElementById('llm-live-answer');
          if (live) live.textContent = answer.content;
          scrollChat();
        },
        onTool(tool) {
          answer.tools.push(tool);
          renderChat();
        },
        onNote(note) {
          answer.notes.push(note);
          renderChat();
        },
      });
      if (!answer.content.trim()) answer.error = '模型没有返回内容。';
    } catch (err) {
      if (err.name === 'AbortError') {
        answer.error = answer.content ? '回答已停止。' : '回答已停止。';
      } else {
        answer.error = err.message;
        App.toast(err.message, 'error', 6000);
      }
    } finally {
      answer.streaming = false;
      state.chatStreaming = false;
      state.chatAbort = null;
      renderChat();
      updateActionAvailability();
    }
  }

  function stopChat() {
    if (state.chatAbort) state.chatAbort.abort();
  }

  /* ---------------------------------------------------------------- facts & context */
  function factsHTML() {
    const overview = S().caches.overview;
    const corr = S().caches.correlation;
    const kpi = overview && overview.kpi ? overview.kpi : {};
    const alpha = primaryAlpha(corr);
    const corrAvailable = corr && corr.available;
    const rows = [
      ['有效样本', kpi.rows != null ? App.fmtInt(kpi.rows) : '—'],
      ['分析题目', kpi.questions != null ? `${kpi.questions} 道` : '—'],
      ['数值 / 量表题', corrAvailable ? `${(corr.names || []).length} 道` : '—'],
      ['强 / 中等相关', corrAvailable ? `${corr.strong_count || 0} / ${corr.moderate_count || 0} 对` : '—'],
      ['量表信度 α', alpha != null ? alpha.toFixed(3) : '—'],
    ];
    return rows.map(([label, value]) => `<div class="llm-fact"><span>${e(label)}</span><strong>${e(value)}</strong></div>`).join('');
  }

  function primaryAlpha(corr) {
    const rel = corr && corr.reliability;
    if (!rel || !rel.available || rel.alpha == null) return null;
    const value = Number(rel.alpha);
    return Number.isFinite(value) ? value : null;
  }

  function updateFacts() {
    const box = document.getElementById('llm-facts');
    if (box) box.innerHTML = factsHTML();
  }

  async function loadFacts() {
    try {
      const jobs = [];
      if (!S().caches.overview) {
        jobs.push(App.get('/api/overview', { dataset_id: S().surveyId }).then((data) => { S().caches.overview = data; }));
      }
      if (!S().caches.correlation) {
        jobs.push(App.get('/api/correlation', { dataset_id: S().surveyId }).then((data) => { S().caches.correlation = data; }));
      }
      if (jobs.length) await Promise.all(jobs);
      updateFacts();
    } catch (err) { /* 摘要卡片保持占位 */ }
  }

  async function toggleContext() {
    const btn = document.getElementById('llm-context-btn');
    const pre = document.getElementById('llm-context');
    if (!pre) return;
    if (state.contextOpen) {
      state.contextOpen = false;
      pre.classList.add('hidden');
      if (btn) btn.textContent = '预览将要发送的上下文';
      return;
    }
    if (state.contextText) {
      state.contextOpen = true;
      pre.textContent = state.contextText;
      pre.classList.remove('hidden');
      if (btn) btn.textContent = '收起上下文';
      return;
    }
    state.contextLoading = true;
    if (btn) { btn.disabled = true; btn.textContent = '正在读取…'; }
    try {
      const data = await App.get('/api/llm/context', {
        dataset_id: S().surveyId,
        baseline_id: S().baselineId || undefined,
      });
      state.contextText = data.context || '';
      state.contextOpen = true;
      pre.textContent = state.contextText;
      pre.classList.remove('hidden');
      if (btn) btn.textContent = '收起上下文';
    } catch (err) {
      App.toast(err.message, 'error', 5200);
      if (btn) btn.textContent = '预览将要发送的上下文';
    } finally {
      state.contextLoading = false;
      if (btn) btn.disabled = false;
    }
  }

  function modelLabel() {
    if (!state.status || !state.status.model) return '';
    return state.status.model;
  }

  /* ---------------------------------------------------------------- SSE */
  async function streamSSE(path, body, handlers) {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: handlers.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error('无法连接本地分析服务，请确认 Flask 已启动。');
    }
    if (!res.ok) {
      let message = `请求失败（HTTP ${res.status}）`;
      try {
        const data = await res.json();
        if (data && data.error) message = data.error;
      } catch (err) { /* ignore */ }
      throw new Error(message);
    }
    if (!res.body) throw new Error('当前浏览器不支持流式响应。');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const consume = (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let event;
        try { event = JSON.parse(payload); } catch (err) { continue; }
        if (event.error) throw new Error(event.error);
        if (event.delta && handlers.onDelta) handlers.onDelta(event.delta);
        if (event.tool && handlers.onTool) handlers.onTool(event.tool);
        if (event.note && handlers.onNote) handlers.onNote(event.note);
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          consume(chunk);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
    } finally {
      try { reader.releaseLock(); } catch (err) { /* ignore */ }
    }
  }

  /* ---------------------------------------------------------------- markdown */
  function inlineMd(text) {
    return text
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  }

  function splitRow(row) {
    let s = row.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((cell) => cell.trim());
  }

  function markdown(src) {
    const escaped = App.escape(src || '');
    const lines = escaped.split(/\r?\n/);
    const out = [];
    let list = null;
    let paragraph = [];
    let i = 0;

    const flushParagraph = () => {
      if (paragraph.length) {
        out.push(`<p>${paragraph.join('<br>')}</p>`);
        paragraph = [];
      }
    };
    const closeList = () => {
      if (list) {
        out.push(`</${list}>`);
        list = null;
      }
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { flushParagraph(); closeList(); i += 1; continue; }

      if (trimmed.startsWith('```')) {
        flushParagraph(); closeList();
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        out.push(`<pre><code>${code.join('\n')}</code></pre>`);
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushParagraph(); closeList();
        const level = Math.min(4, heading[1].length);
        out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        flushParagraph(); closeList();
        out.push('<hr>');
        i += 1;
        continue;
      }

      if (trimmed.startsWith('&gt;')) {
        flushParagraph(); closeList();
        out.push(`<blockquote>${inlineMd(trimmed.replace(/^&gt;\s?/, ''))}</blockquote>`);
        i += 1;
        continue;
      }

      if (trimmed.includes('|') && i + 1 < lines.length
          && lines[i + 1].includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        flushParagraph(); closeList();
        const header = splitRow(trimmed);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitRow(lines[i].trim()));
          i += 1;
        }
        out.push(`<div class="md-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${inlineMd(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMd(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }

      const unordered = trimmed.match(/^[-*+]\s+(.*)$/);
      const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (unordered || ordered) {
        flushParagraph();
        const type = unordered ? 'ul' : 'ol';
        if (list !== type) { closeList(); out.push(`<${type}>`); list = type; }
        out.push(`<li>${inlineMd(unordered ? unordered[1] : ordered[1])}</li>`);
        i += 1;
        continue;
      }

      closeList();
      paragraph.push(inlineMd(trimmed));
      i += 1;
    }

    flushParagraph();
    closeList();
    return out.join('\n');
  }
}());
