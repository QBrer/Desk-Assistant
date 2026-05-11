"""
Local speech-to-text API for the Electron assistant.

The service prefers faster-whisper for lower latency and better CPU behavior,
then falls back to openai-whisper if faster-whisper is unavailable.
"""
import os
import sys
import tempfile
import time

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

from fastapi import FastAPI, UploadFile, File
import uvicorn
from zhconv import convert


MODEL_SIZE = os.environ.get("LAIN_STT_MODEL", "small")
DEVICE = os.environ.get("LAIN_STT_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("LAIN_STT_COMPUTE_TYPE", "int8")
LOCAL_FILES_ONLY = os.environ.get("LAIN_STT_LOCAL_ONLY", "1") != "0"


def load_model():
    try:
        from faster_whisper import WhisperModel

        print(
            f"[STT] Loading faster-whisper model: {MODEL_SIZE} "
            f"on {DEVICE} ({COMPUTE_TYPE})...",
            flush=True,
        )
        model = WhisperModel(
            MODEL_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            local_files_only=LOCAL_FILES_ONLY,
        )
        print("[STT] faster-whisper model loaded.", flush=True)
        return "faster-whisper", model
    except Exception as exc:
        print(f"[STT] faster-whisper unavailable: {exc}", flush=True)

    import whisper

    fallback_size = os.environ.get("LAIN_STT_FALLBACK_MODEL", "base")
    print(f"[STT] Loading openai-whisper model: {fallback_size} on {DEVICE}...", flush=True)
    model = whisper.load_model(fallback_size, device=DEVICE)
    print("[STT] openai-whisper model loaded.", flush=True)
    return "openai-whisper", model


ENGINE, MODEL = load_model()
app = FastAPI()


def transcribe_audio(path):
    if ENGINE == "faster-whisper":
        segments, info = MODEL.transcribe(
            path,
            language="zh",
            task="transcribe",
            beam_size=5,
            best_of=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,
            initial_prompt="以下是普通话中文语音，也可能包含少量英文或日语名称。请准确转写。",
        )
        text = "".join(segment.text for segment in segments).strip()
        return text, getattr(info, "language", "zh")

    result = MODEL.transcribe(
        path,
        language="zh",
        task="transcribe",
        temperature=0.0,
        fp16=False,
        condition_on_previous_text=False,
        initial_prompt="以下是普通话中文语音，也可能包含少量英文或日语名称。请准确转写。",
    )
    return result["text"].strip(), result.get("language", "zh")


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Accept a WAV file and return simplified Chinese text."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        text, language = transcribe_audio(tmp_path)
        text = convert(text, "zh-hans")
        return {"text": text, "language": language, "engine": ENGINE}
    finally:
        time.sleep(0.05)
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9870
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    uvicorn.run(app, host=host, port=port, log_level="warning")
