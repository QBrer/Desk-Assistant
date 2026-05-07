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
    this.isSpeaking = false;
    this._audioContext = null;
    this._currentSource = null;

    this._setupSpeechSynthesis();
    this._setupRecognition();
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
      this._updateSpeakBtnStyle();
    });

    // 主动查询一次状态
    window.electronAPI.ttsStatus().then((status) => {
      if (status && status.ready) {
        this.ttsReady = true;
        this._updateSpeakBtnStyle();
        console.log('[Voice] GPT-SoVITS already running');
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

  // ————————— 语音识别（输入） —————————

  _setupRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      this.micBtn?.classList.add('unsupported');
      this.micBtn?.setAttribute('title', '当前环境不支持语音识别');
      return;
    }

    this.recognition = new Recognition();
    this.recognition.lang = 'zh-CN';
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    let finalTranscript = '';

    this.recognition.onstart = () => {
      finalTranscript = '';
      this.isListening = true;
      this.micBtn?.classList.add('listening');
      window.character?.setState('thinking');
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const visibleText = `${finalTranscript}${interimTranscript}`.trim();
      if (this.input && visibleText) {
        this.input.value = visibleText;
        this.input.dispatchEvent(new Event('input'));
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error === 'network') {
        this.chatManager?.addSystemMessage('语音识别无法使用：需要连接 Google 服务器（国内网络不可用），请直接输入文字。');
        this.micBtn?.classList.add('unsupported');
        this.micBtn?.setAttribute('title', '语音识别不可用（国内网络限制）');
        this.recognition = null;
      } else if (event.error !== 'aborted') {
        this.chatManager?.addSystemMessage(`语音识别错误: ${event.error}`);
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.micBtn?.classList.remove('listening');
      window.character?.setState('idle');

      const text = (this.input?.value || '').trim();
      if (text && this.recognition && !this.chatManager?.isStreaming) {
        this.chatManager.sendText(text);
      }
    };
  }

  toggleListening() {
    if (!this.recognition) {
      this.chatManager?.addSystemMessage(this.micBtn?.classList.contains('unsupported')
        ? '语音识别不可用（国内网络限制）。'
        : '当前环境不支持语音识别。');
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
      return;
    }

    try {
      this.stopSpeaking();
      this.recognition.start();
    } catch (error) {
      this.chatManager?.addSystemMessage(`语音启动失败: ${error.message}`);
    }
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
   * 朗读文本。优先使用 GPT-SoVITS，不可用则 fallback 到浏览器。
   * @param {string} text - AI 回复的原始文本
   */
  async speak(text) {
    if (!this.autoSpeak || !text) return;

    const cleanText = this._cleanTextForSpeech(text);
    if (!cleanText) return;

    // 停止当前正在播放的语音
    this.stopSpeaking();

    // 优先 GPT-SoVITS
    if (this.ttsReady && window.electronAPI) {
      await this._speakWithGPTSoVITS(cleanText);
    } else {
      this._speakWithBrowser(cleanText);
    }
  }

  /**
   * 使用 GPT-SoVITS 合成并播放
   */
  async _speakWithGPTSoVITS(text) {
    this.isSpeaking = true;
    this._updateSpeakingUI(true);

    try {
      // 检测语言
      const lang = this._detectLang(text);

      const result = await window.electronAPI.ttsSynthesize(text, lang);
      if (!result || !result.success || !result.audio) {
        console.warn('[Voice] GPT-SoVITS synthesis failed, falling back to browser TTS');
        this._speakWithBrowser(text);
        return;
      }

      // 解码 base64 WAV 并播放
      const audioData = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
      await this._playAudioBuffer(audioData.buffer);
    } catch (err) {
      console.error('[Voice] GPT-SoVITS error:', err);
      // fallback
      this._speakWithBrowser(text);
    }
  }

  /**
   * 使用 Web Audio API 播放 WAV Buffer
   */
  async _playAudioBuffer(arrayBuffer) {
    try {
      if (!this._audioContext) {
        this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }

      const audioBuffer = await this._audioContext.decodeAudioData(arrayBuffer);
      const source = this._audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this._audioContext.destination);

      source.onended = () => {
        this.isSpeaking = false;
        this._updateSpeakingUI(false);
        this._currentSource = null;
        window.character?.setState('idle');
      };

      this._currentSource = source;
      window.character?.setState('talking');
      source.start(0);
    } catch (err) {
      console.error('[Voice] Audio playback error:', err);
      this.isSpeaking = false;
      this._updateSpeakingUI(false);
    }
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

  /**
   * 停止播放
   */
  stopSpeaking() {
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
