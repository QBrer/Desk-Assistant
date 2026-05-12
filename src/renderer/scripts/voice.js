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
    this.conversationMode = false;
    this.vadState = 'idle';
    this.transcribing = false;
    this.pausedForAssistant = false;
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
    this._ttsPrefetchMap = new Map();
    this._ttsPrefetchLimit = 2;
    this._ttsSessionId = 0;

    this._ttsStatusTimer = null;

    // Continuous voice conversation / VAD input state
    this._vadTimer = null;
    this._vadAnalyser = null;
    this._vadSource = null;
    this._vadData = null;
    this._preRecordChunks = [];
    this._currentSpeechChunks = [];
    this._speechStartedAt = 0;
    this._lastVoiceAt = 0;
    this._lastAssistantAudioAt = 0;
    this._vadThresholdDb = -48;
    this._silenceToStopMs = 900;
    this._minSpeechMs = 600;
    this._maxSpeechMs = 20000;
    this._preRecordMs = 400;
    this._recorderSliceMs = 200;
    this._recordingSessionId = 0;
    this._recorderStartedAt = 0;

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

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
      .then((stream) => {
        this._mediaStream = stream;
        this.micBtn?.setAttribute('title', '点击开启连续语音对话');
      })
      .catch(() => {
        this.micBtn?.classList.add('unsupported');
        this.micBtn?.setAttribute('title', '麦克风权限被拒绝');
      });

    if (window.electronAPI) {
      window.electronAPI.sttStatus().then((status) => {
        this._sttReady = status && status.ready;
        const provider = status?.provider === 'mimo' ? 'MiMo ASR' : '本地 Whisper';
        if (this._mediaStream) {
          this.micBtn?.setAttribute('title', `点击开启连续语音对话 (${provider})`);
        }
        if (!this._sttReady) {
          console.log('[Voice] STT not ready yet, will try when needed');
        }
      });
    }
  }

  toggleListening() {
    if (this.conversationMode) {
      this._stopConversationMode();
      return;
    }

    this._startConversationMode().catch((error) => {
      this.chatManager?.addSystemMessage(`连续语音启动失败: ${error.message}`);
      this._stopConversationMode();
    });
  }

  async _startConversationMode() {
    if (!this._mediaStream) {
      this.chatManager?.addSystemMessage('麦克风不可用，请检查权限设置。');
      return;
    }

    if (this.conversationMode) return;

    if (!this._audioContext) {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    this.conversationMode = true;
    this.transcribing = false;
    this._resetSpeechBuffers();
    this._startContinuousRecorder();
    this._startVADLoop();
    this._setVadState(this._isAssistantBusy() ? 'pausedForAssistant' : 'detecting');
  }

  _stopConversationMode() {
    this.conversationMode = false;
    this.transcribing = false;
    this.isListening = false;
    this.pausedForAssistant = false;
    this._stopVADLoop();
    this._stopContinuousRecorder();
    this._resetSpeechBuffers();
    this._setVadState('idle');
    window.character?.setState('idle');
  }

  _startContinuousRecorder() {
    this._stopContinuousRecorder(false);

    const sessionId = ++this._recordingSessionId;
    this._recorderStartedAt = Date.now();
    if (this.vadState !== 'speech') this._currentSpeechChunks = [];
    this._mediaRecorder = new MediaRecorder(this._mediaStream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    this._mediaRecorder.ondataavailable = (event) => {
      if (!event.data || event.data.size <= 0 || !this.conversationMode || sessionId !== this._recordingSessionId) return;
      this._currentSpeechChunks.push(event.data);
    };


    this._mediaRecorder.onstop = () => {
      if (this.conversationMode && !this.transcribing && sessionId === this._recordingSessionId) {
        this._startContinuousRecorder();
      }
    };

    this._mediaRecorder.onerror = (event) => {
      const message = event.error?.message || 'MediaRecorder error';
      console.warn('[Voice] Recorder error:', message);
      this.chatManager?.addSystemMessage(`录音错误: ${message}`);
      this._stopConversationMode();
    };

    this._mediaRecorder.start(this._recorderSliceMs);
  }

  _stopContinuousRecorder(invalidate = true) {
    if (invalidate) this._recordingSessionId++;
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      try { this._mediaRecorder.stop(); } catch (error) { console.warn('[Voice] Recorder stop failed:', error.message); }
    }
    this._mediaRecorder = null;
  }

  _startVADLoop() {
    this._stopVADLoop();

    if (!this._vadSource) {
      this._vadSource = this._audioContext.createMediaStreamSource(this._mediaStream);
    }
    this._vadAnalyser = this._audioContext.createAnalyser();
    this._vadAnalyser.fftSize = 1024;
    this._vadData = new Float32Array(this._vadAnalyser.fftSize);
    this._vadSource.connect(this._vadAnalyser);

    this._vadTimer = window.setInterval(() => this._handleVADTick(), 80);
  }

  _stopVADLoop() {
    if (this._vadTimer) {
      window.clearInterval(this._vadTimer);
      this._vadTimer = null;
    }
    if (this._vadSource) {
      try { this._vadSource.disconnect(); } catch (error) {}
      this._vadSource = null;
    }
    this._vadAnalyser = null;
    this._vadData = null;
  }

  _handleVADTick() {
    if (!this.conversationMode || !this._vadAnalyser || this.transcribing) return;

    if (this._isAssistantBusy()) {
      if (this.vadState === 'speech') this._discardCurrentSpeech();
      this._preRecordChunks = [];
      this._lastAssistantAudioAt = Date.now();
      this._setVadState('pausedForAssistant');
      return;
    }

    if (Date.now() - this._lastAssistantAudioAt < 500) {
      this._setVadState('pausedForAssistant');
      return;
    }

    if (this.vadState === 'pausedForAssistant' || this.vadState === 'idle') {
      this._setVadState('detecting');
    }

    const now = Date.now();
    const levelDb = this._getInputLevelDb();
    const hasVoice = levelDb >= this._vadThresholdDb;

    if (!hasVoice && this.vadState === 'detecting' && now - this._recorderStartedAt > Math.max(this._preRecordMs, this._recorderSliceMs * 2)) {
      this._currentSpeechChunks = [];
      if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
        try { this._mediaRecorder.stop(); } catch (error) {}
      }
      return;
    }

    if (hasVoice) {
      this._lastVoiceAt = now;
      if (this.vadState !== 'speech') {
        this._beginSpeechSegment(now);
      }
    }

    if (this.vadState !== 'speech') return;

    const speechMs = now - this._speechStartedAt;
    const silenceMs = now - this._lastVoiceAt;
    if (speechMs >= this._maxSpeechMs || (speechMs >= this._minSpeechMs && silenceMs >= this._silenceToStopMs)) {
      this._finishSpeechSegment();
    }
  }

  _getInputLevelDb() {
    this._vadAnalyser.getFloatTimeDomainData(this._vadData);
    let sum = 0;
    for (let i = 0; i < this._vadData.length; i++) {
      sum += this._vadData[i] * this._vadData[i];
    }
    const rms = Math.sqrt(sum / this._vadData.length) || 0.000001;
    return 20 * Math.log10(rms);
  }

  _beginSpeechSegment(now) {
    this._speechStartedAt = now;
    this._lastVoiceAt = now;
    this.isListening = true;
    this._setVadState('speech');
    window.character?.setState('thinking');
  }

  _discardCurrentSpeech() {
    this._currentSpeechChunks = [];
    this._speechStartedAt = 0;
    this._lastVoiceAt = 0;
    this.isListening = false;
  }

  _flushCurrentRecorder() {
    const recorder = this._mediaRecorder;
    if (!recorder || recorder.state === 'inactive') return Promise.resolve();

    return new Promise((resolve) => {
      const previousOnStop = recorder.onstop;
      recorder.onstop = (event) => {
        if (typeof previousOnStop === 'function') previousOnStop.call(recorder, event);
        resolve();
      };

      try { recorder.requestData(); } catch (error) {}
      try { recorder.stop(); } catch (error) { resolve(); }
    });
  }

  async _finishSpeechSegment() {
    if (this.transcribing) return;

    const speechMs = Date.now() - this._speechStartedAt;
    this.transcribing = true;
    await this._flushCurrentRecorder();

    const chunks = [...this._currentSpeechChunks];
    this._discardCurrentSpeech();

    if (speechMs < this._minSpeechMs || chunks.length === 0) {
      this.transcribing = false;
      if (this.conversationMode && (!this._mediaRecorder || this._mediaRecorder.state === 'inactive')) {
        this._startContinuousRecorder();
      }
      this._setVadState(this.conversationMode ? 'detecting' : 'idle');
      return;
    }

    this._setVadState('transcribing');
    window.character?.setState('thinking');

    try {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const wavData = await this._convertToWav(blob);
      if (!wavData || wavData.byteLength < 32000) {
        return;
      }

      const result = await window.electronAPI.sttTranscribe(Array.from(new Uint8Array(wavData)));
      if (result && result.success && result.text) {
        const text = result.text.trim();
        if (text && !this.chatManager?.isStreaming) {
          if (this.input) {
            this.input.value = text;
            this.input.dispatchEvent(new Event('input'));
          }
          this.chatManager.sendText(text);
        }
      } else if (result?.error) {
        console.warn('[Voice] STT returned no text:', result.error);
      }
    } catch (err) {
      this.chatManager?.addSystemMessage(`语音识别失败: ${err.message}`);
    } finally {
      this.transcribing = false;
      if (this.conversationMode) {
        if (!this._mediaRecorder || this._mediaRecorder.state === 'inactive') this._startContinuousRecorder();
        this._setVadState(this._isAssistantBusy() ? 'pausedForAssistant' : 'detecting');
      } else {
        this._setVadState('idle');
      }
    }
  }

  _resetSpeechBuffers() {
    this._preRecordChunks = [];
    this._currentSpeechChunks = [];
    this._speechStartedAt = 0;
    this._lastVoiceAt = 0;
  }

  _isAssistantBusy() {
    return !!(this.chatManager?.isStreaming || this.isSpeaking || this._ttsPlaying);
  }

  _setVadState(state) {
    this.vadState = state;
    this.pausedForAssistant = state === 'pausedForAssistant';
    this.isListening = state === 'speech';

    if (!this.micBtn) return;
    this.micBtn.classList.toggle('conversation-active', this.conversationMode);
    this.micBtn.classList.toggle('detecting', state === 'detecting');
    this.micBtn.classList.toggle('listening', state === 'speech');
    this.micBtn.classList.toggle('transcribing', state === 'transcribing');
    this.micBtn.classList.toggle('paused', state === 'pausedForAssistant');

    const titleByState = {
      idle: '点击开启连续语音对话',
      detecting: '连续对话开启：直接说话，静音后自动发送',
      speech: '正在听你说话，停顿后自动发送',
      transcribing: '正在识别语音...',
      pausedForAssistant: 'Lain 正在回复，语音监听已暂停',
    };
    this.micBtn.setAttribute('title', titleByState[state] || titleByState.idle);
    this.micBtn.setAttribute('aria-label', titleByState[state] || titleByState.idle);
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
    const sentences = this._mergeShortSegments(this._splitSentences(cleanText), 36);
    for (const s of sentences) {
      if (s) this._ttsQueue.push(s);
    }
    this._ensureTTSStatusFresh().then(() => this._warmTTSCache());
    if (!this._ttsPlaying) {
      this._processTTSQueue();
    }
  }

  /**
   * 播放队列中的句子（不打断，顺序播放）
   */
  async _processTTSQueue() {
    const sessionId = this._ttsSessionId;
    this._ttsPlaying = true;
    this.isSpeaking = true;
    this._updateSpeakingUI(true);
    window.character?.setState('talking');

    while (this._ttsQueue.length > 0) {
      if (!this.isSpeaking || sessionId !== this._ttsSessionId) break;
      this._warmTTSCache();
      const sentence = this._ttsQueue.shift();
      if (!sentence) continue;

      await this._waitForTTSReady(12000);

      if (this.ttsReady && window.electronAPI) {
        try {
          const result = await this._getPrefetchedTTS(sentence, sessionId);
          this._warmTTSCache();
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
    this._clearTTSCache();
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


  _warmTTSCache() {
    if (!this.ttsReady || !window.electronAPI) return;

    const pending = [...this._ttsPrefetchMap.values()].filter(item => item.state === 'pending').length;
    let slots = Math.max(0, this._ttsPrefetchLimit - pending);
    if (slots === 0) return;

    for (const sentence of this._ttsQueue) {
      if (slots <= 0) break;
      if (!sentence || this._ttsPrefetchMap.has(sentence)) continue;

      this._prefetchSentence(sentence, this._ttsSessionId);
      slots--;
    }
  }

  _prefetchSentence(sentence, sessionId) {
    const lang = this._detectLang(sentence);
    const promise = window.electronAPI.ttsSynthesize(sentence, lang)
      .then(result => {
        const cached = this._ttsPrefetchMap.get(sentence);
        if (cached && cached.sessionId === sessionId) {
          cached.state = 'done';
          cached.result = result;
        }
        return result;
      })
      .catch(error => {
        const cached = this._ttsPrefetchMap.get(sentence);
        if (cached && cached.sessionId === sessionId) {
          cached.state = 'error';
          cached.error = error;
        }
        throw error;
      });

    this._ttsPrefetchMap.set(sentence, {
      sessionId,
      state: 'pending',
      promise,
      result: null,
      error: null,
    });
  }

  async _getPrefetchedTTS(sentence, sessionId) {
    const cached = this._ttsPrefetchMap.get(sentence);
    if (cached && cached.sessionId === sessionId) {
      try {
        return await cached.promise;
      } finally {
        this._ttsPrefetchMap.delete(sentence);
      }
    }

    const lang = this._detectLang(sentence);
    return await window.electronAPI.ttsSynthesize(sentence, lang);
  }

  _clearTTSCache() {
    this._ttsPrefetchMap.clear();
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
    // 清空队列并让正在预合成的旧任务失效
    this._ttsSessionId++;
    this._ttsQueue = [];
    this._ttsPlaying = false;
    this._clearTTSCache();

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

  _mergeShortSegments(segments, minChars) {
    const merged = [];
    let buffer = '';

    for (const segment of segments) {
      const text = segment.trim();
      if (!text) continue;

      buffer = buffer ? `${buffer}${text}` : text;
      if (buffer.length >= minChars) {
        merged.push(buffer);
        buffer = '';
      }
    }

    if (buffer) {
      if (merged.length > 0 && buffer.length < Math.floor(minChars / 2)) {
        merged[merged.length - 1] += buffer;
      } else {
        merged.push(buffer);
      }
    }

    return merged;
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


  async _ensureTTSStatusFresh() {
    if (this.ttsReady || !window.electronAPI) return this.ttsReady;

    try {
      const status = await window.electronAPI.ttsStatus();
      this.ttsReady = !!status?.ready;
      this.ttsStarting = !!status?.starting;
      this._updateSpeakBtnStyle();
      return this.ttsReady;
    } catch (err) {
      console.warn('[Voice] TTS status refresh failed:', err.message);
      return false;
    }
  }

  async _waitForTTSReady(timeoutMs) {
    if (await this._ensureTTSStatusFresh()) return true;

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
