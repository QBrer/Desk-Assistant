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
    this.maxHistory = 30;
    this.client = null;
    this._clientReady = this._initClient();
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

  _parseTextToolCall(content) {
    if (!content || typeof content !== 'string') return null;
    if (!content.includes('tool_calls') && !content.includes('invoke name=')) return null;

    const invokeMatch = content.match(/invoke\s+name="([^"]+)"/i);
    if (!invokeMatch) return null;

    const params = {};
    const paramRegex = /parameter\s+name="([^"]+)"[^>]*>([^<]*)/gi;
    let match;
    while ((match = paramRegex.exec(content)) !== null) {
      params[match[1]] = this._coerceToolParam(match[2].trim());
    }

    return { name: invokeMatch[1], args: params };
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

    if (!this.client) {
      throw new Error('未配置 API Key。请在本机设置 DEEPSEEK_API_KEY 环境变量，或在应用设置中保存 apiKey。');
    }

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    if (this.conversationHistory.length > this.maxHistory) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistory);
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
      const textToolCall = this._parseTextToolCall(message.content);

      // 如果 AI 想调用工具
      if (message.tool_calls && message.tool_calls.length > 0) {
        // 把 AI 的工具调用意图加入历史
        this.conversationHistory.push(message);

        // 通知前端 AI 正在执行操作
        const toolCall = message.tool_calls[0];
        const funcName = toolCall.function.name;
        const funcArgs = JSON.parse(toolCall.function.arguments);

        onChunk(`...正在执行操作: ${this._getActionDescription(funcName, funcArgs)}\n\n`);

        // 执行工具调用
        const toolResult = await this._executeTool(funcName, funcArgs);

        // 把工具结果加入历史
        this.conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });

        // 第二次调用：让 AI 根据工具结果生成最终回复（流式）
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
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            onChunk(content);
          }
        }

        this.conversationHistory.push({
          role: 'assistant',
          content: fullResponse,
        });

        return fullResponse;
      } else if (textToolCall) {
        const funcName = textToolCall.name;
        const funcArgs = textToolCall.args;

        this.conversationHistory.push({
          role: 'assistant',
          content: `[tool_call:${funcName}]`,
        });

        onChunk(`...正在执行操作: ${this._getActionDescription(funcName, funcArgs)}\n\n`);

        const toolResult = await this._executeTool(funcName, funcArgs);
        const finalText = this._formatToolResult(funcName, toolResult);

        for (let i = 0; i < finalText.length; i++) {
          onChunk(finalText[i]);
          await new Promise(r => setTimeout(r, 10));
        }

        this.conversationHistory.push({
          role: 'assistant',
          content: finalText,
        });

        return finalText;
      } else {
        // AI 直接回复文字（非工具调用），流式输出
        // 由于第一次已经是非流式调用，这里直接拿内容做打字效果
        const content = message.content || '';
        this.conversationHistory.push({
          role: 'assistant',
          content: content,
        });

        // 模拟流式输出（逐字符）
        for (let i = 0; i < content.length; i++) {
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

  /**
   * 执行工具调用
   */
  async _executeTool(funcName, args) {
    // 删除操作需要用户确认
    if (funcName === 'delete_file') {
      const confirmed = await this._requestUserConfirmation(args.filePath);
      if (!confirmed) {
        return { success: false, message: '用户拒绝了删除操作', cancelled: true };
      }
      // 用户确认后执行删除
      return await this.systemControl.execute({ type: 'delete_confirmed', params: args });
    }

    // 其他操作直接执行
    return await this.systemControl.execute({ type: funcName, params: args });
  }

  /**
   * 请求用户确认（删除操作 — 最高权限）
   */
  _requestUserConfirmation(filePath) {
    return new Promise((resolve) => {
      const confirmId = `confirm_${Date.now()}`;

      // 注册一次性监听器
      const { ipcMain } = require('electron');
      const channel = 'sys:confirm-response';

      const handler = (event, data) => {
        if (data.id === confirmId) {
          ipcMain.removeListener(channel, handler);
          resolve(data.confirmed);
        }
      };
      ipcMain.on(channel, handler);

      // 发送确认请求到渲染进程
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('sys:confirm', {
          id: confirmId,
          filePath: filePath,
          message: `⚠️ 【最高权限确认】\n\n即将删除: ${filePath}\n\n此操作不可撤销！确认删除吗？`,
        });
      } else {
        resolve(false);
      }

      // 超时 60 秒自动拒绝
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
