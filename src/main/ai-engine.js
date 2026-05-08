const Store = require('electron-store');
const { AI_CONFIG, LAIN_SYSTEM_PROMPT } = require('../shared/constants');

// Function Calling 工具定义
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在用户电脑上执行低风险 PowerShell 命令。只能用于查看信息或启动普通程序；删除、写入、移动文件、注册表、磁盘、权限修改、嵌套 shell、编码命令等会被安全策略拦截。',
      parameters: {
        type: 'object',
        properties: {
          cmd: {
            type: 'string',
            description: '要执行的 PowerShell 命令',
          },
        },
        required: ['cmd'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_python_file',
      description: '运行 lain_workspace 内的 Python 文件。普通脚本会等待并返回输出；turtle、tkinter、pygame 等会打开窗口或持续运行的脚本应设置 background=true。',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '要运行的 .py 文件路径，可以是 lain_workspace 内的相对路径或完整路径',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: '传给 Python 脚本的命令行参数',
          },
          background: {
            type: 'boolean',
            description: '脚本会打开窗口或持续运行时设为 true，例如 turtle 烟花、pygame 游戏、tkinter 界面',
          },
          timeoutMs: {
            type: 'number',
            description: '普通脚本等待完成的超时时间，默认 30000 毫秒',
          },
        },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: '打开一个应用程序，例如 notepad, calc, mspaint, explorer 等',
      parameters: {
        type: 'object',
        properties: {
          appName: {
            type: 'string',
            description: '应用程序名称或路径',
          },
        },
        required: ['appName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_app',
      description: '关闭一个正在运行的应用程序进程',
      parameters: {
        type: 'object',
        properties: {
          processName: {
            type: 'string',
            description: '进程名称（不含.exe），如 notepad, chrome',
          },
        },
        required: ['processName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_url',
      description: '在默认浏览器中打开一个网页URL',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要打开的网址',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_file',
      description: '用默认程序打开一个文件或文件夹',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件或文件夹的完整路径',
          },
        },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取一个文件的内容',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件的完整路径',
          },
        },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '创建或覆盖写入一个文件',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '文件的完整路径',
          },
          content: {
            type: 'string',
            description: '要写入的文件内容',
          },
        },
        required: ['filePath', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在指定目录中搜索文件',
      parameters: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: '搜索的目录路径',
          },
          pattern: {
            type: 'string',
            description: '文件名匹配模式，如 *.txt, *.py',
          },
        },
        required: ['directory', 'pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出一个目录中的所有文件和子目录',
      parameters: {
        type: 'object',
        properties: {
          dirPath: {
            type: 'string',
            description: '目录的完整路径',
          },
        },
        required: ['dirPath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_info',
      description: '获取系统信息，包括CPU、内存、磁盘使用情况等',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '【危险操作】删除文件或文件夹。此操作需要用户最高权限确认，必须等待用户明确同意后才能执行。',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: '要删除的文件或文件夹路径',
          },
        },
        required: ['filePath'],
      },
    },
  },
];

class AIEngine {
  constructor(systemControl, mainWindow) {
    this.store = new Store();
    this.systemControl = systemControl;
    this.mainWindow = mainWindow;
    this.conversationHistory = [];
    this.maxHistory = Infinity;
    this.client = null;
    this._aborted = false;
    this._clientReady = this._initClient();
  }

  abort() {
    this._aborted = true;
  }

