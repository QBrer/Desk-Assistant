/**
 * Voice input and reply speech.
 * Uses Chromium's built-in Web Speech APIs when available.
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

    this._setupSpeechSynthesis();
    this._setupRecognition();
    this._setupEvents();
  }

  _setupEvents() {
    this.micBtn?.addEventListener('click', () => this.toggleListening());
    this.speakBtn?.addEventListener('click', () => this.toggleAutoSpeak());
  }

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
      this.chatManager?.addSystemMessage(`语音识别错误: ${event.error}`);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.micBtn?.classList.remove('listening');
      window.character?.setState('idle');

      const text = (this.input?.value || '').trim();
      if (text && !this.chatManager?.isStreaming) {
        this.chatManager.sendText(text);
      }
    };
  }

  toggleListening() {
    if (!this.recognition) {
      this.chatManager?.addSystemMessage('当前环境不支持语音识别。');
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
      return;
    }

    try {
      window.speechSynthesis?.cancel();
      this.recognition.start();
    } catch (error) {
      this.chatManager?.addSystemMessage(`语音启动失败: ${error.message}`);
    }
  }

  toggleAutoSpeak() {
    this.autoSpeak = !this.autoSpeak;
    this.speakBtn?.classList.toggle('active', this.autoSpeak);

    if (!this.autoSpeak) {
      window.speechSynthesis?.cancel();
    }
  }

  speak(text) {
    if (!this.autoSpeak || !text || !('speechSynthesis' in window)) return;

    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/https?:\/\/\S+/g, '链接')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = this.selectedVoice?.lang || 'zh-CN';
    utterance.voice = this.selectedVoice;
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
  }
}

window.VoiceManager = VoiceManager;
