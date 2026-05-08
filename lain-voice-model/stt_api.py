"""
本地 Whisper 语音识别 API 服务
被 Electron 主进程调用，使用 openai-whisper tiny 模型在 CPU 上运行。
"""
import sys
import os
import tempfile
import time
import torch
from fastapi import FastAPI, UploadFile, File
import uvicorn
import whisper

MODEL_SIZE = "tiny"
DEVICE = "cpu"

print(f"[STT] Loading openai-whisper model: {MODEL_SIZE} on {DEVICE}...")
model = whisper.load_model(MODEL_SIZE, device=DEVICE)
print("[STT] Model loaded.")

app = FastAPI()


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """接收 WAV 音频文件，返回识别文本"""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = model.transcribe(tmp_path, language="zh")
        text = result["text"].strip()
        lang = result.get("language", "zh")
        return {"text": text, "language": lang}
    finally:
        # 等一小段时间确保 model 释放文件句柄
        time.sleep(0.1)
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9870
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    uvicorn.run(app, host=host, port=port, log_level="warning")
