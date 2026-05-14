/**
 * Whisper STT 服务管理器
 * 负责启动 faster-whisper Python 服务，提供本地语音识别。
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');

const { PYTHON_EXE } = require('../shared/constants');
const STT_PORT = 9870;
const STT_HOST = '127.0.0.1';
const STT_BASE_URL = `http://${STT_HOST}:${STT_PORT}`;

const HEALTH_CHECK_INTERVAL = 15000;
const STARTUP_TIMEOUT = 600000; // base模型~142MB，首次下载最多等10分钟

const MODEL_DIR = path.join(__dirname, '..', '..', 'lain-voice-model');
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const MIMO_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
const MIMO_ASR_MODEL = process.env.MIMO_ASR_MODEL || 'mimo-v2-omni';

class STTServer {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.isStarting = false;
    this._healthTimer = null;
    this._readyPromise = null;
    this.provider = (process.env.LAIN_STT_PROVIDER || this._readEnvValue('LAIN_STT_PROVIDER') || 'local').toLowerCase();
    this.mimoApiKey = process.env.XIAOMI_API_KEY || this._readEnvValue('XIAOMI_API_KEY');
  }

  async start() {
    if (this.provider === 'mimo') {
      this.isReady = !!this.mimoApiKey;
      this.isStarting = false;
      if (!this.isReady) {
        console.error('[STT] LAIN_STT_PROVIDER=mimo but XIAOMI_API_KEY is missing');
      } else {
        console.log('[STT] Using Xiaomi MiMo cloud ASR provider');
      }
      return this.isReady;
    }

    if (this.isReady) return true;
    if (this.isStarting) return this._readyPromise;

    this.isStarting = true;

    const startScript = path.join(MODEL_DIR, 'stt_api.py');
    if (!fs.existsSync(startScript)) {
      console.error('[STT] stt_api.py not found:', startScript);
      this.isStarting = false;
      return false;
    }

    if (await this._tcpPing()) {
      console.log('[STT] Existing Whisper server detected.');
      this.isReady = true;
      this.isStarting = false;
      this._startHealthCheck();
      return true;
    }

    this._readyPromise = new Promise((resolve) => {
      console.log('[STT] Starting Whisper server...');

      this.process = spawn(PYTHON_EXE, [
        startScript,
        String(STT_PORT),
        STT_HOST,
      ], {
        cwd: MODEL_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_ENDPOINT: 'https://hf-mirror.com', KMP_DUPLICATE_LIB_OK: 'TRUE' },
        windowsHide: true,
      });

      this.process.stdout?.on('data', (data) => {
        const msg = data.toString('utf-8').trim();
        if (msg) console.log(`[STT stdout] ${msg}`);
      });

      this.process.stderr?.on('data', (data) => {
        const msg = data.toString('utf-8').trim();
        if (msg) console.log(`[STT stderr] ${msg}`);
      });

      this.process.on('error', (err) => {
        console.error('[STT] Process error:', err.message);
        this.isReady = false;
        this.isStarting = false;
        resolve(false);
      });

      this.process.on('exit', (code) => {
        console.log(`[STT] Process exited with code ${code}`);
        this.isReady = false;
        this.isStarting = false;
        this._stopHealthCheck();
      });

      // 轮询等待模型加载完成
      const startTime = Date.now();
      const pollReady = () => {
        if (Date.now() - startTime > STARTUP_TIMEOUT) {
          console.error('[STT] Server startup timed out');
          this.isStarting = false;
          resolve(false);
          return;
        }

        // 检查 stdout 中是否打印了 "Model loaded"
        // 同时做 TCP 连接检查
        this._tcpPing()
          .then((ok) => {
            if (ok) {
              console.log('[STT] Server is ready!');
              this.isReady = true;
              this.isStarting = false;
              this._startHealthCheck();
              resolve(true);
            } else {
              setTimeout(pollReady, 2000);
            }
          })
          .catch(() => setTimeout(pollReady, 2000));
      };

      // 给进程 3 秒启动时间，因为模型加载可能很快（tiny 模型 ~75MB）
      setTimeout(pollReady, 3000);
    });

    return this._readyPromise;
  }

  /**
   * 转录音频为文本
   * @param {Buffer} audioBuffer - WAV 音频数据
   * @returns {Promise<string|null>} 识别文本
   */
  async transcribe(audioBuffer) {
    if (this.provider === 'mimo') {
      return await this.transcribeWithMiMo(audioBuffer);
    }

    if (!this.isReady) {
      console.warn('[STT] Server not ready');
      return null;
    }

    if (!audioBuffer || audioBuffer.length === 0) return null;

    try {
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
      const footer = `\r\n--${boundary}--\r\n`;

      const body = Buffer.concat([
        Buffer.from(header),
        audioBuffer,
        Buffer.from(footer),
      ]);

      const result = await this._httpPost(STT_BASE_URL + '/transcribe', body, boundary);
      return result ? result.text : null;
    } catch (err) {
      console.error('[STT] Transcription failed:', err.message);
      return null;
    }
  }

  stop() {
    this._stopHealthCheck();
    if (this.process) {
      console.log('[STT] Stopping server...');
      try { this.process.kill('SIGTERM'); } catch (e) {}
      try { this.process.kill('SIGKILL'); } catch (e2) {}
      this.process = null;
    }
    this.isReady = false;
    this.isStarting = false;
  }

  getStatus() {
    return {
      running: !!this.process,
      ready: this.isReady,
      starting: this.isStarting,
      provider: this.provider,
      url: STT_BASE_URL,
    };
  }

  async transcribeWithMiMo(audioBuffer) {
    if (!this.mimoApiKey) {
      console.warn('[STT] MiMo API key missing');
      return null;
    }

    const body = {
      model: MIMO_ASR_MODEL,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请将这段音频逐字转写为原文。只输出转写文本，不要翻译、解释、加引号或补充说明。',
          },
          {
            type: 'input_audio',
            input_audio: {
              data: audioBuffer.toString('base64'),
              format: 'wav',
            },
          },
        ],
      }],
      max_tokens: 512,
      temperature: 0,
    };

    const result = await this._httpsJsonPost(`${MIMO_BASE_URL}/chat/completions`, body, {
      Authorization: `Bearer ${this.mimoApiKey}`,
      'Content-Type': 'application/json',
    });
    const text = result?.choices?.[0]?.message?.content?.trim();
    return this._cleanMiMoTranscript(text);
  }

  _cleanMiMoTranscript(text) {
    if (!text) return null;

    return text
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .replace(/^(转写文本|原文|音频内容|识别结果)\s*[:：]\s*/i, '')
      .trim();
  }

  _readEnvValue(key) {
    try {
      const envPath = path.join(PROJECT_ROOT, '.env');
      if (!fs.existsSync(envPath)) return null;
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(new RegExp(`^${key}=([^\\r\\n]+)`, 'm'));
      return match ? match[1].trim() : null;
    } catch {
      return null;
    }
  }

  _httpsJsonPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const jsonBody = JSON.stringify(body);
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(jsonBody),
        },
        timeout: 60000,
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error(`Invalid JSON response: ${error.message}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(jsonBody);
      req.end();
    });
  }

  _startHealthCheck() {
    this._stopHealthCheck();
    this._healthTimer = setInterval(async () => {
      const ok = await this._tcpPing();
      if (!ok && this.isReady) {
        console.warn('[STT] Health check failed');
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

  _tcpPing() {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(3000);
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('error', () => { sock.destroy(); resolve(false); });
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
      sock.connect(STT_PORT, STT_HOST);
    });
  }

  _httpPost(url, body, boundary) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        timeout: 30000,
      };

      const req = http.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            if (res.statusCode === 200) {
              resolve(data);
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = { STTServer };
