---
name: ppt-research-style
description: "Create or edit Chinese research/report PowerPoint decks in the learned style from assets/reference-style.pptx: 16:9 white academic slides, Microsoft YaHei typography, dense evidence figures, blue section bars, bottom citations, and data/model case-study layouts. Use when asked to make PPT, presentation slides, 学术汇报, 研究汇报, 汇报材料, or convert outlines/research notes into .pptx with this style."
---

# PPT Research Style

Use this skill to produce Chinese research presentation decks that match the reference deck's compact academic reporting style. Prefer evidence density, precise figure placement, and bottom citations over decorative design.

## Workflow

1. **Gather inputs**: Collect the user's outline, papers, screenshots, charts, or notes.
2. **Read papers**: If the user provides PDF papers, use Python to extract text (PyPDF2/fitz) and understand the paper's structure: abstract, method, experiments, results.
3. **Extract ALL figures automatically**: Run `prepare_figures.py --scan-only` on each PDF. This scans for every "Figure N:" / "Table N:" caption and extracts them to the figures directory. You will get a manifest JSON listing all available figures.
4. **Write a dense JSON spec**: Use the manifest to reference figures via `figure_ref` (e.g. `"figure_ref": "Figure 1"`). Write rich body text — every slide should have substantive content.
5. **Run `prepare_figures.py`** on the JSON spec to resolve all images.
6. **Run `create_research_ppt.py`** to generate the final PPT.
7. Read `references/style-guide.md` for fine-tuning visual details.

### Critical Rules

- **ALWAYS run the scan step first** (step 3). This gives you the complete figure inventory before you write the JSON spec.
- Figure/table extraction is local PDF structure analysis, not LLM vision. It should work before any model tries to interpret image content.
- After scanning, inspect manifest dimensions. If many figures/tables are under ~120 px high, the crop is likely caption-only and must be rescanned/fixed before generating PPT.
- **NEVER guess crop coordinates.** The scan pipeline handles cropping automatically by finding caption positions in the PDF text.
- **Use `figure_ref` instead of `pdf_page` + `crop`** in the JSON spec. This is the most reliable method.
- **Content must be DENSE.** Each slide should have 3-5 substantial bullet points or a multi-sentence paragraph, NOT just a one-line summary. See the Content Density section below.
- **Use evidence aggressively.** For research decks, target 2-3 real paper figures/tables on evidence slides and at least 12-20 total evidence images for a 10-page deck when enough figures are available.

## Content Density Requirements

Each slide MUST contain:
- **Title**: Concise but specific (not just "模型介绍", but "Sat-JEPA-Diff: 基于联合嵌入的时空预测架构")
- **Body text**: At minimum 3-5 bullet points OR 2-3 paragraphs. Each bullet should contain a complete technical claim with quantitative details when available.
- **1-3 figures**: Prefer original paper figures. Use the scanned manifest to select the most relevant ones. Do not stop at the first 1-2 figures; use enough figures/tables to support the narrative.
- **Citation**: Full reference at the bottom.
- **Speaker notes**: 2-4 paragraphs of presenter script in Chinese.

BAD example (too sparse):
```
title: "模型架构"
body: "本文提出了Sat-JEPA-Diff模型。"
```

GOOD example (dense):
```
title: "Sat-JEPA-Diff: 联合嵌入预测 + 条件扩散的双模块架构"
body: "• IJEPA模块：通过ViT编码器将128×128卫星图像编码为16×16 patch嵌入，\n  预测器基于Transformer预测下一时刻的语义嵌入 ẑ_{t+1}\n• 条件扩散模块：冻结SD3.5骨干网络，通过Conditioning Adapter将IJEPA嵌入\n  转化为cross-attention token h∈R^{M×4096} 和pooled embedding p∈R^{2048}\n• 损失函数：L_IJEPA = λ₁‖ẑ-z*‖₁ + λ₂(1-cos) + λ₃L_spatial + λ₄L_contrastive\n• 总损失：L = L_IJEPA + αL_diff，其中扩散损失包含flow matching + SSIM项"
```

