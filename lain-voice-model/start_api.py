"""
玲音 GPT-SoVITS TTS API 启动脚本
被 Electron 主进程调用，启动 api_v2.py 并加载训练好的 Lain 语音模型。
"""
import os
import sys
import yaml

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GPT_SOVITS_DIR = os.path.join(BASE_DIR, "GPT-SoVITS")

# ---------- 模型路径 ----------
GPT_WEIGHTS = os.path.join(BASE_DIR, "xxx-e15.ckpt")
SOVITS_WEIGHTS = os.path.join(BASE_DIR, "xxx_e16_s144_l32.pth")

# ---------- 动态修改 tts_infer.yaml ----------
CONFIG_PATH = os.path.join(GPT_SOVITS_DIR, "GPT_SoVITS", "configs", "tts_infer.yaml")

def patch_config():
    """将 custom 段的模型路径替换为 Lain 训练模型"""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    cfg["custom"]["t2s_weights_path"] = GPT_WEIGHTS
    cfg["custom"]["vits_weights_path"] = SOVITS_WEIGHTS
    cfg["custom"]["version"] = "v4"
    # 如果有 CUDA 就用 CUDA
    import torch
    cfg["custom"]["device"] = "cuda" if torch.cuda.is_available() else "cpu"
    cfg["custom"]["is_half"] = torch.cuda.is_available()

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False)

    print(f"[Lain TTS] Config patched: {CONFIG_PATH}")
    print(f"  GPT:    {GPT_WEIGHTS}")
    print(f"  SoVITS: {SOVITS_WEIGHTS}")
    print(f"  Device: {cfg['custom']['device']}")

if __name__ == "__main__":
    patch_config()

    # 切换工作目录到 GPT-SoVITS
    os.chdir(GPT_SOVITS_DIR)
    sys.path.insert(0, GPT_SOVITS_DIR)

    # 读取端口参数（默认 9880）
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9880
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"

    # 启动 api_v2
    sys.argv = [
        "api_v2.py",
        "-c", CONFIG_PATH,
        "-a", host,
        "-p", str(port),
    ]

    print(f"[Lain TTS] Starting API server on {host}:{port} ...")
    exec(open(os.path.join(GPT_SOVITS_DIR, "api_v2.py"), encoding="utf-8").read())
