const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, session } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { WINDOW_CONFIG, IPC_CHANNELS } = require('../shared/constants');
const { AIEngine } = require('./ai-engine');
const { SystemControl } = require('./system-control');
const { TTSServer } = require('./tts-server');
const { STTServer } = require('./stt-server');

let mainWindow = null;
let tray = null;
let aiEngine = null;
let systemControl = null;
let ttsServer = null;
let sttServer = null;
let isAlwaysOnTop = true;
const USER_DATA_DIR = path.join(__dirname, '..', '..', '.electron-user-data');

try {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  app.setPath('userData', USER_DATA_DIR);
  app.commandLine.appendSwitch('disk-cache-dir', path.join(USER_DATA_DIR, 'Cache'));
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('in-process-gpu');
  app.disableHardwareAcceleration();
} catch (error) {
  console.warn('[MAIN] Failed to configure local Electron userData:', error.message);
}

const settingsStore = new Store();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_CONFIG.WIDTH,
    height: WINDOW_CONFIG.HEIGHT,
    minWidth: WINDOW_CONFIG.MIN_WIDTH,
    minHeight: WINDOW_CONFIG.MIN_HEIGHT,
    transparent: true,
    frame: false,
    alwaysOnTop: isAlwaysOnTop,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'lain', 'idle.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 设置窗口位置（右下角）
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  mainWindow.setPosition(screenW - WINDOW_CONFIG.WIDTH - 20, screenH - WINDOW_CONFIG.HEIGHT - 20);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 开发模式下不再自动打开独立的 DevTools 窗口（避免像打开了浏览器页面）
  if (process.argv.includes('--dev')) {
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'lain', 'idle.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏 玲音',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
    },
    {
      label: '置顶切换',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: (menuItem) => {
        isAlwaysOnTop = menuItem.checked;
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(isAlwaysOnTop);
        }
      },
    },
    { type: 'separator' },
    {
      label: '开发者工具',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.toggleDevTools();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('玲音 — 桌面助手');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

function setupMediaPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });
}