## Literature Figure Handling

- **Primary method: Caption-anchored structure extraction.** Run `prepare_figures.py --scan-only` on the JSON spec. The script finds all "Figure N:" and "Table N:" captions, then uses local PDF drawing/image objects for figures and adjacent text-row clusters for tables. No manual coordinates or model vision needed.
- After scanning, check the output manifest (`*_manifest.json`) to see all available figures with their canonical names, page numbers, and sizes.
- In the JSON spec, reference figures by name: `"figure_ref": "Figure 1"`, `"figure_ref": "Table 2"`, etc. The pipeline will match these to the pre-scanned images.
- **Fallback**: If `figure_ref` is not available, you can still use `pdf_page` (auto-crops) or explicit `crop` coordinates.
- **Only use papers that the user has provided locally.** Do not fabricate content about papers that are not in the workspace.
- Prioritize architecture diagrams, data-source tables, evaluation charts, maps, workflow figures, benchmark tables, safety/evaluation plots, and tool-use examples.
- If a paper has a rich manifest, build slides around evidence groups: scaling, benchmarks, safety, multimodal examples, tool-use, and limitations.
- Add a short caption near each figure and a bottom citation naming the paper, year, figure/table number.

## Background Template

- Use `assets/background-template.pptx` as the source of truth for slide chrome.
- Reuse `assets/header-strip.png` at x=0, y≈0.01, w=13.33, h≈0.96 in.
- Reuse `assets/footer-strip.png` at x=0, y≈6.86, w=13.33, h≈0.64 in.
- Use white bold titles around x=0.38, y=0.06, w≈12.0, h≈0.72. Keep main content below y≈1.05, or below y≈1.50 when a blue section bar is present.
- Do not replace these background strips with plain white bands or hand-drawn divider lines.

## Core Style

- Canvas: 16:9 widescreen, white background, no cover-page hero unless explicitly requested.
- Typography: Microsoft YaHei for Chinese text; 36 pt bold black titles; 16 pt body; 14 pt captions or dense secondary text; 10-12 pt citations.
- Palette: black `#0F1115`, body gray `#222222`, deep blue `#0061AA` for model/section bars, dark red `#C00000` only for emphasis.
- Top/bottom chrome: use the background strip assets. Place the blue textured header strip at the top and a matching blue footer strip at the bottom; title text in white inside the top strip. On case/process slides place a full-width blue bar directly below the header strip. Put citations in white inside the bottom footer zone.
- Layout: title at top left with wide usable content area; figures dominate the lower two-thirds; text blocks are dense but aligned to a simple grid.
- Evidence: include real charts, maps, tables, architecture diagrams, screenshots, and paper citations. Avoid generic icons and marketing illustrations.
- Tone: analytical, research-report style. Use direct claims, quantitative/qualitative comparisons, named models, named datasets, and citations.
- Speaker notes: every slide should include a complete presenter script in the PowerPoint notes area. Use natural spoken Chinese, usually 2-4 short paragraphs per slide.

## Layout Selection

- Use `split` when a slide explains a model or data pipeline: left narrative block, right stacked figures with captions.
- Use `evidence_pairs` when comparing two tasks/results: left figures in two rows, right explanatory text in two matching blocks.
- Use `case` for typical model case-study slides: title, full-width blue model bar, paragraph summary, 1-3 evidence figures, citation at bottom.
- Use `grid` for resource/category overview slides: title, intro text, compact image grid, bottom source.
- Use `text` only when figures are unavailable; still keep the slide structured with short sections and citations.

## JSON Spec Schema