  async _initClient() {
    let apiKey = this.store.get('apiKey') || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      try {
        const fs = require('fs');
        const path = require('path');
        const envPath = path.join(__dirname, '..', '..', '.env.example');
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf-8');
          const match = envContent.match(/DEEPSEEK_API_KEY=([^\r\n]+)/);
          if (match && match[1]) apiKey = match[1].trim();
        }
      } catch (e) {
        console.error('Failed to read .env.example:', e);
      }
    }

    const baseURL = this.store.get('baseURL', AI_CONFIG.BASE_URL);
    if (['deepseek-reasoner', 'deepseek-v4-flash'].includes(this.store.get('model'))) {
      this.store.set('model', AI_CONFIG.MODEL);
    }

    if (!apiKey) {
      this.client = null;
      return;
    }

    const { default: OpenAI } = await import('openai');
    this.client = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL,
    });
  }

  /**
   * 设置主窗口引用（用于发送确认请求）
   */
  setMainWindow(win) {
    this.mainWindow = win;
  }

  _getModel() {
    return this.store.get('model', AI_CONFIG.MODEL);
  }

  _formatAPIError(error) {
    const status = error?.status ? `HTTP ${error.status}: ` : '';
    const message = error?.error?.message || error?.message || String(error);
    return `${status}${message}`;
  }

  _stripDSML(content) {
    if (!content || typeof content !== 'string') return '';
    return content
      .replace(/<[/]?\s*(invoke|parameter|tool_calls|DSML)[^>]*>/gi, '')
      .replace(/<\/\s*(invoke|parameter|tool_calls|DSML)\s*>/gi, '')
      .trim();
  }

  _parseTextToolCalls(content) {
    if (!content || typeof content !== 'string') return [];
    if (!content.includes('tool_calls') && !content.includes('invoke name=')) return [];

    // 匹配所有 invoke 块（支持多个工具调用）
    const results = [];
    const invokeRegex = /<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke\s*>/gi;
    let invokeMatch;
    while ((invokeMatch = invokeRegex.exec(content)) !== null) {
      const name = invokeMatch[1];
      const inner = invokeMatch[2];
      const params = {};
      const paramRegex = /<parameter\s+name="([^"]+)"[^>]*>([^<]*)<\/parameter\s*>/gi;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(inner)) !== null) {
        params[paramMatch[1]] = this._coerceToolParam(paramMatch[2].trim());
      }
      if (name) results.push({ name, args: params });
    }

    // 兼容自闭合/无闭合标签的格式
    if (results.length === 0) {
      const simpleMatch = content.match(/invoke\s+name="([^"]+)"/i);
      if (simpleMatch) {
        const params = {};
        const paramRegex = /parameter\s+name="([^"]+)"[^>]*>([^<]*)/gi;
        let m;
        while ((m = paramRegex.exec(content)) !== null) {
          params[m[1]] = this._coerceToolParam(m[2].trim());
        }
        results.push({ name: simpleMatch[1], args: params });
      }
    }

    return results;
  }

  _trimHistory(history, maxLen) {
    if (history.length <= maxLen) return history;

    let start = history.length - maxLen;
    // 如果截断后第一条是 tool 消息，向前多保留一条（其对应的 assistant tool_calls）
    if (start > 0 && history[start]?.role === 'tool') {
      start = Math.max(0, start - 1);
    }
    return history.slice(start);
  }

  _validateMessages(context) {
    const msgs = this.conversationHistory;
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      if (msg.role === 'tool') {
        // tool 消息前必须是 assistant 且含有 tool_calls
        const prev = msgs[i - 1];
        if (!prev || prev.role !== 'assistant' || !prev.tool_calls) {
          console.error(`[VALIDATE ${context}] 错误: tool 消息(i=${i})前缺少 assistant(tool_calls)`);
        }
        // 必须有 tool_call_id
        if (!msg.tool_call_id) {
          console.error(`[VALIDATE ${context}] 错误: tool 消息(i=${i})缺少 tool_call_id`);
        }
      }
    }
  }

  _coerceToolParam(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value;
  }

  _formatToolResult(funcName, result) {
    if (result?.success) {
      if (result.output) return result.output;
      if (result.message) return result.message;
      if (result.background) return `${funcName} 已在后台启动。`;
      return '操作已完成。';
    }

    return `操作失败：${result?.error || result?.message || '未知错误'}`;
  }

  /**
   * 发送消息并流式返回，支持 Function Calling
   */
  async sendMessage(userMessage, onChunk) {
    await this._clientReady;
    this._aborted = false;

    if (!this.client) {
      throw new Error('未配置 API Key。请在本机设置 DEEPSEEK_API_KEY 环境变量，或在应用设置中保存 apiKey。');
    }

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    if (this.conversationHistory.length > this.maxHistory) {
      // 裁剪时保持 tool_calls/tool 消息配对
      this.conversationHistory = this._trimHistory(this.conversationHistory, this.maxHistory);
    }

    const messages = [
      { role: 'system', content: LAIN_SYSTEM_PROMPT },
      ...this.conversationHistory,
    ];

    try {
      // 第一次调用：可能返回 function call 或直接回复
      const response = await this.client.chat.completions.create({
        model: this._getModel(),
        messages: messages,
        max_tokens: AI_CONFIG.MAX_TOKENS,
        temperature: AI_CONFIG.TEMPERATURE,
        tools: TOOLS,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      const message = choice.message;

      // 标准 OpenAI function calling 格式（优先）
      if (message.tool_calls && message.tool_calls.length > 0) {
        this.conversationHistory.push(message);

        // 遍历所有工具调用，逐个执行并推送 tool 消息
        const toolResults = [];
        for (const toolCall of message.tool_calls) {
          if (this._aborted) break;

          const funcName = toolCall.function.name;
          const funcArgs = JSON.parse(toolCall.function.arguments);

          onChunk(`\n...正在执行: ${this._getActionDescription(funcName, funcArgs)}\n`);

          let toolResult;
          try {
            toolResult = await this._executeTool(funcName, funcArgs);
          } catch (err) {
            toolResult = { success: false, error: err.message };
          }
          toolResults.push({ id: toolCall.id, result: toolResult, name: funcName });

          // 每个 tool_call 必须对应一条 tool 消息
          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }
        if (this._aborted) { onChunk('\n\n_已停止。_'); return ''; }

        // 第二次调用：让 AI 根据所有工具结果生成最终回复
        try {
          // 发送前校验消息序列
          this._validateMessages('before second call');

          const finalMessages = [
            { role: 'system', content: LAIN_SYSTEM_PROMPT },
            ...this.conversationHistory,
          ];

          const stream = await this.client.chat.completions.create({
            model: this._getModel(),
            messages: finalMessages,
            max_tokens: AI_CONFIG.MAX_TOKENS,
            temperature: AI_CONFIG.TEMPERATURE,
            stream: true,
          });

          let fullResponse = '';
          for await (const chunk of stream) {
            if (this._aborted) break;
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              onChunk(content);
            }
          }
          if (this._aborted) { onChunk('\n\n_已停止。_'); return fullResponse; }

          if (!fullResponse.trim()) {
            // 汇总所有工具结果
            fullResponse = toolResults
              .map(tr => this._formatToolResult(tr.name, tr.result))
              .join('\n');
            for (let i = 0; i < fullResponse.length; i++) {
              onChunk(fullResponse[i]);
              await new Promise(r => setTimeout(r, 10));
            }
          }

          this.conversationHistory.push({
            role: 'assistant',
            content: fullResponse,
          });

          return fullResponse;
        } catch (streamErr) {
          console.error('Second API call failed:', streamErr.message);
          const fallback = toolResults
            .map(tr => this._formatToolResult(tr.name, tr.result))
            .join('\n');
          this.conversationHistory.push({
            role: 'assistant',
            content: fallback,
          });
          for (let i = 0; i < fallback.length; i++) {
            onChunk(fallback[i]);
            await new Promise(r => setTimeout(r, 10));
          }
          return fallback;
        }
      } else {
        // 检查文本格式工具调用（DSML 等非标准格式）
        const textToolCalls = this._parseTextToolCalls(message.content);
        if (textToolCalls.length > 0) {
          return await this._handleTextToolCalls(textToolCalls, onChunk, message.content);
        }

        // AI 直接回复文字（过滤掉 DSML 标签）
        const content = this._stripDSML(message.content || '');
        this.conversationHistory.push({
          role: 'assistant',
          content: content,
        });

        for (let i = 0; i < content.length; i++) {
          if (this._aborted) { onChunk('\n\n_已停止。_'); break; }
          onChunk(content[i]);
          await new Promise(r => setTimeout(r, 15));
        }

        return content;
      }
    } catch (error) {
      console.error('AI Engine Error:', error);
      this.conversationHistory.pop();
      throw new Error(this._formatAPIError(error));
    }
  }

  async _handleTextToolCalls(toolCalls, onChunk, rawContent) {
    // 提取 DSML 之前的文本
    const prefix = rawContent ? this._stripDSML(rawContent.split(/<invoke|<tool_calls/i)[0]) : '';
    if (prefix) {
      onChunk(prefix + '\n');
    }

    const allResults = [];
    for (const tc of toolCalls) {
      if (this._aborted) break;

      const funcName = tc.name;
      const funcArgs = tc.args;

      this.conversationHistory.push({
        role: 'assistant',
        content: `[tool_call:${funcName}]`,
      });

      onChunk(`\n...正在执行: ${this._getActionDescription(funcName, funcArgs)}\n`);

      try {
        const toolResult = await this._executeTool(funcName, funcArgs);
        const resultText = this._formatToolResult(funcName, toolResult);
        allResults.push(resultText);

        for (let i = 0; i < resultText.length; i++) {
          if (this._aborted) break;
          onChunk(resultText[i]);
          await new Promise(r => setTimeout(r, 10));
        }
        onChunk('\n');
      } catch (err) {
        const errorText = `操作失败: ${err.message}`;
        allResults.push(errorText);
        onChunk(errorText);
      }
    }

    const finalText = allResults.join('\n') || '操作已完成。';
    this.conversationHistory.push({
      role: 'assistant',
      content: finalText,
    });

    return finalText;
  }

  /**
   * 执行工具调用
   */
  async _executeTool(funcName, args) {
    // 删除操作需要用户确认
    if (funcName === 'delete_file') {
      const confirmed = await this._requestUserConfirmation(
        `即将删除: ${args.filePath}\n\n此操作不可撤销！确认删除吗？`
      );
      if (!confirmed) {
        return { success: false, message: '用户取消了删除操作', cancelled: true };
      }
      return await this.systemControl.execute({ type: 'delete_confirmed', params: args });
    }

    // run_command 可能需要确认（写入系统盘）
    if (funcName === 'run_command') {
      const result = await this.systemControl.execute({
        type: 'run_command',
        params: args,
        confirmCallback: (msg) => this._requestUserConfirmation(msg),
      });
      return result;
    }

    // 其他操作直接执行
    return await this.systemControl.execute({ type: funcName, params: args });
  }

  /**
   * 请求用户确认（删除操作 — 最高权限）
   */
  _requestUserConfirmation(message) {
    return new Promise((resolve) => {
      const confirmId = `confirm_${Date.now()}`;

      const { ipcMain } = require('electron');
      const channel = 'sys:confirm-response';

      const handler = (event, data) => {
        if (data.id === confirmId) {
          ipcMain.removeListener(channel, handler);
          resolve(data.confirmed);
        }
      };
      ipcMain.on(channel, handler);

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('sys:confirm', {
          id: confirmId,
          message: `⚠️ 【权限确认】\n\n${message}`,
        });
      } else {
        resolve(false);
      }

      setTimeout(() => {
        ipcMain.removeListener(channel, handler);
        resolve(false);
      }, 60000);
    });
  }

  /**
   * 获取操作描述
   */
  _getActionDescription(funcName, args) {
    const descriptions = {
      run_command: `执行命令 "${args.cmd?.substring(0, 50)}${args.cmd?.length > 50 ? '...' : ''}"`,
      run_python_file: `运行 Python 文件 ${args.filePath}`,
      open_app: `打开 ${args.appName}`,
      close_app: `关闭 ${args.processName}`,
      open_url: `打开网页 ${args.url}`,
      open_file: `打开文件 ${args.filePath}`,
      read_file: `读取文件 ${args.filePath}`,
      write_file: `写入文件 ${args.filePath}`,
      search_files: `在 ${args.directory} 中搜索 ${args.pattern}`,
      list_dir: `列出目录 ${args.dirPath}`,
      system_info: '获取系统信息',
      delete_file: `⚠️ 请求删除 ${args.filePath}`,
    };
    return descriptions[funcName] || funcName;
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  async updateConfig(apiKey, baseURL, model) {
    if (apiKey) this.store.set('apiKey', apiKey);
    if (baseURL) this.store.set('baseURL', baseURL);
    if (model) this.store.set('model', model);
    this._clientReady = this._initClient();
    await this._clientReady;
  }
}

module.exports = { AIEngine };
