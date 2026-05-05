const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { WINDOW_CONFIG, IPC_CHANNELS } = require('../shared/constants');
const { AIEngine } = require('./ai-engine');
const { SystemControl } = require('./system-control');

let mainWindow = null;
let tray = null;
let aiEngine = null;
let systemControl = null;
let isAlwaysOnTop = true;
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

  // 系统控制
  ipcMain.handle(IPC_CHANNELS.SYS_EXECUTE, async (event, command) => {
    return await systemControl.execute(command);
  });

  // 确认对话框响应
  ipcMain.on(IPC_CHANNELS.SYS_CONFIRM_RESPONSE, (event, { id, confirmed }) => {
    systemControl.resolveConfirmation(id, confirmed);
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
app.whenReady().then(() => {
  systemControl = new SystemControl();

  createWindow();
  createTray();

  // AIEngine needs systemControl and mainWindow
  aiEngine = new AIEngine(systemControl, mainWindow);

  setupIPC();
  registerShortcuts();
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
});
