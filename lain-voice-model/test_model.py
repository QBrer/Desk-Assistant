"""
快速冒烟测试 — 验证模型能否加载和推理
"""
import os, sys, time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GPT_SOVITS_DIR = os.path.join(BASE_DIR, "GPT-SoVITS")
sys.path.insert(0, GPT_SOVITS_DIR)
sys.path.insert(0, os.path.join(GPT_SOVITS_DIR, "GPT_SoVITS"))
os.chdir(GPT_SOVITS_DIR)

os.environ["gpt_path"] = os.path.join(BASE_DIR, "xxx-e15.ckpt")
os.environ["sovits_path"] = os.path.join(BASE_DIR, "xxx_e16_s144_l32.pth")
os.environ["version"] = "v4"
os.environ["is_half"] = "True"

REF_AUDIO = os.path.join(
    BASE_DIR, "..", "lain-voice", "ranked_by_similarity",
    "rank_049_sim_0.961_clip_121_928.6s-932.7s.wav"
)
if not os.path.exists(REF_AUDIO):
    print(f"WARNING: ref audio not found at {REF_AUDIO}")
    # Try a fallback
    REF_AUDIO = os.path.join(BASE_DIR, "..", "lain-voice", "clips", "clip_001_0.4s-8.1s.wav")

print("=" * 50)
print("玲音语音模型 — 冒烟测试")
print("=" * 50)

t0 = time.time()
print("\n[1/3] 导入模块...")
import torch
print(f"  torch: {torch.__version__}, CUDA: {torch.cuda.is_available()}")

from inference_webui import get_tts_wav
print("  模块导入完成")

print("\n[2/3] 合成测试...")
ref_text = "レインは人なんかじゃなかったんだね"
text = "こんにちは、わたしは玲音です。"

t1 = time.time()
with torch.no_grad():
    result = get_tts_wav(
        ref_wav_path=REF_AUDIO,
        prompt_text=ref_text,
        prompt_language="日文",
        text=text,
        text_language="日文",
    )
item = next(result)
if isinstance(item, tuple) and len(item) == 2:
    sr, wav = item
else:
    sr, wav = 44100, item

elapsed = time.time() - t1
print(f"  合成完成! 采样率: {sr}Hz, 音频长度: {len(wav)/sr:.1f}s, 耗时: {elapsed:.1f}s")

print("\n[3/3] 保存音频...")
import soundfile as sf
out_path = os.path.join(BASE_DIR, "test_output.wav")
sf.write(out_path, wav, sr)
print(f"  已保存到: {out_path}")

print(f"\n总耗时: {time.time()-t0:.1f}s")
print("=" * 50)
print("冒烟测试通过！模型可以正常工作。")