```json
{
  "deck_title": "研究进展汇报",
  "slides": [
    {
      "layout": "case",
      "title": "Sat-JEPA-Diff: 联合嵌入预测 + 条件扩散架构",
      "section": "模型架构",
      "body": "• IJEPA模块：ViT编码器 + Transformer预测器...\n• 条件扩散模块：冻结SD3.5 + Conditioning Adapter...\n• 双重损失：L_IJEPA (重建+对比) + αL_diff (flow matching+SSIM)",
      "pdf": "2603.13943v1.pdf",
      "images": [
        {
          "figure_ref": "Figure 1",
          "caption": "Sat-JEPA-Diff整体架构"
        },
        {
          "figure_ref": "Table 1",
          "caption": "定量评估结果对比"
        }
      ],
      "citation": "Author et al. (2025). Paper Title. Venue.",
      "notes": "这一页介绍模型的整体架构..."
    }
  ]
}
```

### Image source resolution order:
1. If `figure_ref` matches a scanned figure → use the pre-extracted image
2. If `path` exists on disk → use it directly
3. If `pdf_page` is set (and slide has `pdf`) → extract from PDF (auto-crop if no `crop`)
4. If `url` is set → download from URL
5. Fallback → auto-generate a styled schematic placeholder from the caption

## Generator Commands

### Step 0: Scan and extract all figures (RECOMMENDED — run first)

```powershell
E:\anconda\envs\py310\python.exe ppt-research-style\scripts\prepare_figures.py input.json --figures-dir output_dir\figures --scan-only
```

This will scan all PDFs referenced in the spec for "Figure N:" / "Table N:" captions and extract each one automatically. Outputs a `*_manifest.json` listing all available figures.

### Step 1: Prepare figures (MANDATORY — resolves all image references)

```powershell
E:\anconda\envs\py310\python.exe ppt-research-style\scripts\prepare_figures.py input.json --figures-dir output_dir\figures --update-spec
```

This will:
- Match `figure_ref` entries to pre-scanned figures
- Extract remaining figures from PDFs when `pdf` + `pdf_page` are specified
- Download figures from URLs when `url` is specified
- Auto-generate styled placeholders when no source is available
- Update the JSON spec with resolved absolute paths (with `--update-spec`)

### Step 2: Generate the PPT

```powershell
E:\anconda\envs\py310\python.exe ppt-research-style\scripts\create_research_ppt.py input.json output.pptx
```

### Optional: Add/update speaker notes on existing deck

```powershell
E:\anconda\envs\py310\python.exe ppt-research-style\scripts\add_speaker_notes.py input.pptx notes.json output.pptx
```

## Troubleshooting

### Common failures and how to avoid them

| Symptom | Cause | Prevention |
|---------|-------|------------|
| Grey "Missing figure" boxes in PPT | Image files don't exist at the paths in JSON | **Always run `prepare_figures.py` first** |
| Figures include surrounding text | Using `pdf_page` without scan | **Use `figure_ref` + `--scan-only` instead** |
| Figures/tables are just caption text strips | Caption-only crop from weak PDF layout detection | Re-run the updated `prepare_figures.py`; check manifest height/method/confidence before PPT generation |
| Sparse/empty slides | Body text too short | Write 3-5 bullets or 2-3 paragraphs per slide |
| Python script exit code 1 | Missing dependencies or script errors | Use `E:\anconda\envs\py310\python.exe` which has all deps |
| `figures/` directory not found | Was never created | `prepare_figures.py` creates it automatically |

### Required Python packages

All available in `E:\anconda\envs\py310`:
- `python-pptx` — PPT generation
- `Pillow` — image processing and placeholder generation
- `pypdfium2` — PDF page rendering
- `PyMuPDF` (fitz) — PDF text analysis and caption-based figure extraction
- `numpy` — image whitespace trimming

## Quality Bar

- Keep every slide visually purposeful: title, claim, evidence, citation.
- **Content density**: no slide should have fewer than 3 substantive text points. Each point should contain a technical claim, not just a topic label.
- Ensure every slide has speaker notes. Do not leave notes blank unless the user explicitly requests a no-notes deck.
- Keep figure captions close to their figures and aligned to figure width.
- Use blue bars only for slide-level model/case names, not as generic decoration.
- Put references near the bottom edge, usually spanning most of the width.
- Do not introduce rounded-card dashboards, gradients, stock imagery, emoji, large icons, or oversized whitespace.
