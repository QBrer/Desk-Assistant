/**
 * 主应用逻辑
 * 初始化所有模块并协调交互
 */

// 等待 DOM 加载
document.addEventListener('DOMContentLoaded', () => {
  console.log('[LAIN] System initializing...');

  // 初始化特效
  window.cyberEffects = new CyberEffects();
  console.log('[LAIN] Cyber effects: OK');

  // 初始化角色控制器
  window.character = new CharacterController();
  console.log('[LAIN] Character controller: OK');

  // 初始化对话管理器
  window.chatManager = new ChatManager();
  console.log('[LAIN] Chat manager: OK');

  // 设置窗口控制
  setupWindowControls();

  // 聚焦输入框
  const input = document.getElementById('chat-input');
  if (input) {
    setTimeout(() => input.focus(), 500);
  }

  console.log('[LAIN] All systems online. Connected to the Wired.');
});

/**
 * 设置窗口控制按钮
 */
function setupWindowControls() {
  const btnMinimize = document.getElementById('btn-minimize');
  const btnClose = document.getElementById('btn-close');
  const btnPin = document.getElementById('btn-pin');

  btnMinimize?.addEventListener('click', () => {
    if (window.electronAPI) {
      window.electronAPI.minimize();
    }
  });

  btnClose?.addEventListener('click', () => {
    if (window.electronAPI) {
      window.electronAPI.close();
    }
  });

  btnPin?.addEventListener('click', () => {
    if (window.electronAPI) {
      window.electronAPI.toggleAlwaysOnTop();
    }
    // 视觉反馈
    btnPin.classList.toggle('active');
    btnPin.style.color = btnPin.classList.contains('active')
      ? 'var(--neon-green)'
      : 'var(--text-secondary)';
  });
}
