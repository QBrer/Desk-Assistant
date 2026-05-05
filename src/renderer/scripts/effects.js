/**
 * 赛博朋克视觉特效
 */
class CyberEffects {
  constructor() {
    this.canvas = document.getElementById('matrix-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.columns = [];
    this.animationId = null;

    if (this.ctx) {
      this._initMatrix();
      this._startMatrix();
    }

    this._startRandomGlitch();
    this._startDataStreams();
  }

  /**
   * 初始化矩阵数字雨
   */
  _initMatrix() {
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());

    const chars = 'アイウエオカキクケコサシスセソタチツテト0123456789LAIN';
    this.matrixChars = chars.split('');
    this.fontSize = 12;
  }

  _resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;

    const columnCount = Math.floor(this.canvas.width / 12);
    this.columns = Array(columnCount).fill(0).map(() =>
      Math.floor(Math.random() * this.canvas.height / 12)
    );
  }

  _startMatrix() {
    const draw = () => {
      if (!this.ctx) return;

      this.ctx.fillStyle = 'rgba(8, 8, 12, 0.08)';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      this.ctx.fillStyle = '#00ff41';
      this.ctx.font = `${this.fontSize}px "Share Tech Mono", monospace`;

      for (let i = 0; i < this.columns.length; i++) {
        const char = this.matrixChars[Math.floor(Math.random() * this.matrixChars.length)];
        const x = i * this.fontSize;
        const y = this.columns[i] * this.fontSize;

        this.ctx.globalAlpha = 0.3 + Math.random() * 0.5;
        this.ctx.fillText(char, x, y);

        if (y > this.canvas.height && Math.random() > 0.98) {
          this.columns[i] = 0;
        }
        this.columns[i]++;
      }

      this.animationId = requestAnimationFrame(draw);
    };

    draw();
  }

  /**
   * 随机全局 Glitch 效果
   */
  _startRandomGlitch() {
    const triggerGlitch = () => {
      const appContainer = document.querySelector('.app-container');
      if (appContainer && Math.random() > 0.7) {
        appContainer.classList.add('glitch-active');
        setTimeout(() => {
          appContainer.classList.remove('glitch-active');
        }, 200);
      }

      // 随机间隔 5-15 秒
      const nextDelay = 5000 + Math.random() * 10000;
      setTimeout(triggerGlitch, nextDelay);
    };

    setTimeout(triggerGlitch, 8000);
  }

  /**
   * 数据流效果
   */
  _startDataStreams() {
    const charSection = document.getElementById('character-section');
    if (!charSection) return;

    const createStream = () => {
      const stream = document.createElement('div');
      stream.className = 'data-stream';

      const snippets = [
        '0xFFD8..OK', 'SYN_ACK', 'LAYER7::CONNECTED',
        'tcp://wired', 'PKT_RCV', '...LAIN...',
        'NEURAL_LINK', 'DATA_FLOW', '//PRESENT',
        'sys.wake()', 'SIGNAL:OK', 'ENCRYPT:AES256',
      ];

      stream.textContent = snippets[Math.floor(Math.random() * snippets.length)];
      stream.style.left = `${10 + Math.random() * 80}%`;
      stream.style.bottom = '10%';
      stream.style.animation = `dataStreamFlow ${2 + Math.random() * 3}s ease-out forwards`;

      charSection.appendChild(stream);

      setTimeout(() => stream.remove(), 5000);
    };

    setInterval(createStream, 3000 + Math.random() * 4000);
  }

  /**
   * 创建脉冲波纹
   */
  createPulse(x, y) {
    const pulse = document.createElement('div');
    pulse.className = 'pulse-ring';
    pulse.style.left = `${x}px`;
    pulse.style.top = `${y}px`;

    document.querySelector('.app-container')?.appendChild(pulse);
    setTimeout(() => pulse.remove(), 2000);
  }

  /**
   * 创建粒子
   */
  createParticles(x, y, count = 5) {
    const container = document.querySelector('.app-container');
    if (!container) return;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = `${x + (Math.random() - 0.5) * 30}px`;
      particle.style.top = `${y}px`;
      particle.style.background = Math.random() > 0.5 ? 'var(--neon-green)' : 'var(--neon-cyan)';
      particle.style.animation = `particleFloat ${1 + Math.random() * 2}s ease-out forwards`;

      container.appendChild(particle);
      setTimeout(() => particle.remove(), 3000);
    }
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
  }
}

// 全局实例
window.CyberEffects = CyberEffects;
