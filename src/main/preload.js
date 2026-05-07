const { contextBridge, ipcRenderer } = require('electron');
const { IPC_CHANNELS } = require('../shared/constants');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.send(IPC_CHANNELS.WIN_MINIMIZE),
  close: () => ipcRenderer.send(IPC_CHANNELS.WIN_CLOSE),
  toggleAlwaysOnTop: () => ipcRenderer.send(IPC_CHANNELS.WIN_TOGGLE_TOP),

  // AI 对话
  sendMessage: (message) => ipcRenderer.send(IPC_CHANNELS.AI_SEND_MESSAGE, message),
  onStreamChunk: (callback) => ipcRenderer.on(IPC_CHANNELS.AI_STREAM_CHUNK, (_, chunk) => callback(chunk)),
  onStreamEnd: (callback) => ipcRenderer.on(IPC_CHANNELS.AI_STREAM_END, () => callback()),
  onStreamError: (callback) => ipcRenderer.on(IPC_CHANNELS.AI_STREAM_ERROR, (_, error) => callback(error)),

  // 系统控制
  executeCommand: (command) => ipcRenderer.invoke(IPC_CHANNELS.SYS_EXECUTE, command),

  // 确认对话框
  onConfirmRequest: (callback) => ipcRenderer.on(IPC_CHANNELS.SYS_CONFIRM, (_, data) => callback(data)),
  sendConfirmResponse: (id, confirmed) => ipcRenderer.send(IPC_CHANNELS.SYS_CONFIRM_RESPONSE, { id, confirmed }),

  // TTS 语音合成 (GPT-SoVITS)
  ttsSynthesize: (text, lang) => ipcRenderer.invoke(IPC_CHANNELS.TTS_SYNTHESIZE, text, lang),
  ttsStart: () => ipcRenderer.invoke(IPC_CHANNELS.TTS_START),
  ttsStop: () => ipcRenderer.invoke(IPC_CHANNELS.TTS_STOP),
  ttsStatus: () => ipcRenderer.invoke(IPC_CHANNELS.TTS_STATUS),
  onTTSReady: (callback) => ipcRenderer.on('tts:ready', () => callback()),

  // STT 语音识别 (faster-whisper)
  sttTranscribe: (audioData) => ipcRenderer.invoke(IPC_CHANNELS.STT_TRANSCRIBE, audioData),
  sttStatus: () => ipcRenderer.invoke(IPC_CHANNELS.STT_STATUS),

  // 设置
  getSetting: (key) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
  setSetting: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
});
