// 语音输入插件 · Client 半区
// 依赖：浏览器 Web Speech API（window.SpeechRecognition / webkitSpeechRecognition）
// 能力：输入框右侧麦克风按钮 → 点击说话 → 实时转文字填入输入框（可编辑、不自动发送）
// 插槽：conversation.input.right（按钮） / conversation.composer.dock（实时预览条） / settings.section（配置页）
return {
  inject: ['slots'],
  apply(ctx) {
    // ============================================================ 共享状态
    const store = {
      config: {
        language: 'zh-CN',
        autoSend: false,        // 说完即发
        punctuation: true,      // 自动补标点
        autoRestart: true,      // 意外中断自动重连一次
        whisperEndpoint: '',    // 增强档：本地 Whisper 服务地址（留空 = 浏览器内置识别）
      },
      status: 'idle',           // idle | listening | error
      interim: '',              // 中间结果（实时预览）
      finalCount: 0,            // 已识别字数
      error: null,              // 错误码
      errorText: '',
      supported: false,         // SpeechRecognition 可用
      secure: false,            // https / localhost 安全上下文
      hasMic: null,             // true / false / null(检测中)
      listeners: new Set(),
      appendText: null,         // 由 input.right 组件挂载时注入（写入输入框）
      submitNow: null,          // 由 input.right 组件注入（说完即发）
    };
    const emit = () => store.listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    const subscribe = (fn) => { store.listeners.add(fn); return () => store.listeners.delete(fn); };

    // ============================================================ 识别引擎（Web Speech API）
    let rec = null;
    let recSeq = 0;             // 识别实例序号：重启后旧实例的迟到事件一律作废（防“上一句串进下一句”）
    let userStopped = false;
    let autoRestartUsed = false;
    let noSpeechRetry = false;

    function getSR() { return window.SpeechRecognition || window.webkitSpeechRecognition; }

    function addPunctuation(t) {
      let s = String(t).replace(/\s+/g, ' ').trim();
      if (!s) return s;
      const last = s[s.length - 1];
      if ('。！？，、；：,.!?;:'.indexOf(last) >= 0) return s;
      return s + '。';
    }

    function commitFinal(text) {
      let t = String(text || '').trim();
      if (!t) return;
      if (store.config.punctuation) t = addPunctuation(t);
      if (store.appendText) store.appendText(t);
      store.finalCount += t.length;
      emit();
    }

    function setError(code, text) {
      store.status = 'error';
      store.error = code;
      store.errorText = text;
      stopRecInner();
      emit();
    }

    function handleRecError(err) {
      if (err === 'not-allowed') {
        setError('not-allowed', '麦克风权限被拒绝。请点击地址栏右侧的麦克风图标，允许本页面使用麦克风后重试。');
      } else if (err === 'no-speech') {
        if (!noSpeechRetry) {
          noSpeechRetry = true;
          store.errorText = '没有听到声音，请再说一次…';
          emit();
          restartRec();
        } else {
          noSpeechRetry = false;
          setError('no-speech', '多次未检测到语音，已停止。');
        }
      } else if (err === 'network' || err === 'service-not-allowed') {
        setError(err, '语音识别服务不可用（' + err + '）。请检查网络后重试。');
      } else if (err === 'audio-capture') {
        setError('audio-capture', '未检测到麦克风设备，请连接麦克风后重试。');
      } else {
        setError(err || 'unknown', '语音识别出错（' + (err || 'unknown') + '）。');
      }
    }

    function buildRec() {
      const SR = getSR();
      const r = new SR();
      const myId = ++recSeq;      // 本实例的身份；一旦重启，旧实例即失效
      const isStale = () => myId !== recSeq;
      r.lang = store.config.language;
      r.continuous = true;        // 连续听写，支持长段口述
      r.interimResults = true;    // 实时中间结果
      r.onresult = (event) => {
        if (isStale()) return;    // 旧实例的迟到结果不再提交
        let interim = '';
        let finals = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const tr = res && res[0] ? res[0].transcript : '';
          if (res.isFinal) finals += tr;
          else interim += tr;
        }
        if (finals) commitFinal(finals);
        store.interim = interim;
        emit();
      };
      r.onerror = (e) => { if (!isStale()) handleRecError(e.error); };
      r.onend = () => {
        if (isStale()) return;    // 旧实例的 onend 不触发重启/报错
        rec = null;
        if (!userStopped && store.status === 'listening') {
          // 识别器意外结束：按配置自动重启一次
          if (store.config.autoRestart && !autoRestartUsed) {
            autoRestartUsed = true;
            restartRec();
          } else {
            setError('ended', '识别意外中断，已停止。可再次点击麦克风继续。');
          }
        }
      };
      return r;
    }

    function restartRec() {
      if (store.status !== 'listening') return;
      // 先彻底停掉旧实例（abort 立即终止，不触发收尾回放），防止两个识别器并存导致文字重复/重叠
      if (rec) {
        try { rec.onend = null; rec.onerror = null; rec.abort(); } catch (e) { /* ignore */ }
        rec = null;
      }
      try {
        const r = buildRec();
        rec = r;
        r.start();
      } catch (e) {
        setError('start', '无法启动语音识别：' + (e && e.message || e));
      }
    }

    function stopRecInner() {
      if (rec) {
        try { rec.onend = null; rec.onerror = null; rec.stop(); } catch (e) { /* ignore */ }
        rec = null;
      }
      stopWhisper();
    }

    function startRecognition() {
      if (store.status === 'listening') return;
      if (!store.supported) { setError('unsupported', '当前浏览器不支持语音输入，请使用 Chrome / Edge。'); return; }
      if (!store.secure) { setError('insecure', '当前页面非安全上下文（需 https 或 localhost），语音输入不可用。'); return; }
      stopRecInner();
      userStopped = false;
      autoRestartUsed = false;
      noSpeechRetry = false;
      store.status = 'listening';
      store.interim = '';
      store.finalCount = 0;
      store.error = null;
      store.errorText = '';
      emit();
      if (store.config.whisperEndpoint) {
        startWhisper();
      } else {
        try {
          rec = buildRec();
          rec.start();
        } catch (e) {
          setError('start', '无法启动语音识别：' + (e && e.message || e));
        }
      }
    }

    function stopRecognition() {
      const wasListening = store.status === 'listening';
      userStopped = true;
      stopRecInner();
      store.status = 'idle';
      store.interim = '';
      emit();
      // 说完即发：停止后若开启且已有识别内容，则提交
      if (store.config.autoSend && wasListening && store.submitNow && store.finalCount > 0) {
        try { store.submitNow(); } catch (e) { /* ignore */ }
      }
    }

    // ============================================================ 增强档：本地 Whisper
    let whisperState = null;

    function stopWhisper() {
      if (whisperState) {
        const ws = whisperState;
        whisperState = null;
        try { ws.mr.stop(); } catch (e) { /* ignore */ }
        try { ws.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
      }
    }

    async function startWhisper() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        const chunks = [];
        mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mr.onstop = async () => {
          if (!whisperState) return;
          if (chunks.length) {
            const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
            chunks.length = 0;
            try {
              const fd = new FormData();
              fd.append('audio', blob, 'rec.webm');
              const resp = await fetch(store.config.whisperEndpoint, { method: 'POST', body: fd });
              const data = await resp.json();
              const text = String(data.text || data.transcript || data.result || '').trim();
              if (text) commitFinal(text);
            } catch (err) {
              setError('whisper', 'Whisper 转写失败：' + (err && err.message || err));
              return;
            }
          }
          if (store.status === 'listening' && !userStopped) {
            try { mr.start(4000); } catch (e) { /* ignore */ }
          }
        };
        whisperState = { mr, stream };
        mr.start(4000); // 每 4 秒一段上传转写，支持长段连续口述
      } catch (e) {
        setError('not-allowed', '无法访问麦克风：' + (e && e.message || e) + '。请检查浏览器权限设置。');
      }
    }

    // ============================================================ 能力检测
    function detect() {
      store.supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      store.secure = window.isSecureContext === true;
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices()
          .then((devs) => { store.hasMic = devs.some((d) => d.kind === 'audioinput'); emit(); })
          .catch(() => { store.hasMic = null; emit(); });
      }
    }

    // ============================================================ React 工具
    function useStore() {
      const [, setTick] = React.useState(0);
      React.useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
      return store;
    }

    // ============================================================ 麦克风按钮（conversation.input.right）
    function MicButton(props) {
      const s = useStore();
      const actions = props.inputActions;
      const draftRef = React.useRef((props.input && props.input.draft) || '');
      draftRef.current = (props.input && props.input.draft) || draftRef.current;

      React.useEffect(() => {
        if (!actions) return undefined;
        store.appendText = (text) => {
          try {
            // 同步预更新 draftRef：同一 tick 内多次追加基于“已写入的最新内容”继续拼接，
            // 避免等 React 重渲染的旧快照导致互相覆盖或重复
            const next = (draftRef.current || '') + text;
            draftRef.current = next;
            actions.setDraft(next);
          } catch (e) { /* ignore */ }
        };
        store.submitNow = () => {
          try { actions.submit(); } catch (e) { /* ignore */ }
        };
        return () => {
          if (store.submitNow) store.submitNow = null;
          if (store.appendText) store.appendText = null;
          // 会话切换 / 重渲染卸载时：不留识别状态
          if (store.status === 'listening') stopRecognition();
        };
      }, [actions]);

      const listening = s.status === 'listening';
      const errored = s.status === 'error';
      const cls = 'vip-mic' + (listening ? ' listening' : '') + (errored ? ' error' : '');
      const title = listening ? '停止语音输入' : (errored ? '语音输入出错' : '语音输入');

      return React.createElement('button', {
        className: cls,
        title,
        type: 'button',
        'aria-label': '语音输入',
        disabled: !s.supported,
        onClick: () => { if (listening) stopRecognition(); else startRecognition(); },
      },
        React.createElement('svg', {
          className: 'vip-mic-icon', viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true',
        },
          React.createElement('path', { d: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z' }),
        ),
        listening ? React.createElement('span', { className: 'vip-mic-count' }, s.finalCount) : null
      );
    }

    // ============================================================ 实时预览条（conversation.composer.dock）
    function PreviewBar(props) {
      const s = useStore();
      if (s.status === 'idle') return null;
      const cls = 'vip-preview' + (s.status === 'listening' ? ' listening' : ' error');
      const text = s.status === 'listening'
        ? (s.interim || (s.errorText ? s.errorText : '正在聆听…'))
        : (s.errorText || '语音输入已停止');
      return React.createElement('div', { className: cls, role: 'status' },
        React.createElement('span', { className: 'vip-preview-dot' }),
        React.createElement('span', { className: 'vip-preview-text' }, text),
        s.status === 'listening'
          ? React.createElement('span', { className: 'vip-preview-count' }, '已识别 ' + s.finalCount + ' 字')
          : null
      );
    }

    // ============================================================ 配置页（settings.section）
    function SettingsPage(props) {
      const s = useStore();
      const update = (patch) => { Object.assign(store.config, patch); emit(); };
      const row = (label, control, hint) => React.createElement('div', { className: 'vip-set-row' },
        React.createElement('label', { className: 'vip-set-label' }, label),
        control,
        hint ? React.createElement('div', { className: 'vip-set-hint' }, hint) : null
      );
      return React.createElement('div', { className: 'vip-settings' },
        React.createElement('h3', null, '语音输入设置'),
        row('识别语言',
          React.createElement('input', {
            type: 'text', value: s.config.language,
            onChange: (e) => update({ language: e.target.value }),
          }),
          '如 zh-CN（普通话）/ en-US / yue-Hant-HK（粤语）等'),
        row('说完即发',
          React.createElement('input', {
            type: 'checkbox', checked: s.config.autoSend,
            onChange: (e) => update({ autoSend: e.target.checked }),
          }),
          '识别停止后自动发送（默认关闭：先核对、可编辑，再手动发送）'),
        row('自动补标点',
          React.createElement('input', {
            type: 'checkbox', checked: s.config.punctuation,
            onChange: (e) => update({ punctuation: e.target.checked }),
          }),
          '按句补全中文标点（。！？）'),
        row('意外中断自动重连',
          React.createElement('input', {
            type: 'checkbox', checked: s.config.autoRestart,
            onChange: (e) => update({ autoRestart: e.target.checked }),
          }),
          '识别器意外结束时自动重启一次'),
        row('增强档：Whisper 端点',
          React.createElement('input', {
            type: 'text', value: s.config.whisperEndpoint,
            placeholder: 'http://127.0.0.1:9000/transcribe',
            onChange: (e) => update({ whisperEndpoint: e.target.value }),
          }),
          '留空 = 浏览器内置识别（不录制、不上传音频）；填了才启用本地 Whisper 转写'),
        React.createElement('div', { className: 'vip-cap' },
          '能力检测：SpeechRecognition ' + (s.supported ? '✔ 支持' : '✘ 不支持（请用 Chrome/Edge）') +
          ' · 安全上下文 ' + (s.secure ? '✔' : '✘ 需 https 或 localhost') +
          ' · 麦克风 ' + (s.hasMic === null ? '检测中…' : (s.hasMic ? '✔ 可用' : '✘ 未找到')))
      );
    }

    // ============================================================ 注册
    detect();

    const slots = ctx.get('slots');
    if (!slots) return;

    slots.inject('conversation.input.right', () => slots.register(
      { name: 'conversation.input.right', id: 'voice-input-mic', order: 90, label: '语音输入' },
      (props) => React.createElement(MicButton, props),
    ));

    slots.inject('conversation.composer.dock', () => slots.register(
      { name: 'conversation.composer.dock', id: 'voice-input-preview', order: 90, label: '语音输入预览' },
      (props) => React.createElement(PreviewBar, props),
    ));

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'voice-input', order: 30, label: '语音输入' },
      (props) => React.createElement(SettingsPage, props),
    ));

    styles.insert(
      '.vip-mic{display:inline-flex;align-items:center;justify-content:center;gap:2px;width:30px;height:30px;padding:0;border:none;border-radius:8px;background:rgba(9,105,217,.08);color:#0969da;cursor:pointer;transition:background .2s,transform .2s;flex:none}' +
      '.vip-mic:hover{background:rgba(9,105,217,.16)}' +
      '.vip-mic:disabled{opacity:.4;cursor:not-allowed}' +
      '.vip-mic.listening{background:rgba(248,81,73,.12);color:#f85149;animation:vip-pulse 1.2s ease-in-out infinite}' +
      '.vip-mic.error{background:rgba(191,153,0,.15);color:#bf8700}' +
      '.vip-mic-icon{fill:currentColor;display:block}' +
      '.vip-mic-count{font-size:10px;font-weight:600;font-variant-numeric:tabular-nums}' +
      '@keyframes vip-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}' +
      '.vip-preview{display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;background:rgba(0,0,0,.05);color:#8b949e;font-size:13px;min-height:26px;margin-top:6px}' +
      '.vip-preview-dot{width:8px;height:8px;border-radius:50%;background:#f85149;flex:none;animation:vip-blink 1s ease-in-out infinite}' +
      '.vip-preview.error .vip-preview-dot{background:#bf8700;animation:none}' +
      '.vip-preview-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.vip-preview-count{margin-left:auto;flex:none;font-variant-numeric:tabular-nums}' +
      '@keyframes vip-blink{0%,100%{opacity:1}50%{opacity:.35}}' +
      '.vip-settings{display:flex;flex-direction:column;gap:14px;padding:4px 0}' +
      '.vip-set-row{display:flex;flex-direction:column;gap:4px}' +
      '.vip-set-label{font-size:13px;font-weight:600;color:#24292f}' +
      '.vip-set-row input[type=text]{width:100%;max-width:360px;padding:6px 10px;border:1px solid #d0d7de;border-radius:6px;font-size:13px;background:#fff;color:#24292f}' +
      '.vip-set-row input[type=checkbox]{width:16px;height:16px;accent-color:#0969da}' +
      '.vip-set-hint{font-size:12px;color:#8b949e}' +
      '.vip-cap{font-size:12px;color:#57606a;background:rgba(0,0,0,.04);border-radius:8px;padding:8px 12px;line-height:1.6}'
    );

    // 卸载 / 禁用时完全清理：停止识别、释放麦克风、清空订阅
    ctx.effect(() => () => {
      userStopped = true;
      stopRecInner();
      store.appendText = null;
      store.submitNow = null;
      store.listeners.clear();
    });
  }
};
