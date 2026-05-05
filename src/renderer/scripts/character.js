/**
 * 角色控制器
 * 管理玲音的状态、动画和交互
 */
class CharacterController {
  constructor() {
    this.img = document.getElementById('character-img');
    this.glitchOverlay = document.getElementById('glitch-overlay');
    this.statusText = document.getElementById('char-status-text');
    this.container = document.getElementById('character-container');
    this.section = document.getElementById('character-section');

    this.currentState = 'idle';
    this.images = {
      idle: 'assets/lain/idle.png',
      talking: 'assets/lain/talking.png',
      thinking: 'assets/lain/thinking.png',
    };

    // 预加载图片
    Object.values(this.images).forEach(src => {
      const img = new Image();
      img.src = src;
    });

    this._setupInteractions();
    this._startRandomGlitch();
  }

  /**
   * 设置交互
   */
  _setupInteractions() {
    // 点击角色触发 glitch
    if (this.section) {
      this.section.addEventListener('click', (e) => {
        this.triggerGlitch();
        // 创建粒子效果
        if (window.cyberEffects) {
          const rect = this.section.getBoundingClientRect();
          window.cyberEffects.createParticles(
            e.clientX - rect.left,
            e.clientY - rect.top,
            8
          );
        }
      });

      // 鼠标跟踪 — 角色微微偏移
      this.section.addEventListener('mousemove', (e) => {
        if (!this.img) return;
        const rect = this.section.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const deltaX = (e.clientX - rect.left - centerX) / centerX;
        const deltaY = (e.clientY - rect.top - centerY) / centerY;

        // 微妙的偏移
        const offsetX = deltaX * 3;
        const offsetY = deltaY * 2;

        this.img.style.marginLeft = `${offsetX}px`;
        this.img.style.marginTop = `${offsetY}px`;
      });

      this.section.addEventListener('mouseleave', () => {
        if (this.img) {
          this.img.style.marginLeft = '0px';
          this.img.style.marginTop = '0px';
        }
      });
    }
  }

  /**
   * 切换角色状态
   */
  setState(state) {
    if (this.currentState === state) return;
    this.currentState = state;

    if (this.img) {
      // 移除所有状态类
      this.img.classList.remove('idle', 'talking', 'thinking', 'error');
      this.img.classList.add(state);

      // 切换图片
      if (this.images[state]) {
        this.img.src = this.images[state];
      }
    }

    // 更新状态文字
    if (this.statusText) {
      const statusMap = {
        idle: 'CONNECTED',
        talking: 'TRANSMITTING',
        thinking: 'PROCESSING',
        error: 'ERROR',
      };
      this.statusText.textContent = statusMap[state] || state.toUpperCase();
    }
  }

  /**
   * 触发 Glitch 效果
   */
  triggerGlitch() {
    if (this.glitchOverlay) {
      this.glitchOverlay.classList.remove('active');
      // 强制重排以重新触发动画
      void this.glitchOverlay.offsetWidth;
      this.glitchOverlay.classList.add('active');

      setTimeout(() => {
        this.glitchOverlay.classList.remove('active');
      }, 200);
    }
  }

  /**
   * 随机 Glitch
   */
  _startRandomGlitch() {
    const randomGlitch = () => {
      if (Math.random() > 0.6) {
        this.triggerGlitch();
      }
      setTimeout(randomGlitch, 8000 + Math.random() * 15000);
    };
    setTimeout(randomGlitch, 10000);
  }
}

window.CharacterController = CharacterController;
