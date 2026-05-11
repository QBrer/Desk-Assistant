# Lain DesktopAssistant

Lain DesktopAssistant 是一个基于 Electron 的桌面 AI 智能体项目。它将小米 MiMo 大模型对话、本地 GPT-SoVITS 音色、语音识别、桌面工具调用和本地 Skill 工作区整合在一起，目标是做一个可以语音交互、读写工作区文件、执行辅助任务的桌面助手。
<img src="image.png" style="zoom:80%;" />
> 注意：项目不会在 README 中保存任何真实 API Key。请把密钥放在本地 `.env` 文件中，并确保 `.env` 不提交到仓库。

## 功能特性

- 桌面悬浮助手：Electron 窗口、置顶、托盘、快捷键和基础窗口控制。
- AI 对话：默认使用小米 MiMo Token Plan 兼容 OpenAI API 的 `mimo-v2.5-pro` 模型。
- 工具调用：支持系统信息、应用打开/关闭、URL 打开、工作区文件读写、目录搜索、Python 脚本执行等能力。
- 语音识别：支持两种 STT Provider。
  - `local`：本地 faster-whisper，离线可用，但会占用更多本机内存。
  - `mimo`：小米 MiMo 云端音频识别/转写，降低本地资源占用，依赖网络和 API 可用性。
- 语音合成：通过本地 GPT-SoVITS API 加载 Lain 音色模型并合成语音。
- TTS 预取：回复生成过程中会尽早切分文本并预合成后续语句，减少“回复完很久才开始读”的等待感。
- Skill 系统：可扫描 `lain_workspace/*/SKILL.md`，让智能体读取并使用本地 Skill 指令和脚本。
- 安全边界：写入、删除等高风险操作限制在项目工作区内，删除文件需要确认。

## 技术栈

- Electron 33
- Node.js / npm
- OpenAI SDK 兼容接口
- 小米 MiMo API
- faster-whisper / ctranslate2
- GPT-SoVITS
- PowerShell / Python 工具调用

## 项目结构

```text
Lain-DesktopAssistant/
├─ src/
│  ├─ main/                  # Electron 主进程、AI 引擎、工具、STT/TTS 服务
│  │  ├─ main.js
│  │  ├─ ai-engine.js
│  │  ├─ system-control.js
│  │  ├─ stt-server.js
│  │  ├─ tts-server.js
│  │  └─ preload.js
│  ├─ renderer/              # 前端界面、聊天、语音、角色状态
│  └─ shared/                # 共享常量和模型配置
├─ lain-voice-model/         # GPT-SoVITS、语音模型、参考音频、本地 STT API
├─ lain_workspace/           # 智能体可使用的本地工作区和 Skill
├─ requirements-voice.txt    # 本地语音识别依赖版本
├─ .env.example              # 环境变量示例
└─ package.json
```

## 环境要求

- Windows 10/11
- Node.js 与 npm
- Python 环境：当前代码默认使用 `E:/anconda/envs/py310/python.exe`
- 本地语音模型目录：`lain-voice-model/`
- GPT-SoVITS 模型文件：
  - `xxx-e15.ckpt`
  - `xxx_e16_s144_l32.pth`
- GPT-SoVITS 启动脚本：`lain-voice-model/start_api.py`
- 本地 STT 启动脚本：`lain-voice-model/stt_api.py`

如果你的 Python 路径不同，需要同步修改 `src/main/stt-server.js` 和 `src/main/tts-server.js` 中的 `PYTHON_EXE`。

## 安装

```powershell
npm install
```

如果需要使用本地 faster-whisper 语音识别，再安装 Python 依赖：

```powershell
E:\anconda\envs\py310\python.exe -m pip install -r requirements-voice.txt
```

`requirements-voice.txt` 中固定了 `ctranslate2==4.6.0`、`numpy<2`、`setuptools<71`，这是为了避开部分 Windows/Anaconda 环境下 faster-whisper 加载模型时的兼容性问题。

## 配置

复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`：

```env
XIAOMI_API_KEY=your_xiaomi_mimo_api_key

