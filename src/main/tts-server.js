/**
 * GPT-SoVITS TTS 服务管理器
 * 负责启动、监控、关闭本地 Python TTS API 服务，
 * 并为 Electron 渲染进程提供 TTS 合成代理。
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');

const PYTHON_EXE = 'E:/anconda/envs/py310/python.exe';
const TTS_PORT = 9880;
const TTS_HOST = '127.0.0.1';
const TTS_BASE_URL = `http://${TTS_HOST}:${TTS_PORT}`;
const HEALTH_CHECK_INTERVAL = 5000;   // 每 5 秒检测一次
const STARTUP_TIMEOUT = 120000;        // 最多等 120 秒启动

// 参考音频配置 — 使用训练时排名最高的参考音频
const MODEL_DIR = path.join(__dirname, '..', '..', 'lain-voice-model');

// 两个参考音频及其对应文本（文本必须与音频内容一致）
const REF_OPTIONS = {
  rank_005: {
    audio: path.join(MODEL_DIR, 'rank_005_sim_0.993_clip_083_770.9s-774.1s.wav'),
    text: '誰も彼もが味方だと思ってしまっただけ',
  },
  rank_049: {
    audio: path.join(MODEL_DIR, 'rank_049_sim_0.961_clip_121_928.6s-932.7s.wav'),
    text: 'レインは人なんかじゃなかったんだね',
  },
};
const DEFAULT_REF = 'rank_005'; // sim 0.993，效果最好

class TTSServer {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.isStarting = false;
    this._healthTimer = null;
    this._readyPromise = null;
  }

  /**
   * 启动 GPT-SoVITS API 服务
   * @returns {Promise<boolean>} 是否启动成功
   */
  async start() {
    if (this.isReady) return true;
    if (this.isStarting) return this._readyPromise;

    this.isStarting = true;

    // 检查模型文件是否存在
    const startScript = path.join(MODEL_DIR, 'start_api.py');
    if (!fs.existsSync(startScript)) {
      console.error('[TTS] start_api.py not found:', startScript);
      this.isStarting = false;
      return false;
    }

    this._readyPromise = new Promise((resolve) => {
      console.log('[TTS] Starting GPT-SoVITS server...');

      this.process = spawn(PYTHON_EXE, [
        startScript,
        String(TTS_PORT),
        TTS_HOST,
      ], {
        cwd: MODEL_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        windowsHide: true,
      });

      // 日志
      this.process.stdout?.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[TTS stdout] ${msg}`);
      });

      this.process.stderr?.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[TTS stderr] ${msg}`);
      });

      this.process.on('error', (err) => {
        console.error('[TTS] Process error:', err.message);
        this.isReady = false;
        this.isStarting = false;
        resolve(false);
      });

      this.process.on('exit', (code) => {
        console.log(`[TTS] Process exited with code ${code}`);
        this.isReady = false;
        this.isStarting = false;
        this._stopHealthCheck();
      });

      // 轮询等待服务就绪
      const startTime = Date.now();
      const pollReady = () => {
        if (Date.now() - startTime > STARTUP_TIMEOUT) {
          console.error('[TTS] Server startup timed out');
          this.isStarting = false;
          resolve(false);
          return;
        }

        this._healthPing()
          .then((ok) => {
            if (ok) {
              console.log('[TTS] Server is responding, loading model weights...');
              this.isStarting = false;
              this._startHealthCheck();
              // 加载模型权重，成功才标记 ready
              this._loadModelWeights()
                .then(() => {
                  this.isReady = true;
                  console.log('[TTS] Server is ready!');
                  resolve(true);
                })
                .catch((err) => {
                  console.error('[TTS] Model weights failed to load:', err.message);
                  this.isReady = false;
                  resolve(false);
                });
            } else {
              setTimeout(pollReady, 3000);
            }
          })
          .catch(() => setTimeout(pollReady, 3000));
      };

      // 给进程 5 秒的启动时间再开始轮询
      setTimeout(pollReady, 5000);
    });

    return this._readyPromise;
  }

  /**
   * 加载 Lain 的模型权重到 API 服务
   */
  async _loadModelWeights() {
    const gptPath = path.join(MODEL_DIR, 'xxx-e15.ckpt');
    const sovitsPath = path.join(MODEL_DIR, 'xxx_e16_s144_l32.pth');

    // 先加载 SoVITS 权重
    await this._httpGet(`${TTS_BASE_URL}/set_sovits_weights?weights_path=${encodeURIComponent(sovitsPath)}`);
    console.log('[TTS] SoVITS weights loaded');

    // 再加载 GPT 权重
    await this._httpGet(`${TTS_BASE_URL}/set_gpt_weights?weights_path=${encodeURIComponent(gptPath)}`);
    console.log('[TTS] GPT weights loaded');
  }

  /**
   * 合成语音
   * @param {string} text - 要合成的文本
   * @param {string} textLang - 文本语言 (zh/ja/en/auto)
   * @returns {Promise<Buffer|null>} WAV 音频 Buffer
   */
  async synthesize(text, textLang = 'auto') {
    if (!this.isReady) {
      console.warn('[TTS] Server not ready, cannot synthesize');
      return null;
    }

    if (!text || !text.trim()) return null;

    const ref = REF_OPTIONS[DEFAULT_REF];

    const body = {
      text: text.trim(),
      text_lang: textLang,
      ref_audio_path: ref.audio,
      prompt_text: ref.text,
      prompt_lang: 'ja',             // 参考音频是日语
      top_k: 15,
      top_p: 1,
      temperature: 1,
      text_split_method: 'cut5',
      batch_size: 1,
      speed_factor: 1.0,
      media_type: 'wav',
      streaming_mode: false,
      sample_steps: 32,
    };

    try {
      const audioBuffer = await this._httpPost(`${TTS_BASE_URL}/tts`, body);
      return audioBuffer;
    } catch (err) {
      console.error('[TTS] Synthesis failed:', err.message);
      return null;
    }
  }

  /**
   * 停止 TTS 服务
   */
  stop() {
    this._stopHealthCheck();
    if (this.process) {
      console.log('[TTS] Stopping server...');
      try {
        this.process.kill('SIGTERM');
      } catch (e) {
        // 如果 SIGTERM 不工作（Windows），尝试强制终止
        try {
          this.process.kill('SIGKILL');
        } catch (e2) {
          console.error('[TTS] Failed to kill process:', e2.message);
        }
      }
      this.process = null;
    }
    this.isReady = false;
    this.isStarting = false;
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      running: !!this.process,
      ready: this.isReady,
      starting: this.isStarting,
      url: TTS_BASE_URL,
    };
  }

  // ————————————————————————————
  // 内部方法
  // ————————————————————————————

  _startHealthCheck() {
    this._stopHealthCheck();
    this._healthTimer = setInterval(async () => {
      const ok = await this._healthPing();
      if (!ok && this.isReady) {
        console.warn('[TTS] Health check failed, server may be down');
        this.isReady = false;
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  _stopHealthCheck() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }

  /**
   * 简单 HTTP GET 健康检查
   */
  _healthPing() {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(3000);
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('error', () => { sock.destroy(); resolve(false); });
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
      sock.connect(TTS_PORT, TTS_HOST);
    });
  }

  /**
   * HTTP GET 返回文本
   */
  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 120000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  /**
   * HTTP POST，返回 Buffer（用于音频数据）
   */
  _httpPost(url, body) {
    return new Promise((resolve, reject) => {
      const jsonBody = JSON.stringify(body);
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
        },
        timeout: 180000,
      };

      const req = http.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode === 200) {
            resolve(buffer);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${buffer.toString().substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(jsonBody);
      req.end();
    });
  }
}

module.exports = { TTSServer };
