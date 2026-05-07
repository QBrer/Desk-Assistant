"""
本地 Whisper 语音识别 API 服务
被 Electron 主进程调用，使用 faster-whisper tiny 模型在 CPU 上运行。
"""
import sys
import os
import tempfile
from fastapi import FastAPI, UploadFile, File
import uvicorn

from faster_whisper import WhisperModel

# CPU 上跑 tiny 模型，不跟 TTS 抢显存
MODEL_SIZE = "tiny"
DEVICE = "cpu"
COMPUTE_TYPE = "int8"

print(f"[STT] Loading faster-whisper model: {MODEL_SIZE} on {DEVICE}...")
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
print("[STT] Model loaded.")

app = FastAPI()


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """接收 WAV 音频文件，返回识别文本"""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(tmp_path, language="zh", beam_size=5)
        text = "".join(seg.text for seg in segments).strip()
        return {"text": text, "language": info.language}
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9870
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    uvicorn.run(app, host=host, port=port, log_level="warning")