# local = faster-whisper，本地离线识别
# mimo = 小米 MiMo 云端音频识别/转写
LAIN_STT_PROVIDER=local
MIMO_ASR_MODEL=mimo-v2-omni
```

常用环境变量：

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `XIAOMI_API_KEY` | 小米 MiMo API Key | `your_xiaomi_mimo_api_key` |
| `LAIN_STT_PROVIDER` | 语音识别提供方 | `local` / `mimo` |
| `MIMO_ASR_MODEL` | MiMo 音频识别模型 | `mimo-v2-omni` |
| `LAIN_STT_MODEL` | faster-whisper 模型大小 | `small` |
| `LAIN_STT_DEVICE` | faster-whisper 推理设备 | `cpu` |
| `LAIN_STT_COMPUTE_TYPE` | faster-whisper 量化类型 | `int8` |
| `LAIN_STT_LOCAL_ONLY` | 是否只用本地模型缓存 | `1` |

## 运行

开发模式：

```powershell
npm run dev
```

普通启动：

```powershell
npm start
```

如果 Electron 被环境变量当成 Node 进程启动，可以先清掉变量：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

## 模型配置

AI 对话模型配置位于 `src/shared/constants.js`：

```js
AI_CONFIG: {
  BASE_URL: 'https://token-plan-cn.xiaomimimo.com/v1',
  MODEL: 'mimo-v2.5-pro',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
}
```

主进程通过 OpenAI SDK 的兼容接口调用 MiMo，因此只要服务端接口保持 OpenAI-compatible，模型和 Base URL 可以在这里替换。

## 语音识别

### 本地 faster-whisper

优点：

- 离线可用
- 不需要上传音频
- 识别链路稳定

代价：

- 首次加载模型较慢
- 占用本机内存
- CPU 模式下实时性取决于机器性能

启用方式：

```env
LAIN_STT_PROVIDER=local
```

### 小米 MiMo 云端识别

优点：

- 降低本地内存占用
- 不需要加载 faster-whisper 模型
- 适合轻量设备

代价：

- 依赖网络
- 依赖 API Key 和服务可用性
- 端到端延迟受上传和接口响应影响

启用方式：

```env
LAIN_STT_PROVIDER=mimo
MIMO_ASR_MODEL=mimo-v2-omni
```

## 语音合成

TTS 由 `src/main/tts-server.js` 管理。启动后会在本地运行 GPT-SoVITS API，默认地址：

```text
http://127.0.0.1:9880
```

默认加载：

- SoVITS 权重：`lain-voice-model/xxx_e16_s144_l32.pth`
- GPT 权重：`lain-voice-model/xxx-e15.ckpt`
- 参考音频：`lain-voice-model/rank_005_sim_0.993_clip_083_770.9s-774.1s.wav`

当前语音播放链路做了分句和预取：智能体回复生成到一定长度或遇到停顿符号时，会提前把片段送去 TTS 合成；播放当前句时，也会尽量预合成后续句子，减少句子之间的停顿。

## Skill 使用

把 Skill 放进 `lain_workspace` 下即可：

```text
lain_workspace/
└─ ppt-research-style/
   ├─ SKILL.md
   ├─ scripts/
   ├─ assets/
   └─ references/
```

智能体可以通过工具列出可用 Skill、读取 `SKILL.md`，再根据 Skill 指令运行工作区内脚本或处理文件。适合把固定工作流、PPT 风格分析、资料整理、文档处理等能力沉淀成可复用任务说明。

## 工作区与安全限制

- 普通文件读写建议放在 `lain_workspace/` 下。
- Python 脚本建议也放在 `lain_workspace/` 下，再由工具调用。
- 删除文件需要用户确认。
- `.env`、模型权重、缓存目录不应提交到远程仓库。

## 常见问题

### 1. 按钮点击没有反应

优先检查 DevTools 或终端日志，看 IPC 通道是否报错。窗口按钮通常依赖 `preload.js` 暴露的 API 和 `src/main/main.js` 注册的 IPC handler，两边通道名需要一致。

### 2. 语音识别慢或占内存

可以把 `.env` 中的 `LAIN_STT_PROVIDER` 改为 `mimo`，使用云端识别；如果继续使用本地 faster-whisper，可以尝试更小的模型、`cpu + int8`、或提前预热服务。

### 3. faster-whisper 启动崩溃

按项目当前环境，建议使用：

```text
ctranslate2==4.6.0
numpy>=1.26,<2
setuptools>=70,<71
```

直接执行：

```powershell
E:\anconda\envs\py310\python.exe -m pip install -r requirements-voice.txt
```

### 4. 回复生成了但迟迟不说话

TTS 首次启动需要加载 GPT-SoVITS 和权重，这是最慢的一次。后续如果仍然慢，重点看终端中的 `[TTS stderr]`、`[TTS stdout]` 和合成请求耗时。当前代码已经做了分句提前合成与预取，但本地模型推理速度仍受硬件影响。

### 5. Electron 运行时出现缓存或 GPU 日志

如果应用能正常打开，多数缓存/GPU 日志不是致命错误。项目会使用本地 `.electron-user-data` 作为 Electron 用户数据目录，避免污染系统默认目录。

## Git 提交建议

不要提交以下内容：

- `.env`
- `node_modules/`
- `.electron-user-data/`
- 大体积模型权重，例如 `*.ckpt`、`*.pth`
- 本地调试日志，例如 `debug.log`

## 免责声明

本项目是个人桌面智能体工程。项目中的角色设定、语音模型、参考音频和相关素材请确保拥有合法使用权限。本项目与《Serial Experiments Lain》官方无关联。