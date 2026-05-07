"""
玲音(Lain) 语音对话框 — 输入文字，玲音读给你听
基于 GPT-SoVITS v4 训练模型
"""
import os, sys
import numpy as np

# —— 路径配置 ——
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GPT_SOVITS_DIR = os.path.join(BASE_DIR, "GPT-SoVITS")
GPT_WEIGHTS_DIR = os.path.join(GPT_SOVITS_DIR, "GPT_SoVITS")

sys.path.insert(0, GPT_SOVITS_DIR)
sys.path.insert(0, GPT_WEIGHTS_DIR)
os.chdir(GPT_SOVITS_DIR)

# 你的训练模型
os.environ["gpt_path"] = os.path.join(BASE_DIR, "xxx-e15.ckpt")
os.environ["sovits_path"] = os.path.join(BASE_DIR, "xxx_e16_s144_l32.pth")
os.environ["version"] = "v4"

import torch
import gradio as gr

from inference_webui import get_tts_wav

# —— 参考音频选项 ——
# 参考文本必须与音频实际内容完全一致
REF_OPTIONS = {
    "rank_049 (4.1s, sim 0.961)": {
        "audio": os.path.join(BASE_DIR, "..", "lain-voice", "ranked_by_similarity",
                              "rank_049_sim_0.961_clip_121_928.6s-932.7s.wav"),
        "text": "レインは人なんかじゃなかったんだね",
    },
    "rank_005 (3.2s, sim 0.993)": {
        "audio": os.path.join(BASE_DIR, "..", "lain-voice", "ranked_by_similarity",
                              "rank_005_sim_0.993_clip_083_770.9s-774.1s.wav"),
        "text": "誰も彼もが味方だと思ってしまっただけ",
    },
}
DEFAULT_REF = "rank_005 (3.2s, sim 0.993)"

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"设备: {device}")
print(f"GPT:   {os.environ['gpt_path']}")
print(f"SoVITS: {os.environ['sovits_path']}")
for name, opt in REF_OPTIONS.items():
    print(f"Ref {name}: {os.path.basename(opt['audio'])}")


def synthesize(text, ref_choice, ref_text, language):
    """输入文字 → 返回音频 (sampling_rate, audio_array)"""
    if not text.strip():
        return None

    ref_audio = REF_OPTIONS[ref_choice]["audio"]
    if not os.path.exists(ref_audio):
        ref_audio = REF_OPTIONS[DEFAULT_REF]["audio"]

    with torch.no_grad():
        result = get_tts_wav(
            ref_wav_path=ref_audio,
            prompt_text=ref_text,
            prompt_language=language,
            text=text.strip(),
            text_language=language,
        )
    item = next(result)
    if isinstance(item, tuple) and len(item) == 2:
        sr, wav = item
    else:
        sr, wav = 44100, item

    # 峰值归一化，解决跨语言合成音量过低的问题
    peak = np.max(np.abs(wav))
    if peak > 0 and peak < 0.3:
        wav = wav * (0.8 / peak)

    return sr, wav


def on_ref_change(choice):
    return REF_OPTIONS[choice]["text"]


# —— Gradio 界面 ——
with gr.Blocks(title="玲音语音对话框", theme="soft") as demo:
    gr.Markdown("# 玲音 (Lain) 语音对话框")
    gr.Markdown("输入文本，玲音读给你听。参考文本须与参考音频内容一致，否则会出噪音。")

    with gr.Row():
        with gr.Column(scale=2):
            text_input = gr.Textbox(
                label="输入文本",
                placeholder="こんにちは、わたしは玲音です。",
                lines=3,
                value="こんにちは、わたしは玲音です。",
            )
            with gr.Row():
                lang = gr.Radio(
                    choices=["日文", "中文", "英文"],
                    value="日文",
                    label="语言",
                )
            ref_choice = gr.Dropdown(
                choices=list(REF_OPTIONS.keys()),
                value=DEFAULT_REF,
                label="参考音频",
            )
            ref_text_input = gr.Textbox(
                label="参考文本（与参考音频内容一致）",
                value=REF_OPTIONS[DEFAULT_REF]["text"],
            )
            btn = gr.Button("生成语音", variant="primary", size="lg")

        with gr.Column(scale=1):
            audio_output = gr.Audio(
                label="玲音的语音",
                type="numpy",
            )

    ref_choice.change(fn=on_ref_change, inputs=ref_choice, outputs=ref_text_input)
    btn.click(
        fn=synthesize,
        inputs=[text_input, ref_choice, ref_text_input, lang],
        outputs=audio_output,
    )

    gr.Markdown("---\n模型: GPT-SoVITS v4 | 声音: 玲音 (Lain Iwakura)")

if __name__ == "__main__":
    print("启动 Gradio 界面...")
    demo.launch(share=False, server_name="127.0.0.1", server_port=7860)