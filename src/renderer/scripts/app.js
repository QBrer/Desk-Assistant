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

  window.voiceManager = new VoiceManager(window.chatManager);
  console.log('[LAIN] Voice manager: OK');

  // 设置窗口控制
  setupWindowControls();
  // 复制对话按钮
  setupCopyButton();

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
function setupCopyButton() {
  const btn = document.getElementById('copy-btn');
  btn?.addEventListener('click', async () => {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const lines = [];
    const messages = container.querySelectorAll('.message-user, .message-lain');
    messages.forEach((msg) => {
      const textEl = msg.querySelector('.message-text');
      if (!textEl) return;
      const role = msg.classList.contains('message-user') ? '你' : '玲音';
      const text = textEl.textContent.trim();
      if (text) lines.push(`[${role}] ${text}`);
    });

    if (lines.length === 0) return;

    try {
      await navigator.clipboard.writeText(lines.join('\n\n'));
      const orig = btn.getAttribute('title');
      btn.setAttribute('title', '已复制!');
      btn.style.color = 'var(--neon-green)';
      setTimeout(() => {
        btn.setAttribute('title', orig);
        btn.style.color = '';
      }, 1500);
    } catch {
      // fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = lines.join('\n\n');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  });
}

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
