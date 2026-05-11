/**
 * Voice Manager — 语音输入 + GPT-SoVITS 语音合成
 *
 * 语音输出优先使用本地 GPT-SoVITS 服务（玲音的训练声线），
 * 若服务不可用则自动降级为浏览器内置 Web Speech API。
 */
class VoiceManager {
  constructor(chatManager) {
    this.chatManager = chatManager;
    this.micBtn = document.getElementById('voice-btn');
    this.speakBtn = document.getElementById('voice-speak-btn');
    this.input = document.getElementById('chat-input');
    this.autoSpeak = true;
    this.isListening = false;
    this.recognition = null;
    this.selectedVoice = null;

    // GPT-SoVITS 状态
    this.ttsReady = false;
    this.ttsStarting = false;
    this.isSpeaking = false;
    this._audioContext = null;
    this._currentSource = null;
    this._ttsQueue = [];
    this._ttsPlaying = false;

    this._setupSpeechSynthesis();
    this._setupRecording();
    this._setupEvents();
    this._setupTTS();
  }

  // ————————— GPT-SoVITS 初始化 —————————

  _setupTTS() {
    if (!window.electronAPI) return;

    // 监听 TTS 就绪通知
    window.electronAPI.onTTSReady(() => {
      console.log('[Voice] GPT-SoVITS TTS is ready!');
      this.ttsReady = true;
      this.ttsStarting = false;
      this._updateSpeakBtnStyle();
    });

    // 主动查询一次状态
    window.electronAPI.ttsStatus().then((status) => {
      if (status && status.ready) {
        this.ttsReady = true;
        this.ttsStarting = false;
        this._updateSpeakBtnStyle();
        console.log('[Voice] GPT-SoVITS already running');
      } else if (status && status.starting) {
        this.ttsStarting = true;
        this._updateSpeakBtnStyle();
      }
    });
  }

  /**
   * 更新朗读按钮样式，显示 TTS 引擎类型
   */
  _updateSpeakBtnStyle() {
    if (!this.speakBtn) return;

    if (this.ttsReady) {
      this.speakBtn.setAttribute('title', '朗读回复 (玲音语音 · GPT-SoVITS)');
      this.speakBtn.classList.add('tts-lain');
    } else if (this.ttsStarting) {
      this.speakBtn.setAttribute('title', '朗读回复 (玲音语音启动中)');
      this.speakBtn.classList.remove('tts-lain');
    } else {
      this.speakBtn.setAttribute('title', '朗读回复 (浏览器语音)');
      this.speakBtn.classList.remove('tts-lain');
    }
  }

  // ————————— 事件 —————————

  _setupEvents() {
    this.micBtn?.addEventListener('click', () => this.toggleListening());
    this.speakBtn?.addEventListener('click', () => this.toggleAutoSpeak());
  }

  // ————————— 浏览器 TTS 备用 —————————

