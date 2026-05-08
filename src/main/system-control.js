const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class SystemControl {
  constructor(basePath) {
    this.pendingConfirmations = new Map();
    this.basePath = basePath || process.cwd();
    this.workspacePath = path.join(this.basePath, 'lain_workspace');

    if (!fs.existsSync(this.workspacePath)) {
      fs.mkdirSync(this.workspacePath, { recursive: true });
    }
  }

  async execute(command) {
    const { type, params = {}, confirmCallback } = command;

    switch (type) {
      case 'run_command':
        return await this.runCommand(params.cmd, { confirmCallback });
      case 'run_python_file':
        return await this.runPythonFile(params.filePath, {
          args: params.args || [],
          background: params.background,
          timeoutMs: params.timeoutMs,
        });
      case 'open_app':
        return await this.openApp(params.appName);
      case 'close_app':
        return await this.closeApp(params.processName);
      case 'open_url':
        return await this.openURL(params.url);
      case 'open_file':
        return await this.openFile(params.filePath);
      case 'read_file':
        return await this.readFile(params.filePath);
      case 'write_file':
        return await this.writeFile(params.filePath, params.content);
      case 'search_files':
        return await this.searchFiles(params.directory, params.pattern);
      case 'system_info':
        return await this.getSystemInfo();
      case 'list_dir':
        return await this.listDirectory(params.dirPath);
      case 'delete_file': {
        const resolvedPath = this.resolveWorkspacePath(params.filePath);
        if (!this.isInsideWorkspace(resolvedPath)) {
          return { success: false, error: '权限被拒绝：只能删除 lain_workspace 文件夹内的文件。' };
        }
        return { needsConfirm: true, message: `确认删除: ${resolvedPath}` };
      }
      case 'delete_confirmed':
        return await this.deleteFile(params.filePath);
      default:
        return { success: false, error: `未知命令类型: ${type}` };
    }
  }

  resolveWorkspacePath(filePath) {
    if (!filePath) return this.workspacePath;
    if (path.isAbsolute(filePath)) return path.resolve(filePath);

    const normalizedPath = filePath.replace(/[\\/]+/g, path.sep);
    if (normalizedPath === path.basename(this.workspacePath) || normalizedPath.startsWith(`${path.basename(this.workspacePath)}${path.sep}`)) {
      return path.resolve(this.basePath, normalizedPath);
    }

    return path.resolve(this.workspacePath, normalizedPath);
  }

  isInsideWorkspace(filePath) {
    const relativePath = path.relative(this.workspacePath, path.resolve(filePath));
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  }

  runCommand(cmd, { confirmCallback } = {}) {
    const safety = this.assessCommandSafety(cmd);
    if (!safety.safe) {
      return Promise.resolve({
        success: false,
        blocked: true,
        error: safety.reason,
      });
    }

    // 检查是否写入系统目录，需要用户确认
    const writeCheck = this.assessWriteTarget(cmd);
    if (writeCheck.needsConfirm) {
      if (confirmCallback) {
        // 有回调则请求确认
        return confirmCallback(writeCheck.message).then((confirmed) => {
          if (!confirmed) {
            return { success: false, message: '用户取消了该操作', cancelled: true };
          }
          return this._execCommand(cmd);
        });
      }
      // 没有回调则直接拒绝（安全检查）
      return Promise.resolve({
        success: false,
        error: writeCheck.message + ' 如需执行此操作，请在应用中确认。',
      });
    }

    return this._execCommand(cmd);
  }

  _execCommand(cmd) {
    const pythonScript = this.tryParsePythonScriptCommand(cmd);
    if (pythonScript) {
      return this.runPythonFile(pythonScript.filePath, { args: pythonScript.args });
    }

    // 强制 PowerShell 使用 UTF-8，修复中文路径乱码
    const utf8Prefix = '$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';

    return new Promise((resolve) => {
      exec(utf8Prefix + cmd, {
        shell: 'powershell.exe',
        cwd: this.basePath,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
        timeout: 60000,
      }, (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed && error.signal === 'SIGTERM';
          resolve({
            success: false,
            error: timedOut ? '命令运行超过 60 秒，已停止。对于会打开窗口或持续运行的程序，请使用 run_python_file 后台运行。' : error.message,
            output: stdout,
            stderr,
          });
        } else {
          resolve({ success: true, output: stdout, stderr });
        }
      });
    });
  }

  assessCommandSafety(cmd) {
    if (!cmd || typeof cmd !== 'string') {
      return { safe: false, reason: '命令为空，已拒绝执行。' };
    }

    const lower = cmd.trim().replace(/\s+/g, ' ').toLowerCase();
    const blockedPatterns = [
      // === 禁止：删除（任何位置，绝对禁止）===
      { pattern: /\b(remove-item|rm\s|del\s|erase\s|rmdir\s|rd\s|wipe|shred|sdelete)\b/i, reason: '已拦截删除命令。删除只能通过 delete_file 工具在 lain_workspace 内操作。' },
      { pattern: /\b(rm\s+-rf|rm\s+-r\s|del\s+\/f\s+\/s|del\s+\/s\s+\/q)\b/i, reason: '已拦截强制递归删除。' },
      // 注意：move-item、rename-item 已解禁，允许在工作区内操作
      // === 禁止：修改系统 ===
      { pattern: /\b(format-volume|format\s|diskpart|bcdedit|bootrec|cipher\s+\/w)\b/i, reason: '已拦截磁盘/启动配置修改。' },
      { pattern: /\b(reg\s+(delete|add|export|import|load|unload|restore|save)|set-itemproperty|new-itemproperty|remove-itemproperty)\b/i, reason: '已拦截注册表修改。' },
      { pattern: /\b(takeown|icacls|runas\s+\/user)\b/i, reason: '已拦截权限修改。' },
      { pattern: /\b(Set-Service|New-Service|sc\s+(delete|create|config)|schtasks)\b/i, reason: '已拦截服务/计划任务操作。' },
      // === 禁止：绕过安全 ===
      { pattern: /\b(invoke-expression|iex|invoke-command|start-job)\b/i, reason: '已拦截可绕过安全策略的命令。' },
      { pattern: /\b(encodedcommand|frombase64string|frombase64)\b/i, reason: '已拦截编码/混淆命令。' },
      // === 禁止：内联代码 / 嵌套 shell ===
      { pattern: /\b(python|py|python3)\s+(-c|\/c)\b/i, reason: '已拦截内联代码。请写入 lain_workspace 后用 run_python_file。' },
      { pattern: /\b(cmd|powershell|pwsh|bash|wsl)\s+(\/c|-c|-command|-encodedcommand)\b/i, reason: '已拦截嵌套 shell。' },
      { pattern: /\b(curl|wget|iwr|invoke-webrequest)\s+.*\|\s*(sh|bash|cmd|powershell|python)/i, reason: '已拦截管道执行攻击。' },
    ];
    // 允许的命令（非拦截类）：
    // - copy-item：允许，复制不丢失数据
    // - new-item, mkdir：允许，创建文件/目录是正常操作
    // - set-content, add-content, out-file：允许，配合 write_file 工具使用
    // - 所有读取类命令：允许（get-*, dir, ls, cat, type, where, python --version 等）

    for (const item of blockedPatterns) {
      if (item.pattern.test(lower)) {
        return { safe: false, reason: item.reason };
      }
    }

    return { safe: true };
  }

  assessWriteTarget(cmd) {
    // 检测命令是否写入系统盘（C:）且不在 lain_workspace 内
    const writePatterns = [
      /copy-item\s+.*\s+(['"]?)([a-z]:\\(?!.*lain_workspace)[^'"\s]*)\2?/i,
      /set-content\s+.*-path\s+(['"]?)([a-z]:\\(?!.*lain_workspace)[^'"\s]*)\2?/i,
      /out-file\s+-filepath\s+(['"]?)([a-z]:\\(?!.*lain_workspace)[^'"\s]*)\2?/i,
      /new-item\s+.*-path\s+(['"]?)([a-z]:\\(?!.*lain_workspace)[^'"\s]*)\2?/i,
      /add-content\s+.*-path\s+(['"]?)([a-z]:\\(?!.*lain_workspace)[^'"\s]*)\2?/i,
      />\s*([a-z]:\\(?!.*lain_workspace)[^&\s]*)/i,
    ];

    for (const pat of writePatterns) {
      const match = cmd.match(pat);
      if (match) {
        const target = match[2] || match[1];
        const dir = target ? target.replace(/\\[^\\]*$/, '\\') : 'C:\\';
        return {
          needsConfirm: true,
          message: `即将写入系统目录: ${dir}\n\n此操作会将文件写入工作区外的系统盘。确定要继续吗？`,
        };
      }
    }

    return { needsConfirm: false };
  }

  tryParsePythonScriptCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return null;

    const match = cmd.trim().match(/^(?:py(?:\s+-3)?|python3?|python\.exe)\s+(?:"([^"]+\.py)"|'([^']+\.py)'|([^\s]+\.py))(.*)$/i);
    if (!match) return null;

    const filePath = match[1] || match[2] || match[3];
    const trailing = (match[4] || '').trim();
    const args = trailing ? trailing.match(/"[^"]*"|'[^']*'|\S+/g).map(arg => arg.replace(/^['"]|['"]$/g, '')) : [];
    return { filePath, args };
  }

  getPythonLaunchers() {
    return [
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ];
  }

  shouldRunPythonInBackground(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return /\b(turtle|tkinter|pygame|PyQt|PySide)\b|matplotlib\.pyplot|cv2\.imshow|\.mainloop\s*\(/.test(content);
    } catch (error) {
      return false;
    }
  }

  assessPythonFileSafety(filePath) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return { safe: false, reason: error.message };
    }

    const blockedPatterns = [
      // 删除文件（移动/重命名已解禁）
      { pattern: /\b(os\.(remove|unlink|rmdir|removedirs|replace)|shutil\.(rmtree)|Path\s*\([^)]*\)\.(unlink|rmdir))\b/i, reason: '已拦截包含删除文件的 Python 脚本。' },
      // 启动子进程/系统调用
      { pattern: /\b(os\.(system|popen|execl|execle|execlp|execlpe|execv|execve|execvp|execvpe|spawnl|spawnle|spawnlp|spawnlpe|spawnv|spawnve|spawnvp|spawnvpe)|subprocess\.)\b/i, reason: '已拦截包含系统调用的 Python 脚本。' },
      // 写入文件
      { pattern: /\b(Path\s*\([^)]*\)\.(write_text|write_bytes)|shutil\.(copy|copy2|copytree|make_archive))\b/i, reason: '已拦截包含文件写入的 Python 脚本。请使用受限的 write_file 工具。' },
      // 内嵌高危命令
      { pattern: /\b(remove-item|rm\s+|del\s+|rmdir\s+|format-volume|diskpart|reg\s+(delete|add)|takeown|icacls|schtasks)\b/i, reason: '已拦截包含高危命令的 Python 脚本。' },
      // 下载+执行（仅拦截下载后立即执行的组合，允许单纯下载）
      { pattern: /\b(urllib\.request\.urlretrieve|requests\.get|wget\.download).*(\bexec\b|\beval\b|\bos\.system\b|\bsubprocess\b)/i, reason: '已拦截网络下载后立即执行的模式。下载文件本身是允许的。' },
    ];
    // 允许读取/查看系统路径，不再拦截 c:\ 等路径引用

    for (const item of blockedPatterns) {
      if (item.pattern.test(content)) {
        return { safe: false, reason: item.reason };
      }
    }

    return { safe: true };
  }

  runPythonFile(filePath, options = {}) {
    const resolvedPath = this.resolveWorkspacePath(filePath);
    const args = Array.isArray(options.args) ? options.args : [];
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;

    if (!this.isInsideWorkspace(resolvedPath)) {
      return Promise.resolve({ success: false, error: '权限被拒绝：只能运行 lain_workspace 文件夹内的 Python 文件。' });
    }

    if (path.extname(resolvedPath).toLowerCase() !== '.py') {
      return Promise.resolve({ success: false, error: '只能通过 run_python_file 运行 .py 文件。' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return Promise.resolve({ success: false, error: `文件不存在: ${resolvedPath}` });
    }

    const safety = this.assessPythonFileSafety(resolvedPath);
    if (!safety.safe) {
      return Promise.resolve({
        success: false,
        blocked: true,
        error: safety.reason,
      });
    }

    const runInBackground = typeof options.background === 'boolean'
      ? options.background
      : this.shouldRunPythonInBackground(resolvedPath);

    if (runInBackground) {
      return this.runPythonInBackground(resolvedPath, args);
    }

    return this.runPythonWithLaunchers(resolvedPath, args, timeoutMs);
  }

  async runPythonWithLaunchers(resolvedPath, args, timeoutMs) {
    let lastStartupError = null;

    for (const launcher of this.getPythonLaunchers()) {
      const result = await this.runPythonWithLauncher(launcher, resolvedPath, args, timeoutMs);
      if (result.startupError) {
        lastStartupError = result.error;
        continue;
      }
      return result;
    }

    return {
      success: false,
      error: lastStartupError || '没有找到可用的 Python。请安装 Python，或确认 py/python 命令在 PATH 中可用。',
    };
  }

  async runPythonInBackground(resolvedPath, args) {
    let lastStartupError = null;

    for (const launcher of this.getPythonLaunchers()) {
      const result = await this.startBackgroundPython(launcher, resolvedPath, args);
      if (result.startupError) {
        lastStartupError = result.error;
        continue;
      }
      return result;
    }

    return {
      success: false,
      error: lastStartupError || '没有找到可用的 Python。请安装 Python，或确认 py/python 命令在 PATH 中可用。',
    };
  }

  startBackgroundPython(launcher, resolvedPath, args) {
    return new Promise((resolve) => {
      let settled = false;
      let child;

      try {
        child = spawn(launcher.command, [...launcher.args, resolvedPath, ...args], {
          cwd: this.workspacePath,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
      } catch (error) {
        resolve({
          success: false,
          startupError: error.code === 'ENOENT',
          error: error.message,
        });
        return;
      }

      child.once('error', error => {
        if (settled) return;
        settled = true;
        resolve({
          success: false,
          startupError: error.code === 'ENOENT',
          error: error.message,
        });
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({
          success: true,
          background: true,
          pid: child.pid,
          message: `Python 文件已在独立窗口/后台启动: ${resolvedPath}`,
        });
      }, 300);
    });
  }

  runPythonWithLauncher(launcher, resolvedPath, args, timeoutMs) {
    return new Promise((resolve) => {
      const child = spawn(launcher.command, [...launcher.args, resolvedPath, ...args], {
        cwd: this.workspacePath,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          child.kill();
          resolve({
            success: false,
            error: `Python 文件运行超过 ${Math.round(timeoutMs / 1000)} 秒，已停止。`,
            output: stdout,
            stderr,
          });
        }
      }, timeoutMs);

      child.stdout.on('data', data => {
        stdout += data.toString();
      });
      child.stderr.on('data', data => {
        stderr += data.toString();
      });
      child.on('error', error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          success: false,
          startupError: error.code === 'ENOENT',
          error: error.message,
          output: stdout,
          stderr,
        });
      });
      child.on('close', code => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          success: code === 0,
          output: stdout,
          stderr,
          error: code === 0 ? undefined : `Python 进程退出码: ${code}`,
        });
      });
    });
  }

  async openApp(appName) {
    try {
      exec(`start "" "${appName}"`, { shell: 'cmd.exe', cwd: this.basePath });
      return { success: true, message: `已启动 ${appName}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async closeApp(processName) {
    return this.runCommand(`Stop-Process -Name "${processName}" -Force -ErrorAction SilentlyContinue`);
  }

  async openURL(url) {
    const { shell } = require('electron');
    try {
      await shell.openExternal(url);
      return { success: true, message: `已打开 ${url}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async openFile(filePath) {
    const { shell } = require('electron');
    try {
      const resolvedPath = this.resolveWorkspacePath(filePath);
      await shell.openPath(resolvedPath);
      return { success: true, message: `已打开 ${resolvedPath}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async readFile(filePath) {
    try {
      const resolvedPath = this.resolveWorkspacePath(filePath);
      const content = fs.readFileSync(resolvedPath, 'utf8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async writeFile(filePath, content) {
    try {
      const resolvedPath = this.resolveWorkspacePath(filePath);
      if (!this.isInsideWorkspace(resolvedPath)) {
        return { success: false, error: '权限被拒绝：只能在 lain_workspace 文件夹内新建或修改文件。' };
      }

      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, content, 'utf8');
      return { success: true, message: `文件已保存: ${resolvedPath}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async searchFiles(directory, pattern) {
    const resolvedPath = this.resolveWorkspacePath(directory);
    return this.runCommand(`Get-ChildItem -Path "${resolvedPath}" -Filter "${pattern}" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime | ConvertTo-Json`);
  }

  async listDirectory(dirPath) {
    const resolvedPath = this.resolveWorkspacePath(dirPath);
    return this.runCommand(`Get-ChildItem -Path "${resolvedPath}" | Select-Object Name, Mode, Length, LastWriteTime | ConvertTo-Json`);
  }

  async deleteFile(filePath) {
    try {
      const resolvedPath = this.resolveWorkspacePath(filePath);
      if (!this.isInsideWorkspace(resolvedPath)) {
        return { success: false, error: '权限被拒绝：只能删除 lain_workspace 文件夹内的文件。' };
      }

      if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath);
        if (stats.isDirectory()) {
          fs.rmSync(resolvedPath, { recursive: true });
        } else {
          fs.unlinkSync(resolvedPath);
        }
        return { success: true, message: `已删除: ${resolvedPath}` };
      }
      return { success: false, error: '文件不存在。' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getSystemInfo() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const info = {
      platform: os.platform(),
      hostname: os.hostname(),
      arch: os.arch(),
      cpuModel: cpus[0]?.model || 'Unknown',
      cpuCores: cpus.length,
      totalMemory: `${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
      usedMemory: `${(usedMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
      memoryUsage: `${((usedMem / totalMem) * 100).toFixed(1)}%`,
      uptime: `${(os.uptime() / 3600).toFixed(1)} 小时`,
      homeDir: os.homedir(),
      tempDir: os.tmpdir(),
    };

    try {
      const diskResult = await this.runCommand(
        `Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='UsedGB';E={[math]::Round($_.Used/1GB,1)}}, @{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json`
      );
      if (diskResult.success) {
        info.disks = diskResult.output;
      }
    } catch (error) {
      // Disk info is optional.
    }

    return { success: true, info };
  }

  resolveConfirmation(id, confirmed) {
    const resolver = this.pendingConfirmations.get(id);
    if (resolver) {
      resolver(confirmed);
      this.pendingConfirmations.delete(id);
    }
  }
}

module.exports = { SystemControl };