function checkHermesHealth(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8642/health', { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function setupIPC() {
  // 窗口控制
  ipcMain.on(IPC_CHANNELS.WIN_MINIMIZE, () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on(IPC_CHANNELS.WIN_CLOSE, () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on(IPC_CHANNELS.WIN_TOGGLE_TOP, () => {
    isAlwaysOnTop = !isAlwaysOnTop;
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    }
  });

  // AI 对话
  ipcMain.on(IPC_CHANNELS.AI_SEND_MESSAGE, async (event, message) => {
    try {
      await aiEngine.sendMessage(message, (chunk) => {
        event.reply(IPC_CHANNELS.AI_STREAM_CHUNK, chunk);
      });
      event.reply(IPC_CHANNELS.AI_STREAM_END);
    } catch (error) {
      event.reply(IPC_CHANNELS.AI_STREAM_ERROR, error.message);
    }
  });

  // AI 停止生成
  ipcMain.on(IPC_CHANNELS.AI_STOP, () => {
    if (aiEngine) aiEngine.abort();
  });
  ipcMain.handle(IPC_CHANNELS.AI_GET_BACKEND, async () => {
    return aiEngine ? aiEngine.getBackendStatus() : { backend: 'mimo', ready: false, processing: false };
  });

  ipcMain.handle(IPC_CHANNELS.AI_SET_BACKEND, async (event, backend) => {
    const normalized = String(backend || '').trim().toLowerCase();
    if (!['mimo', 'deepseek', 'hermes'].includes(normalized)) {
      return { success: false, error: 'Invalid backend. Use MiMo, DeepSeek, or Hermes.' };
    }

    if (normalized === 'hermes') {
      const hermesReady = await checkHermesHealth();
      if (!hermesReady) {
        return {
          success: false,
          backend: aiEngine?.backendName || 'mimo',
          error: 'Hermes 未运行。请先启动 gateway。',
          command: "wsl -d Ubuntu -- bash -lc 'export HERMES_HOME=/mnt/e/PROJRCT/Lain-DesktopAssistant/.local/hermes/home; export PATH=/root/.local/bin:/root/.hermes/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; cd /mnt/e/PROJRCT/Lain-DesktopAssistant; hermes gateway run --accept-hooks'",
        };
      }
    }

    try {
      const status = await aiEngine.updateBackend(normalized);
      return { success: true, ...status };
    } catch (error) {
      return { success: false, backend: aiEngine?.backendName || 'mimo', error: error.message };
    }
  });

  // 系统控制
  ipcMain.handle(IPC_CHANNELS.SYS_EXECUTE, async (event, command) => {
    return await systemControl.execute(command);
  });

  // 确认对话框响应
  ipcMain.on(IPC_CHANNELS.SYS_CONFIRM_RESPONSE, (event, { id, confirmed }) => {
    systemControl.resolveConfirmation(id, confirmed);
  });

  // TTS 语音合成
  ipcMain.handle(IPC_CHANNELS.TTS_SYNTHESIZE, async (event, text, lang) => {
    if (!ttsServer || !ttsServer.isReady) {
      return { success: false, error: 'TTS 服务未就绪' };
    }
    try {
      const audioBuffer = await ttsServer.synthesize(text, lang || 'auto');
      if (audioBuffer) {
        // 返回 base64 编码的 WAV 数据
        return { success: true, audio: audioBuffer.toString('base64'), format: 'wav' };
      }
      return { success: false, error: '合成失败' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TTS_START, async () => {
    if (!ttsServer) ttsServer = new TTSServer();
    const ok = await ttsServer.start();
    return { success: ok };
  });

  ipcMain.handle(IPC_CHANNELS.TTS_STOP, async () => {
    if (ttsServer) ttsServer.stop();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.TTS_STATUS, async () => {
    return ttsServer ? ttsServer.getStatus() : { running: false, ready: false };
  });

  // STT 语音识别
  ipcMain.handle(IPC_CHANNELS.STT_TRANSCRIBE, async (event, audioData) => {
    if (!sttServer || !sttServer.isReady) {
      return { success: false, error: 'STT 服务未就绪' };
    }
    try {
      const audioBuffer = Buffer.from(audioData);
      const text = await sttServer.transcribe(audioBuffer);
      if (text) {
        return { success: true, text };
      }
      return { success: false, error: '未识别到语音' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STT_STATUS, async () => {
    return sttServer ? sttServer.getStatus() : { running: false, ready: false };
  });

  // 设置
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (event, key) => {
    return settingsStore.get(key);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (event, key, value) => {
    settingsStore.set(key, value);
  });
}

function registerShortcuts() {
  // Ctrl+Shift+L 唤出/隐藏窗口
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// 应用启动
app.whenReady().then(async () => {
  systemControl = new SystemControl(path.join(__dirname, '..', '..'));

  setupMediaPermissions();
  createWindow();
  createTray();

  // AIEngine needs systemControl and mainWindow
  settingsStore.set('agentBackend', 'mimo');
  aiEngine = new AIEngine(systemControl, mainWindow);

  setupIPC();
  registerShortcuts();

  // 启动 TTS 服务（后台异步，不阻塞主窗口）
  ttsServer = new TTSServer();
  ttsServer.start().then((ok) => {
    if (ok) {
      console.log('[MAIN] GPT-SoVITS TTS server started successfully');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tts:ready');
      }
    } else {
      console.warn('[MAIN] GPT-SoVITS TTS server failed to start; browser TTS fallback disabled');
    }
  });

  // 启动 STT 服务（后台异步，不阻塞主窗口）
  sttServer = new STTServer();
  sttServer.start().then((ok) => {
    if (ok) {
      console.log('[MAIN] Whisper STT server started successfully');
    } else {
      console.warn('[MAIN] Whisper STT server failed to start, using keyboard input only');
    }
  });
});

app.on('window-all-closed', () => {
  // 不退出，保持托盘运行
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // 停止 TTS 服务
  if (ttsServer) {
    ttsServer.stop();
  }
  // 停止 STT 服务
  if (sttServer) {
    sttServer.stop();
  }
});