  _setupSpeechSynthesis() {
    if (!('speechSynthesis' in window)) {
      this.autoSpeak = false;
      this.speakBtn?.classList.remove('active');
      this.speakBtn?.classList.add('unsupported');
      this.speakBtn?.setAttribute('title', '当前环境不支持朗读');
      return;
    }

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      this.selectedVoice =
        voices.find(voice => /zh|chinese|mandarin/i.test(`${voice.lang} ${voice.name}`)) ||
        voices.find(voice => /ja|japanese/i.test(`${voice.lang} ${voice.name}`)) ||
        voices[0] ||
        null;
    };

    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }

  // ————————— 语音识别（输入，faster-whisper）—————————

  _setupRecording() {
    this._mediaStream = null;
    this._mediaRecorder = null;
    this._audioChunks = [];
    this._sttReady = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.micBtn?.classList.add('unsupported');
      this.micBtn?.setAttribute('title', '当前环境不支持麦克风');
      return;
    }

    // 预先请求麦克风权限
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        this._mediaStream = stream;
        this.micBtn?.setAttribute('title', '点击开始语音输入 (本地 Whisper)');
      })
      .catch(() => {
        this.micBtn?.classList.add('unsupported');
        this.micBtn?.setAttribute('title', '麦克风权限被拒绝');
      });

    // 查询 STT 服务状态
    if (window.electronAPI) {
      window.electronAPI.sttStatus().then((status) => {
        this._sttReady = status && status.ready;
        if (!this._sttReady) {
          console.log('[Voice] Whisper STT not ready yet, will try when needed');
        }
      });
    }
  }

  toggleListening() {
    if (!this._mediaStream) {
      this.chatManager?.addSystemMessage('麦克风不可用，请检查权限设置。');
      return;
    }

    if (this.isListening) {
      this._stopRecording();
      return;
    }

    try {
      this.stopSpeaking();
      this._startRecording();
    } catch (error) {
      this.chatManager?.addSystemMessage(`录音启动失败: ${error.message}`);
    }
  }

  _startRecording() {
    this._audioChunks = [];
    this._mediaRecorder = new MediaRecorder(this._mediaStream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._audioChunks.push(e.data);
    };

    this._mediaRecorder.onstop = async () => {
      if (this._audioChunks.length === 0) return;

      const blob = new Blob(this._audioChunks, { type: 'audio/webm' });
      this._audioChunks = [];

      try {
        // webm → AudioBuffer → WAV
        const wavData = await this._convertToWav(blob);
        if (!wavData) {
          this.chatManager?.addSystemMessage('音频处理失败，请重试。');
          return;
        }

        if (wavData.byteLength < 32000) {
          this.chatManager?.addSystemMessage('录音太短了，请再说一次。');
          return;
        }

        const result = await window.electronAPI.sttTranscribe(Array.from(new Uint8Array(wavData)));
        if (result && result.success && result.text) {
          if (this.input) {
            this.input.value = result.text;
            this.input.dispatchEvent(new Event('input'));
          }
          this.chatManager.sendText(result.text);
        } else {
          this.chatManager?.addSystemMessage('未识别到语音内容，请重试。');
        }
      } catch (err) {
        this.chatManager?.addSystemMessage(`语音识别失败: ${err.message}`);
      }
    };

    this._mediaRecorder.start(250);
    this.isListening = true;
    this.micBtn?.classList.add('listening');
    window.character?.setState('thinking');
  }

  _stopRecording() {
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      this._mediaRecorder.stop();
    }
    this.isListening = false;
    this.micBtn?.classList.remove('listening');
    window.character?.setState('idle');
  }

  toggleAutoSpeak() {
    this.autoSpeak = !this.autoSpeak;
    this.speakBtn?.classList.toggle('active', this.autoSpeak);

    if (!this.autoSpeak) {
      this.stopSpeaking();
    }
  }

  // ————————— 语音合成（输出） —————————

  /**
   * 流式 TTS：将文本片段加入队列，逐句播放
   * 新片段不会打断当前正在播放的句子
   */
  enqueue(text) {
    if (!this.autoSpeak || !text) return;
    const cleanText = this._cleanTextForSpeech(text);
    const sentences = this._splitSentences(cleanText);
    for (const s of sentences) {
      if (s) this._ttsQueue.push(s);
    }
    if (!this._ttsPlaying) {
      this._processTTSQueue();
    }
  }

  /**
   * 播放队列中的句子（不打断，顺序播放）
   */
  async _processTTSQueue() {
    this._ttsPlaying = true;
    this.isSpeaking = true;
    this._updateSpeakingUI(true);
    window.character?.setState('talking');

    while (this._ttsQueue.length > 0) {
      if (!this.isSpeaking) break;
      const sentence = this._ttsQueue.shift();
      if (!sentence) continue;

      await this._waitForTTSReady(12000);

      if (this.ttsReady && window.electronAPI) {
        try {
          const lang = this._detectLang(sentence);
          const result = await window.electronAPI.ttsSynthesize(sentence, lang);
          if (result && result.success && result.audio) {
            const audioData = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
            await this._playAudioBuffer(audioData.buffer);
          } else {
            console.warn('[Voice] GPT-SoVITS returned no audio:', result?.error || 'unknown error');
            await this._speakWithBrowserAsync(sentence);
          }
        } catch (err) {
          console.warn('[Voice] Queue sentence error:', err.message);
          await this._speakWithBrowserAsync(sentence);
        }
      } else {
        await this._speakWithBrowserAsync(sentence);
      }
    }

    this.isSpeaking = false;
    this._ttsPlaying = false;
    this._updateSpeakingUI(false);
    window.character?.setState('idle');
  }

  /**
   * 朗读文本。优先使用 GPT-SoVITS，不可用则 fallback 到浏览器。
   * @param {string} text - AI 回复的原始文本
   */
  async speak(text) {
    if (!this.autoSpeak || !text) return;
    const cleanText = this._cleanTextForSpeech(text);
    if (!cleanText) return;
    this.stopSpeaking();
    this._ttsQueue = [cleanText];
    await this._processTTSQueue();
  }

  /**
   * 使用 GPT-SoVITS 合成并播放
   * 长文本按句子拆分，逐句请求合成、逐句播放，避免单次请求超时
   */
  async _speakWithGPTSoVITS(text) {
    this.isSpeaking = true;
    this._updateSpeakingUI(true);
    window.character?.setState('talking');

    const lang = this._detectLang(text);
    const sentences = this._splitSentences(text);
    let anySuccess = false;

    try {
      for (let i = 0; i < sentences.length; i++) {
        if (!this.isSpeaking) break;

        const sentence = sentences[i];
        if (!sentence) continue;

        try {
          const result = await window.electronAPI.ttsSynthesize(sentence, lang);
          if (result && result.success && result.audio) {
            const audioData = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
            await this._playAudioBuffer(audioData.buffer);
            anySuccess = true;
          }
        } catch (err) {
          console.warn('[Voice] Sentence error:', err.message);
        }
      }
    } finally {
      this.isSpeaking = false;
      this._updateSpeakingUI(false);
      window.character?.setState('idle');
    }

    if (!anySuccess && sentences.length > 0) {
      this._speakWithBrowser(text);
    }
  }

  /**
   * 播放 WAV Buffer，返回 Promise 在播放完成时 resolve
   */
  _playAudioBuffer(arrayBuffer) {
    return new Promise((resolve, reject) => {
      try {
        if (!this._audioContext) {
          this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const doPlay = () => {
          this._audioContext.decodeAudioData(arrayBuffer, (audioBuffer) => {
            const source = this._audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this._audioContext.destination);
            source.onended = () => {
              this._currentSource = null;
              resolve();
            };
            this._currentSource = source;
            source.start(0);
          }, reject);
        };

        if (this._audioContext.state === 'suspended') {
          this._audioContext.resume().then(doPlay).catch(reject);
        } else {
          doPlay();
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 浏览器 TTS 备用
   */
  _speakWithBrowser(text) {
    if (!('speechSynthesis' in window)) return;

    this.isSpeaking = true;
    this._updateSpeakingUI(true);

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.selectedVoice?.lang || 'zh-CN';
    utterance.voice = this.selectedVoice;
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    utterance.volume = 0.9;

    utterance.onend = () => {
      this.isSpeaking = false;
      this._updateSpeakingUI(false);
      window.character?.setState('idle');
    };

    utterance.onerror = () => {
      this.isSpeaking = false;
      this._updateSpeakingUI(false);
    };

    window.character?.setState('talking');
    window.speechSynthesis.speak(utterance);
  }

  _speakWithBrowserAsync(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }

      this.isSpeaking = true;
      this._updateSpeakingUI(true);
      window.character?.setState('talking');

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.selectedVoice?.lang || 'zh-CN';
      utterance.voice = this.selectedVoice;
      utterance.rate = 0.95;
      utterance.pitch = 1.05;
      utterance.volume = 0.9;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * 停止播放
   */
  stopSpeaking() {
    // 清空队列
    this._ttsQueue = [];
    this._ttsPlaying = false;

    // 停止 GPT-SoVITS 播放
    if (this._currentSource) {
      try {
        this._currentSource.stop();
      } catch (e) { /* 可能已停止 */ }
      this._currentSource = null;
    }

    // 停止浏览器 TTS
    window.speechSynthesis?.cancel();

    this.isSpeaking = false;
    this._updateSpeakingUI(false);
  }

  // ————————— 工具方法 —————————

  /**
   * 清理文本用于语音合成（移除代码块、URL 等）
   */
  _cleanTextForSpeech(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/https?:\/\/\S+/g, '链接')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * webm 音频 → 16kHz 16bit mono WAV ArrayBuffer
   */
  async _convertToWav(blob) {
    if (!this._audioContext) {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this._audioContext.decodeAudioData(arrayBuffer);

    // 重采样到 16kHz mono
    const targetRate = 16000;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetRate), targetRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    const resampled = await offlineCtx.startRendering();

    const samples = resampled.getChannelData(0);
    const wav = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(wav);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); v.setUint32(4, wav.byteLength - 8, true);
    writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, targetRate, true);
    v.setUint32(28, targetRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    writeStr(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s * 0x7FFF | 0, true);
    }
    return wav;
  }

  /**
   * 按标点拆分句子，短句合并到相邻句避免过多碎片
   */
  _splitSentences(text) {
    const raw = text.split(/(?<=[。！？.!?\n])\s*/);
    const result = [];
    for (const s of raw) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      if (trimmed.length < 4 && result.length > 0) {
        result[result.length - 1] += trimmed;
      } else {
        result.push(trimmed);
      }
    }
    return result.length > 0 ? result : [text];
  }

  /**
   * 简单的语言检测
   */
  _detectLang(text) {
    // 日语字符 (平假名 + 片假名)
    const jaCount = (text.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
    // 中文字符
    const zhCount = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
    // 英文单词
    const enCount = (text.match(/[a-zA-Z]+/g) || []).length;

    const total = jaCount + zhCount + enCount;
    if (total === 0) return 'auto';

    if (jaCount / total > 0.3) return 'ja';
    if (zhCount / total > 0.3) return 'zh';
    if (enCount / total > 0.5) return 'en';
    return 'auto';
  }

  async _waitForTTSReady(timeoutMs) {
    if (this.ttsReady || !window.electronAPI) return this.ttsReady;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const status = await window.electronAPI.ttsStatus();
        this.ttsReady = !!status?.ready;
        this.ttsStarting = !!status?.starting;
        this._updateSpeakBtnStyle();
        if (this.ttsReady) return true;
      } catch (err) {
        console.warn('[Voice] TTS status check failed:', err.message);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return false;
  }

  /**
   * 更新朗读按钮 UI
   */
  _updateSpeakingUI(speaking) {
    if (speaking) {
      this.speakBtn?.classList.add('speaking');
    } else {
      this.speakBtn?.classList.remove('speaking');
    }
  }
}

window.VoiceManager = VoiceManager;
