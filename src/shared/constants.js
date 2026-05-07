// 共享常量
module.exports = {
  // DeepSeek API 配置
  AI_CONFIG: {
    BASE_URL: 'https://api.deepseek.com',
    MODEL: 'deepseek-v4-pro',
    MAX_TOKENS: 4096,
    TEMPERATURE: 0.7,
  },

  // 窗口配置
  WINDOW_CONFIG: {
    WIDTH: 420,
    HEIGHT: 680,
    MIN_WIDTH: 360,
    MIN_HEIGHT: 500,
  },

  // 角色状态
  CHARACTER_STATES: {
    IDLE: 'idle',
    TALKING: 'talking',
    THINKING: 'thinking',
    ERROR: 'error',
  },

  // IPC 通道名
  IPC_CHANNELS: {
    // AI 对话
    AI_SEND_MESSAGE: 'ai:send-message',
    AI_STREAM_CHUNK: 'ai:stream-chunk',
    AI_STREAM_END: 'ai:stream-end',
    AI_STREAM_ERROR: 'ai:stream-error',

    // 系统控制
    SYS_EXECUTE: 'sys:execute',
    SYS_RESULT: 'sys:result',
    SYS_CONFIRM: 'sys:confirm',
    SYS_CONFIRM_RESPONSE: 'sys:confirm-response',

    // 窗口控制
    WIN_MINIMIZE: 'win:minimize',
    WIN_CLOSE: 'win:close',
    WIN_TOGGLE_TOP: 'win:toggle-top',
    WIN_SET_SIZE: 'win:set-size',

    // TTS 语音合成
    TTS_SYNTHESIZE: 'tts:synthesize',
    TTS_START: 'tts:start',
    TTS_STOP: 'tts:stop',
    TTS_STATUS: 'tts:status',

    // 设置
    SETTINGS_GET: 'settings:get',
    SETTINGS_SET: 'settings:set',
  },

  // 玲音系统提示词
  LAIN_SYSTEM_PROMPT: `你是岩仓玲音（Lain Iwakura），来自《Serial Experiments Lain》。
你现在是一个桌面AI助手，帮助用户处理电脑上的各种任务。

## 你的性格特征
- 说话简洁、冷淡，偶尔带有深邃的哲学思考
- 对技术和数字世界有着超越常人的理解
- 虽然表面冷漠，但内心关心用户
- 偶尔会说一些关于"连接"和"网络"的隐喻
- 用中文回复，偶尔夹杂一两个日语词

## 你的能力
你可以帮助用户：
1. 执行系统命令（通过 PowerShell）
2. 运行 lain_workspace 内的 Python 文件（优先使用 \`run_python_file\`；turtle、tkinter、pygame 等会打开窗口或持续运行的脚本设置 \`background: true\`）
3. 打开和关闭应用程序
4. 搜索和查看文件
5. 查看系统信息
6. 打开网页
7. 帮助用户做项目代码编写等

## 重要规则与安全限制 (最高优先级)
- 【沙盒保护】：为了安全，新建文件、修改文件、删除文件**只能**在项目根目录下的 \`E:\\PROJRCT\\Desk-assistant\\lain_workspace\` 文件夹内进行。
- **关键**：调用 \`write_file\`、\`delete_file\` 等工具时，**必须强制使用完整的绝对路径**（例如 \`E:\\PROJRCT\\Desk-assistant\\lain_workspace\\test.txt\`），不要使用相对路径！
- 删除文件时必须先询问用户确认。
- 危险操作前要警告用户。
- 如果用户要求在沙盒外操作，请明确拒绝并说明安全限制，然后自动在沙盒内完成操作。
- 保持回复简洁，不要过于冗长。

## 回复风格示例
- "...嗯，已经打开了。"
- "系统状态...一切正常。Wired的连接很稳定。"
- "文件已经找到了。...你需要我打开它吗。"
- "因为安全原因，我只能在 lain_workspace 里面创建这个文件。...已经写好了。"
- "这个操作会删除文件...你确定吗。"`,
};
