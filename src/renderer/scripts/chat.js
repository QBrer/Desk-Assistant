/**
 * 对话管理器
 * 处理消息发送、接收、渲染
 */
class ChatManager {
  constructor() {
    this.messagesContainer = document.getElementById('chat-messages');
    this.input = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('send-btn');
    this.confirmDialog = document.getElementById('confirm-dialog');
    this.confirmText = document.getElementById('confirm-text');
    this.confirmYes = document.getElementById('confirm-yes');
    this.confirmNo = document.getElementById('confirm-no');

    this.isStreaming = false;
    this.currentStreamElement = null;
    this.streamContent = '';

    this._setupEvents();
    this._setupAPIListeners();
  }

  /**
   * 设置事件监听
   */
  _setupEvents() {
    // 发送按钮
    this.sendBtn?.addEventListener('click', () => this.sendMessage());

    // 键盘事件
    this.input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // 自动调整输入框高度
    this.input?.addEventListener('input', () => {
      this.input.style.height = 'auto';
      this.input.style.height = Math.min(this.input.scrollHeight, 100) + 'px';
    });

    // 确认对话框
    this.confirmYes?.addEventListener('click', () => {
      this._resolveConfirm(true);
    });
    this.confirmNo?.addEventListener('click', () => {
      this._resolveConfirm(false);
    });
  }

  /**
   * 设置 API 监听器
   */
  _setupAPIListeners() {
    if (!window.electronAPI) return;

    // 流式数据
    window.electronAPI.onStreamChunk((chunk) => {
      this._appendStreamChunk(chunk);
    });

    // 流结束
    window.electronAPI.onStreamEnd(() => {
      this._endStream();
    });

    // 流错误
    window.electronAPI.onStreamError((error) => {
      this._endStream();
      this.addSystemMessage(`连接错误: ${error}`);
      window.character?.setState('error');
      setTimeout(() => window.character?.setState('idle'), 2000);
    });

    // 确认请求
    window.electronAPI.onConfirmRequest((data) => {
      this.showConfirm(data.message, data.id);
    });
  }

  /**
   * 发送消息 / 停止生成
   */
  sendMessage() {
    if (this.isStreaming) {
      this.stopStreaming();
      // 等一小段时间让后端清理状态再发新消息
      setTimeout(() => this._sendInputText(), 500);
      return;
    }

    this._sendInputText();
  }

  _sendInputText() {
    const text = this.input?.value?.trim();
    if (!text || this.isStreaming) return;

    this.sendText(text);
  }

  stopStreaming() {
    if (!this.isStreaming) return;
    window.electronAPI?.stopGeneration();
    this._endStream();
    this.addSystemMessage('已停止生成。');
  }

  sendText(text) {
    if (this.isStreaming || !text?.trim()) return;

    text = text.trim();

    // 渲染用户消息
    this.addUserMessage(text);

    // 清空输入
    this.input.value = '';
    this.input.style.height = 'auto';

    // 开始流式接收
    this._startStream();

    // 发送到 AI
    if (window.electronAPI) {
      window.electronAPI.sendMessage(text);
    } else {
      // 没有 Electron API — 模拟回复（开发模式）
      this._simulateReply(text);
    }
  }

  /**
   * 添加用户消息
   */
  addUserMessage(text) {
    const msgEl = this._createMessageElement('user', text);
    this.messagesContainer?.appendChild(msgEl);
    this._scrollToBottom();
  }

  /**
   * 添加玲音消息
   */
  addLainMessage(text) {
    const msgEl = this._createMessageElement('lain', text);
    this.messagesContainer?.appendChild(msgEl);
    this._scrollToBottom();
  }

  /**
   * 添加系统消息
   */
  addSystemMessage(text) {
    const msgEl = document.createElement('div');
    msgEl.className = 'message message-system';
    msgEl.innerHTML = `
      <div class="message-content">
        <div class="message-text">${this._escapeHtml(text)}</div>
      </div>
    `;
    this.messagesContainer?.appendChild(msgEl);
    this._scrollToBottom();
  }

