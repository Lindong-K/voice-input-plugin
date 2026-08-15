# Voice Input · 语音输入插件

A **browser-side speech-to-text plugin** for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh)
chat interface: click the mic, speak, and the transcript lands in the message box — no more typing
long messages.

Everything happens **in your browser**: microphone permission, recording, recognition, and writing
into the input box. No server relay, no audio upload (unless you explicitly configure the optional
Whisper endpoint).

---

## ✨ Features

- A mic button injected right next to the send button (≤ 30px, rounded, tooltip "语音输入").
- Click to start listening: button turns red with a pulse animation, live **interim results** and a
  recognized-character counter appear in a preview strip under the composer.
- Click again to stop: the final text is **appended to the end of the input box** (existing content
  kept, fully editable, input refocused). No auto-send unless you enable it.
- **Continuous dictation** (Web Speech API `continuous` + `interimResults`) — long monologues keep
  committing sentence by sentence, no 60s limit.
- **Cancel anytime** (web-native, benchmarked against WeChat): while listening, a **「✕ 取消」
  button** appears in the preview strip and **Esc** discards the current session — including an
  automatic **rollback** of the text this session already appended.
- **Smart punctuation**: questions end with「？」, exclamations with「！」, otherwise「。」.
- Optional **hold-to-talk** mode (touch/trackpad style: press and hold to record, release to
  commit, slide up to cancel) — default stays click-to-toggle for desktop.
- Full error handling: permission denied → guidance; no-speech → one auto retry; service
  unavailable; no microphone; unexpected end → one auto-restart.
- Survives re-renders / session switches; unloading removes the button, stops recognition and
  releases the microphone.
- Optional **enhanced tier**: fill a local Whisper endpoint and it switches to
  `MediaRecorder` → chunked upload → transcription.

## ⚙️ Configuration (Settings → 语音输入)

| Option | Default | Meaning |
|---|---|---|
| `language` | `zh-CN` | recognition language (`en-US`, `yue-Hant-HK`, …) |
| `inputMode` | `toggle` | `toggle` = click to start/stop (desktop default); `hold` = hold-to-talk (touch/trackpad) |
| `autoSend` | `false` | send automatically after listening stops (default off: review first) |
| `punctuation` | `true` | smart punctuation: `？` for questions, `！` for exclamations, else `。` |
| `autoRestart` | `true` | restart once when recognition ends unexpectedly |
| `whisperEndpoint` | *(empty)* | leave empty = browser built-in recognition (no audio leaves the browser); fill to enable local Whisper upload |

## 🔌 Installation (DeepSeek Harness)

This is the **Client half** of a dynamic Cordis plugin. Define it with your harness
plugin tooling (plain JavaScript, React via `React.createElement`, no JSX), register the three
slots, and approve the client package when prompted.

```js
// code.client = the contents of client.js
```

Slot usage (official catalog seats):

| Slot | Purpose |
|---|---|
| `conversation.input.right` | mic button (before the send button) |
| `conversation.composer.dock` | live interim preview strip |
| `settings.section` | "语音输入" settings page |

Requires a **secure context** (`https` or `localhost`, e.g. `http://127.0.0.1:3080`) and
Chrome/Edge (Web Speech API). On unsupported browsers the button is disabled and the settings page
shows a capability report.

## 🔒 Privacy

- Default path uses the browser's built-in speech recognition: **no recording, no saving, no
  upload**.
- Only when you configure `whisperEndpoint` does the plugin send 4-second audio chunks to that
  endpoint (your own local service).

## 📄 License

[MIT](LICENSE)

---

## 中文说明

为 DeepSeek Harness 聊天界面增加「点击说话 → 自动转文字」能力。**全部在浏览器端完成**：
麦克风权限、录音、识别、写入输入框；无服务端中转、不上传音频（除非显式配置增强档）。

### 功能

- 输入框右侧注入麦克风按钮（≤30px），点击变红 + 脉冲动画，实时中间结果与字数显示在输入框下方预览条
- 停止后最终文字**追加**到输入框末尾（保留已有内容、可编辑），默认不自动发送
- `continuous` 连续听写，长段口述逐句落定，不受 60 秒限制；识别中不劫持键盘
- 完整错误处理：权限拒绝指引 / 无语音自动重试 / 服务不可用 / 无麦克风 / 意外中断自动重连
- 卸载/禁用即清理：停止识别、释放麦克风、移除按钮与样式

### 配置（设置 → 语音输入）

`language`（默认 zh-CN）、`autoSend`（说完即发，默认关）、`punctuation`（自动补标点，默认开）、
`autoRestart`（意外中断自动重连，默认开）、`whisperEndpoint`（增强档，默认空 = 纯浏览器识别）。

### 浏览器兼容性

Chrome / Edge（`webkitSpeechRecognition`）；需安全上下文（https 或 localhost）。
不支持时按钮置灰，设置页显示能力检测报告。

### 隐私

默认方案**不录制、不保存、不上传音频**；只有填写 `whisperEndpoint` 后才会把 4 秒一段的
录音发送到你指定的本地端点。

### 文件

- `client.js` — 插件 Client 半区源码（识别引擎 + 三个 Slot 组件 + 配置页）
- `docs/语音输入插件·创造模式提示词.md` — 项目原始提示词（设计规范）
- `验证报告.md` — 能力检测 + 手动测试清单