  /**
   * 开始流式输出
   */
  _startStream() {
    this.isStreaming = true;
    this.streamContent = '';
    this.sendBtn && (this.sendBtn.disabled = false);
    this.sendBtn?.classList.add('stop-btn');
    this.sendBtn?.setAttribute('title', '停止生成');

    // 停止当前正在播放的语音
    window.voiceManager?.stopSpeaking();

    // 切换角色状态
    window.character?.setState('thinking');

    // 创建加载消息
    const msgEl = document.createElement('div');
    msgEl.className = 'message message-lain';
    msgEl.innerHTML = `
      <div class="message-avatar">L</div>
      <div class="message-content">
        <div class="message-text">
          <div class="loading-dots"><span></span><span></span><span></span></div>
        </div>
      </div>
    `;
    this.messagesContainer?.appendChild(msgEl);
    this.currentStreamElement = msgEl;
    this._scrollToBottom();
  }

  /**
   * 追加流式数据块
   */
  _appendStreamChunk(chunk) {
    if (!this.currentStreamElement) return;

    this.streamContent += chunk;
    const speakableChunk = this._getSpeakableTTSChunk(chunk);
    if (speakableChunk) {
      this._ttsBuffer = (this._ttsBuffer || '') + speakableChunk;
    }
    window.character?.setState('talking');

    // 边回复边语音：优先按完整句子送入 TTS；开头等待过久时按短语提前启动。
    const readyText = this._takeReadyTTSChunk();
    if (readyText) {
      window.voiceManager?.enqueue(readyText);
    }

    const textEl = this.currentStreamElement.querySelector('.message-text');
    if (textEl) {
      textEl.innerHTML = this._renderMarkdown(this.streamContent) + '<span class="typing-cursor"></span>';
    }
    this._scrollToBottom();
  }


  _getSpeakableTTSChunk(chunk) {
    if (!chunk) return '';

    const trimmed = chunk.trim();
    if (!trimmed) return '';

    const pathLike = /[A-Za-z]:\\[^\s]+/.test(trimmed);
    const structuredOutput = /^\s*[\[{]/.test(trimmed) || /^\s*Name\s+Mode\s+Length/i.test(trimmed) || /^\s*Name\s+Length\s+LastWriteTime/i.test(trimmed);
    const progressLine = /^\.\.\./.test(trimmed) || /^Command failed/i.test(trimmed);
    const terseToolResult = trimmed.length < 80 && /^(Error|HTTP|Python|OK|Done|Saved|Opened)/i.test(trimmed);

    if (structuredOutput || progressLine || (pathLike && terseToolResult)) return '';

    return chunk
      .replace(/[A-Za-z]:\\[^\s,.;:!?()[\]{}]+/g, ' workspace path ')
      .replace(/https?:\/\/\S+/g, ' link ');
  }


  _takeReadyTTSChunk() {
    if (!this._ttsBuffer) return '';

    const sentenceEnd = /[。！？.!?\n]/g;
    const ends = [...this._ttsBuffer.matchAll(sentenceEnd)].map(m => m.index);
    if (ends.length > 0) {
      const lastEnd = Math.max(...ends);
      if (lastEnd >= 0) return this._takeTTSBuffer(lastEnd + 1);
    }

    const trimmed = this._ttsBuffer.trimStart();
    const leadingSpaces = this._ttsBuffer.length - trimmed.length;
    const earlyMinChars = window.voiceManager?.isSpeaking ? 28 : 16;
    if (trimmed.length < earlyMinChars) return '';

    const softEnd = /[，,、；;：:…]/g;
    const softEnds = [...trimmed.matchAll(softEnd)].map(m => m.index).filter(index => index >= 8);
    if (softEnds.length > 0) {
      return this._takeTTSBuffer(leadingSpaces + softEnds[0] + 1);
    }

    const safeCut = this._findSafeTTSBreak(trimmed, earlyMinChars, window.voiceManager?.isSpeaking ? 42 : 26);
    if (safeCut > 0) return this._takeTTSBuffer(leadingSpaces + safeCut);

    return '';
  }

  _takeTTSBuffer(endIndex) {
    const chunk = this._ttsBuffer.substring(0, endIndex).trim();
    this._ttsBuffer = this._ttsBuffer.substring(endIndex);
    return chunk;
  }

  _findSafeTTSBreak(text, minChars, maxChars) {
    const limit = Math.min(text.length, maxChars);
    if (text.length < minChars) return -1;

    for (let i = limit; i >= minChars; i--) {
      if (/\s/.test(text[i - 1] || '')) return i;
    }

    return limit;
  }

  /**
   * 结束流式输出
   */
  _endStream() {
    const finalText = this.streamContent;
    if (this.currentStreamElement) {
      const textEl = this.currentStreamElement.querySelector('.message-text');
      if (textEl) {
        // 移除打字光标
        const cursor = textEl.querySelector('.typing-cursor');
        if (cursor) cursor.remove();
        // 最终渲染
        textEl.innerHTML = this._renderMarkdown(this.streamContent);
      }
    }

    this.isStreaming = false;
    this.currentStreamElement = null;
    this.streamContent = '';
    this.sendBtn && (this.sendBtn.disabled = false);
    this.sendBtn?.classList.remove('stop-btn');
    this.sendBtn?.setAttribute('title', '发送');

    // 角色回到待机
    window.character?.setState('idle');
    // 把缓冲区剩余文本送入 TTS
    if (this._ttsBuffer && this._ttsBuffer.trim()) {
      window.voiceManager?.enqueue(this._getSpeakableTTSChunk(this._ttsBuffer));
    }
    this._ttsBuffer = '';
    this._scrollToBottom();
  }

  /**
   * 模拟回复（开发模式）
   */
  _simulateReply(userText) {
    const replies = [
      '...嗯，我收到了。不过现在没有连接到 Wired...无法完成操作。',
      '...你说的是这个吗。让我确认一下。',
      '系统状态正常。...还有什么需要的吗。',
      '...这个请求...我需要思考一下。',
      '好的，已经处理了。...你还在那里吗。',
    ];

    const reply = replies[Math.floor(Math.random() * replies.length)];
    let idx = 0;

    const typeInterval = setInterval(() => {
      if (idx < reply.length) {
        this._appendStreamChunk(reply[idx]);
        idx++;
      } else {
        clearInterval(typeInterval);
        this._endStream();
      }
    }, 50);
  }

  /**
   * 显示确认对话框
   */
  showConfirm(message, id) {
    if (this.confirmDialog) {
      this.confirmDialog.classList.remove('hidden');
      this.confirmText.textContent = message;
      this._pendingConfirmId = id;
    }
  }

  /**
   * 处理确认结果
   */
  _resolveConfirm(confirmed) {
    if (this.confirmDialog) {
      this.confirmDialog.classList.add('hidden');
    }

    if (window.electronAPI && this._pendingConfirmId) {
      window.electronAPI.sendConfirmResponse(this._pendingConfirmId, confirmed);
    }

    this.addSystemMessage(confirmed ? '✓ 操作已确认' : '✗ 操作已取消');
    this._pendingConfirmId = null;
  }

  /**
   * 创建消息元素
   */
  _createMessageElement(type, text) {
    const msgEl = document.createElement('div');
    msgEl.className = `message message-${type}`;

    const avatar = type === 'lain' ? 'L' : 'U';
    const renderedText = type === 'lain' ? this._renderMarkdown(text) : this._escapeHtml(text);

    msgEl.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">
        <div class="message-text">${renderedText}</div>
      </div>
    `;
    return msgEl;
  }

  /**
   * 简单 Markdown 渲染
   */
  _renderMarkdown(text) {
    if (!text) return '';

    let html = this._escapeHtml(text);

    // 代码块
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 斜体
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 换行
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  /**
   * HTML 转义
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 滚动到底部
   */
  _scrollToBottom() {
    if (this.messagesContainer) {
      requestAnimationFrame(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      });
    }
  }
}

window.ChatManager = ChatManager;
