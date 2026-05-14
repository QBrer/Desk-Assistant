#!/usr/bin/env python
"""Prepare evidence figures for a research PPT deck.

This script reads the same JSON spec used by create_research_ppt.py and ensures
every referenced image path exists. It uses multiple strategies, tried in order:

  1. **Caption-based extraction** — Scan the PDF for "Figure N:" / "Table N:"
     captions, locate the visual content above each caption, and crop precisely.
     This is the **primary and most reliable** method.
  2. **PDF page extraction** — Render a specific PDF page with optional crop
     coordinates or auto-detected figure region.
  3. **URL download** — If an image dict has a "url" key, download it.
  4. **Auto-generation** — As a last resort, generate a styled placeholder.

Usage
-----
    python prepare_figures.py spec.json [--figures-dir figures] [--scan-only]

    --scan-only   Just scan and extract ALL figures from the PDF(s) referenced
                  in the spec, then exit. Useful for pre-populating the figures
                  directory before writing the JSON spec.

The script is idempotent: it skips images that already exist on disk.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import textwrap
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BLUE = (0, 97, 170)
DARK_BLUE = (0, 61, 120)
WHITE = (255, 255, 255)
LIGHT_GRAY = (245, 247, 250)
MID_GRAY = (200, 205, 212)
DARK_GRAY = (80, 85, 95)
RED_ACCENT = (192, 0, 0)
FIGURE_W, FIGURE_H = 1200, 800

# Try to locate a usable font; fall back to default
_FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",   # 微软雅黑
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/arial.ttf",
]

def _get_font(size: int) -> ImageFont.FreeTypeFont:
    for path in _FONT_CANDIDATES:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Core: Scan PDF for all Figure/Table captions and extract each one
# ---------------------------------------------------------------------------

_CAPTION_RE = re.compile(r'^(Figure|Table|Fig\.)\s*(\d+)\b', re.IGNORECASE)
_PAGE_NUMBER_RE = re.compile(r'^\s*\d+\s*$')


def _normalize_caption_kind(raw: str) -> str:
    return "Figure" if raw.lower().startswith("fig") else raw.title()


def _rect_from_seq(seq) -> Tuple[float, float, float, float]:
    return float(seq[0]), float(seq[1]), float(seq[2]), float(seq[3])


def _pad_bbox(
    bbox: Tuple[float, float, float, float],
    page_width: float,
    page_height: float,
    pad_x: float = 8.0,
    pad_y: float = 8.0,
) -> Tuple[float, float, float, float]:
    x0, y0, x1, y1 = bbox
    return (
        max(0.0, x0 - pad_x),
        max(0.0, y0 - pad_y),
        min(page_width, x1 + pad_x),
        min(page_height, y1 + pad_y),
    )


def _union_bboxes(boxes: List[Tuple[float, float, float, float]]) -> Tuple[float, float, float, float]:
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def _is_noise_text_block(block) -> bool:
    text = block[4].strip()
    if not text:
        return True
    if _PAGE_NUMBER_RE.match(text):
        return True
    if len(text) <= 2:
        return True
    return False


def _drawing_rects(page) -> List[Tuple[float, float, float, float]]:
    rects: List[Tuple[float, float, float, float]] = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if rect is None:
            continue
        if rect.width < 4 or rect.height < 4:
            continue
        rects.append((rect.x0, rect.y0, rect.x1, rect.y1))
    return rects


def _image_rects(blocks) -> List[Tuple[float, float, float, float]]:
    return [_rect_from_seq(block) for block in blocks if block[6] == 1]


def _nearest_previous_caption_y(captions, current_top: float, kind: str) -> float:
    previous = [caption[3] for caption in captions if caption[0] == kind and caption[3] < current_top]
    return max(previous) if previous else 0.0


def _nearest_next_caption_y(captions, current_bottom: float) -> Optional[float]:
    next_tops = [caption[2] for caption in captions if caption[2] > current_bottom]
    return min(next_tops) if next_tops else None


def _figure_bbox_from_page(
    caption_block,
    text_blocks,
    visual_rects: List[Tuple[float, float, float, float]],
    captions,
    page_width: float,
    page_height: float,
) -> Tuple[Tuple[float, float, float, float], str, str]:
    caption_x0, caption_y0, caption_x1, caption_y1 = _rect_from_seq(caption_block)
    search_top = max(0.0, _nearest_previous_caption_y(captions, caption_y0, "Figure") + 4.0)

    candidates = []
    for rect in visual_rects:
        x0, y0, x1, y1 = rect
        area = (x1 - x0) * (y1 - y0)
        if area < 120:
            continue
        # Prefer real PDF drawing/image objects above the caption. Do not let
        # axis labels or in-figure text blocks shrink this search window.
        if y1 <= caption_y0 + 3 and y0 >= search_top - 8:
            candidates.append(rect)

    if candidates:
        seed = max(candidates, key=lambda r: r[3])
        cluster = []
        for rect in candidates:
            horizontally_related = rect[0] <= seed[2] + 90 and rect[2] >= seed[0] - 90
            vertically_related = rect[3] >= seed[1] - 120 and rect[1] <= seed[3] + 120
            if horizontally_related and vertically_related:
                cluster.append(rect)
        visual_bbox = _union_bboxes(cluster or [seed])
        x0 = min(visual_bbox[0], caption_x0)
        x1 = max(visual_bbox[2], caption_x1)
        bbox = _pad_bbox((x0, visual_bbox[1], x1, caption_y1), page_width, page_height, 10.0, 8.0)
        return bbox, "drawing_above_caption", "high"

    bbox = _pad_bbox((40.0, search_top, page_width - 40.0, caption_y1), page_width, page_height, 8.0, 8.0)
    return bbox, "fallback_region", "low"


def _table_bbox_from_page(
    caption_block,
    text_blocks,
    visual_rects: List[Tuple[float, float, float, float]],
    captions,
    page_width: float,
    page_height: float,
) -> Tuple[Tuple[float, float, float, float], str, str]:
    caption_x0, caption_y0, caption_x1, caption_y1 = _rect_from_seq(caption_block)
    prev_caption_y = _nearest_previous_caption_y(captions, caption_y0, "Table")
    next_caption_y = _nearest_next_caption_y(captions, caption_y1) or page_height

    above_rows = [
        b for b in text_blocks
        if b[3] < caption_y0 - 3
        and b[3] > prev_caption_y + 3
        and not _CAPTION_RE.match(b[4].strip())
        and not _is_noise_text_block(b)
    ]
    below_rows = [
        b for b in text_blocks
        if b[1] > caption_y1 + 3
        and b[1] < next_caption_y - 3
        and not _CAPTION_RE.match(b[4].strip())
        and not _is_noise_text_block(b)
    ]

    def cluster_rows(rows: List[tuple], direction: str) -> List[tuple]:
        if not rows:
            return []
        rows = sorted(rows, key=lambda b: b[1], reverse=(direction == "above"))
        cluster = []
        last_edge = caption_y0 if direction == "above" else caption_y1
        for row in rows:
            gap = last_edge - row[3] if direction == "above" else row[1] - last_edge
            if cluster and gap > 45:
                break
            if row[2] - row[0] < 60 and len(row[4].strip()) < 8:
                continue
            cluster.append(row)
            last_edge = row[1] if direction == "above" else row[3]
        return cluster

    above_cluster = cluster_rows(above_rows, "above")
    below_cluster = cluster_rows(below_rows, "below")
    rows = above_cluster if len(above_cluster) >= len(below_cluster) else below_cluster

    boxes = [_rect_from_seq(row) for row in rows]
    if boxes:
        row_bbox = _union_bboxes(boxes)
        for rect in visual_rects:
            if rect[3] >= row_bbox[1] - 8 and rect[1] <= row_bbox[3] + 8:
                boxes.append(rect)
        x0, y0, x1, y1 = _union_bboxes(boxes + [(caption_x0, caption_y0, caption_x1, caption_y1)])
        bbox = _pad_bbox((x0, y0, x1, y1), page_width, page_height, 10.0, 8.0)
        return bbox, "table_text_cluster", "high" if len(rows) >= 3 else "medium"

    bbox = _pad_bbox((40.0, caption_y0, page_width - 40.0, min(page_height, caption_y1 + 220.0)), page_width, page_height)
    return bbox, "fallback_region", "low"


def _render_crop_pdfium(pdf_path: str, page_num: int, bbox: Tuple[float, float, float, float], scale: float) -> Image.Image:
    import pypdfium2 as pdfium

    pdoc = pdfium.PdfDocument(str(pdf_path))
    ppage = pdoc[page_num]
    bitmap = ppage.render(scale=scale)
    full_img = bitmap.to_pil()
    iw, ih = full_img.size

    page_w = ppage.get_width()
    page_h = ppage.get_height()
    x0 = max(0, int(bbox[0] / page_w * iw))
    y0 = max(0, int(bbox[1] / page_h * ih))
    x1 = min(iw, int(bbox[2] / page_w * iw))
    y1 = min(ih, int(bbox[3] / page_h * ih))
    return full_img.crop((x0, y0, x1, y1))


def _crop_is_good(img: Image.Image, kind: str) -> bool:
    min_h = 120 if kind == "Table" else 160
    min_w = 120
    return img.width >= min_w and img.height >= min_h


def _fallback_bbox_for_kind(
    kind: str,
    caption_block,
    page_width: float,
    page_height: float,
) -> Tuple[float, float, float, float]:
    _, y0, _, y1 = _rect_from_seq(caption_block)
    return _pad_bbox((35.0, max(0.0, y0 - 260.0), page_width - 35.0, y1), page_width, page_height, 8.0, 8.0)


def scan_pdf_figures(pdf_path: str, output_dir: Path, scale: float = 2.0) -> Dict[str, dict]:
    """Scan a PDF for Figure/Table captions and extract usable visual regions.

    The extractor anchors on captions, but it does not rely on caption text alone.
    Figures prefer nearby PDF drawing/image objects; tables prefer adjacent text-row
    clusters. This avoids saving caption-only strips for vector-heavy papers.
    """
    try:
        import fitz
    except ImportError:
        print("  [WARN] PyMuPDF not installed, caption-based extraction unavailable")
        return {}

    if not Path(pdf_path).exists():
        print(f"  [WARN] PDF not found: {pdf_path}")
        return {}

    try:
        import pypdfium2  # noqa: F401
    except ImportError:
        print("  [WARN] pypdfium2 not installed")
        return {}

    output_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    pdf_stem = Path(pdf_path).stem[:25]
    index: Dict[str, dict] = {}

    for page_num in range(len(doc)):
        page = doc[page_num]
        pw, ph = page.rect.width, page.rect.height
        blocks = page.get_text("blocks")
        text_blocks = [b for b in blocks if b[6] == 0]
        all_sorted = sorted(text_blocks, key=lambda b: (b[1], b[0]))
        visual_rects = _drawing_rects(page) + _image_rects(blocks)

        captions = []
        for block in all_sorted:
            text = block[4].strip()
            match = _CAPTION_RE.match(text)
            if not match:
                continue
            kind = _normalize_caption_kind(match.group(1))
            captions.append((kind, match.group(2), block[1], block[3], block))

        for kind, num, _, _, block in captions:
            canonical = f"{kind} {num}"
            if canonical in index:
                continue

            text = block[4].strip()
            try:
                if kind == "Table":
                    bbox, method, confidence = _table_bbox_from_page(block, all_sorted, visual_rects, captions, pw, ph)
                else:
                    bbox, method, confidence = _figure_bbox_from_page(block, all_sorted, visual_rects, captions, pw, ph)

                cropped = _render_crop_pdfium(pdf_path, page_num, bbox, scale)
                cropped = _auto_trim(cropped)

                if not _crop_is_good(cropped, kind):
                    fallback_bbox = _fallback_bbox_for_kind(kind, block, pw, ph)
                    fallback = _render_crop_pdfium(pdf_path, page_num, fallback_bbox, scale)
                    fallback = _auto_trim(fallback)
                    if fallback.width * fallback.height > cropped.width * cropped.height:
                        bbox = fallback_bbox
                        cropped = fallback
                        method = "fallback_region"
                        confidence = "low"

                if not _crop_is_good(cropped, kind):
                    print(f"  [SCAN] Skipped weak {canonical} (p.{page_num+1}) ({cropped.width}x{cropped.height})")
                    continue

                safe_name = canonical.replace(" ", "_").lower()
                out_path = output_dir / f"{pdf_stem}_{safe_name}.png"
                cropped.save(str(out_path), quality=95)

                index[canonical] = {
                    "path": str(out_path),
                    "page": page_num + 1,
                    "caption": text[:150],
                    "width": cropped.width,
                    "height": cropped.height,
                    "method": method,
                    "bbox": [round(v, 2) for v in bbox],
                    "confidence": confidence,
                }
                print(
                    f"  [SCAN] {canonical} (p.{page_num+1}) -> {out_path.name} "
                    f"({cropped.width}x{cropped.height}, {method}, {confidence})"
                )

            except Exception as e:
                print(f"  [SCAN] Failed to extract {canonical}: {e}")

    doc.close()

    if index:
        manifest = output_dir / f"{pdf_stem}_manifest.json"
        with open(manifest, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        print(f"  [SCAN] Manifest written: {manifest}")

    return index


# ---------------------------------------------------------------------------
# Strategy 1: PDF page extraction (with auto-crop or explicit crop)
# ---------------------------------------------------------------------------

def extract_from_pdf(
    pdf_path: str,
    page_num: int,
    output_path: Path,
    crop: Optional[Tuple[float, float, float, float]] = None,
    scale: float = 2.0,
) -> bool:
    """Render a single PDF page to PNG with smart cropping."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        print(f"  [WARN] pypdfium2 not installed, cannot extract from PDF")
        return False

    pdf = Path(pdf_path)
    if not pdf.exists():
        print(f"  [WARN] PDF not found: {pdf}")
        return False

    try:
        doc = pdfium.PdfDocument(str(pdf))
        page = doc[page_num - 1]
        bitmap = page.render(scale=scale)
        img = bitmap.to_pil()

        if crop:
            w, h = img.size
            box = (int(w * crop[0]), int(h * crop[1]),
                   int(w * crop[2]), int(h * crop[3]))
            img = img.crop(box)
        else:
            img = _auto_crop_page(pdf_path, page_num, img)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(str(output_path), quality=95)
        print(f"  [OK] Extracted PDF p.{page_num} -> {output_path} ({img.size[0]}x{img.size[1]})")
        return True
    except Exception as exc:
        print(f"  [ERR] PDF extraction failed: {exc}")
        return False


def _auto_crop_page(pdf_path: str, page_num: int, rendered_img: Image.Image) -> Image.Image:
    """Auto-detect and crop the figure/table region on a PDF page."""
    try:
        import fitz
    except ImportError:
        return _auto_trim(rendered_img)

    try:
        doc = fitz.open(pdf_path)
        page = doc[page_num - 1]
        pw, ph = page.rect.width, page.rect.height
        blocks = page.get_text("blocks")
        text_blocks = [b for b in blocks if b[6] == 0 and len(b[4].strip()) > 10]
        image_blocks = [b for b in blocks if b[6] == 1]
        doc.close()

        img_w, img_h = rendered_img.size
        best_region = None

        if image_blocks:
            min_x = min(b[0] for b in image_blocks) / pw
            min_y = min(b[1] for b in image_blocks) / ph
            max_x = max(b[2] for b in image_blocks) / pw
            max_y = max(b[3] for b in image_blocks) / ph
            if (max_y - min_y) * img_h > 100:
                best_region = (min_x, min_y, max_x, max_y)

        if not best_region and len(text_blocks) >= 2:
            text_blocks.sort(key=lambda b: b[1])
            best_gap = 0
            for i in range(len(text_blocks) - 1):
                gap_top = text_blocks[i][3] / ph
                gap_bottom = text_blocks[i + 1][1] / ph
                gap_h = gap_bottom - gap_top
                if gap_h > best_gap and gap_h * img_h > 100:
                    best_gap = gap_h
                    best_region = (0.02, gap_top - 0.005, 0.98, gap_bottom + 0.005)

        if best_region:
            x0 = max(0, int(best_region[0] * img_w) - 5)
            y0 = max(0, int(best_region[1] * img_h) - 5)
            x1 = min(img_w, int(best_region[2] * img_w) + 5)
            y1 = min(img_h, int(best_region[3] * img_h) + 5)
            cropped = rendered_img.crop((x0, y0, x1, y1))
            cropped = _auto_trim(cropped)
            if cropped.width > 100 and cropped.height > 80:
                return cropped

        return _auto_trim(rendered_img)
    except Exception:
        return _auto_trim(rendered_img)


def _auto_trim(img: Image.Image, threshold: int = 248, min_border: int = 5) -> Image.Image:
    """Trim near-white borders from an image."""
    try:
        import numpy as np
        arr = np.array(img.convert("L"))
        mask = arr < threshold
        rows = mask.any(axis=1)
        cols = mask.any(axis=0)
        if not rows.any() or not cols.any():
            return img
        y_min = max(0, rows.argmax() - min_border)
        y_max = min(arr.shape[0], arr.shape[0] - rows[::-1].argmax() + min_border)
        x_min = max(0, cols.argmax() - min_border)
        x_max = min(arr.shape[1], arr.shape[1] - cols[::-1].argmax() + min_border)
        return img.crop((x_min, y_min, x_max, y_max))
    except ImportError:
        return img


# ---------------------------------------------------------------------------
# Strategy 2: URL download
# ---------------------------------------------------------------------------

def download_image(url: str, output_path: Path) -> bool:
    """Download an image from a URL. Returns True on success."""
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, str(output_path))
        with Image.open(output_path) as img:
            img.verify()
        print(f"  [OK] Downloaded {url} -> {output_path}")
        return True
    except Exception as exc:
        print(f"  [ERR] Download failed for {url}: {exc}")
        if output_path.exists():
            output_path.unlink()
        return False


# ---------------------------------------------------------------------------
# Strategy 3: Auto-generate styled placeholder
# ---------------------------------------------------------------------------

def _draw_rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    """Draw a rounded rectangle (Pillow < 10 compat)."""
    x0, y0, x1, y1 = xy
    r = radius
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    draw.pieslice([x0, y0, x0 + 2 * r, y0 + 2 * r], 180, 270, fill=fill)
    draw.pieslice([x1 - 2 * r, y0, x1, y0 + 2 * r], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2 * r, x0 + 2 * r, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2 * r, y1 - 2 * r, x1, y1], 0, 90, fill=fill)
    if outline:
        draw.arc([x0, y0, x0 + 2 * r, y0 + 2 * r], 180, 270, fill=outline, width=width)
        draw.arc([x1 - 2 * r, y0, x1, y0 + 2 * r], 270, 360, fill=outline, width=width)
        draw.arc([x0, y1 - 2 * r, x0 + 2 * r, y1], 90, 180, fill=outline, width=width)
        draw.arc([x1 - 2 * r, y1 - 2 * r, x1, y1], 0, 90, fill=outline, width=width)
        draw.line([x0 + r, y0, x1 - r, y0], fill=outline, width=width)
        draw.line([x0 + r, y1, x1 - r, y1], fill=outline, width=width)
        draw.line([x0, y0 + r, x0, y1 - r], fill=outline, width=width)
        draw.line([x1, y0 + r, x1, y1 - r], fill=outline, width=width)


def generate_placeholder(caption: str, output_path: Path, style: str = "architecture") -> bool:
    """Generate a styled placeholder figure."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (FIGURE_W, FIGURE_H), LIGHT_GRAY)
    draw = ImageDraw.Draw(img)

    _draw_rounded_rect(draw, (40, 40, FIGURE_W - 40, FIGURE_H - 40), 20, WHITE, outline=MID_GRAY, width=2)

    font_title = _get_font(28)
    font_body = _get_font(18)

    draw.rectangle([60, 60, FIGURE_W - 60, 110], fill=BLUE)
    title_text = caption[:50] if caption else "Research Figure"
    draw.text((80, 68), title_text, fill=WHITE, font=font_title)

    box_colors = [BLUE, DARK_BLUE, RED_ACCENT, DARK_GRAY]
    y_start = 160
    for i in range(4):
        bx = 100 + (i % 2) * 480
        by = y_start + (i // 2) * 220
        color = box_colors[i % len(box_colors)]
        _draw_rounded_rect(draw, (bx, by, bx + 400, by + 160), 12, color)
        draw.text((bx + 20, by + 60), f"Component {i + 1}", fill=WHITE, font=font_body)

    for i in range(3):
        sx = 300 + (i % 2) * 480
        sy = y_start + 80 + (i // 2) * 220
        draw.line([(sx, sy), (sx + 100, sy)], fill=MID_GRAY, width=3)
        draw.polygon([(sx + 100, sy - 8), (sx + 100, sy + 8), (sx + 115, sy)], fill=MID_GRAY)

    draw.text((60, FIGURE_H - 60), "(Auto-generated placeholder)", fill=MID_GRAY, font=font_body)

    img.save(str(output_path), quality=95)
    print(f"  [GEN] Placeholder -> {output_path}")
    return True


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def prepare_all(spec: Dict[str, Any], figures_dir: Path, spec_dir: Path) -> Dict[str, Any]:
    """Walk through the spec, ensure every image exists, return updated spec.

    New behavior: if a slide references a figure_ref like "Figure 1", and we
    have already scanned the PDF, use the pre-extracted image directly.
    """
    figures_dir.mkdir(parents=True, exist_ok=True)

    # Step 0: Pre-scan all PDFs to build figure index
    pdf_figure_indices: Dict[str, Dict[str, dict]] = {}
    pdf_paths_seen = set()
    for slide_data in spec.get("slides", []):
        pdf_path = slide_data.get("pdf", "")
        if pdf_path:
            if not Path(pdf_path).is_absolute():
                pdf_path = str(spec_dir / pdf_path)
            if pdf_path not in pdf_paths_seen:
                pdf_paths_seen.add(pdf_path)
                print(f"\n--- Scanning {Path(pdf_path).name} for figures/tables ---")
                idx = scan_pdf_figures(pdf_path, figures_dir)
                pdf_figure_indices[pdf_path] = idx
                print(f"  Found {len(idx)} figures/tables\n")

    updated_slides: List[Dict[str, Any]] = []

    for slide_idx, slide_data in enumerate(spec.get("slides", [])):
        images = slide_data.get("images") or []
        pdf_path = slide_data.get("pdf", "")
        if pdf_path and not Path(pdf_path).is_absolute():
            pdf_path = str(spec_dir / pdf_path)

        figure_index = pdf_figure_indices.get(pdf_path, {})

        new_images = []
        for img_idx, img in enumerate(images):
            if isinstance(img, str):
                img = {"path": img, "caption": ""}

            rel_path = img.get("path", "")
            caption = img.get("caption", "")
            url = img.get("url", "")
            pdf_page = img.get("pdf_page", 0)
            crop = img.get("crop")
            figure_ref = img.get("figure_ref", "")  # e.g. "Figure 1", "Table 3"

            # Resolve path
            if rel_path and not Path(rel_path).is_absolute():
                abs_path = figures_dir / Path(rel_path).name
            elif rel_path:
                abs_path = Path(rel_path)
            else:
                safe_caption = re.sub(r'[^\w\-]', '_', caption or f"fig_{slide_idx}_{img_idx}")[:40]
                abs_path = figures_dir / f"{safe_caption}.png"

            img["path"] = str(abs_path)

            success = False

            # Existing non-reference images can be reused, but figure_ref images are
            # refreshed from the latest scan so old caption-only crops are replaced.
            if not figure_ref and abs_path.exists() and abs_path.stat().st_size > 100:
                print(f"  [SKIP] Already exists: {abs_path}")
                new_images.append(img)
                continue

            # Strategy 0 (NEW): Use figure_ref to get pre-scanned image
            if not success and figure_ref and figure_ref in figure_index:
                scan_info = figure_index[figure_ref]
                scan_path = Path(scan_info["path"])
                if scan_path.exists():
                    if scan_path.resolve() != abs_path.resolve():
                        # Copy/link the scanned image to the expected path
                        import shutil
                        shutil.copy2(str(scan_path), str(abs_path))
                    success = True
                    print(f"  [OK] Using scanned {figure_ref} -> {abs_path.name}")

            # Strategy 0b: Try to match caption text to scan index
            if not success and caption and figure_index:
                for canon, info in figure_index.items():
                    if canon.lower() in caption.lower():
                        scan_path = Path(info["path"])
                        if scan_path.exists():
                            if scan_path.resolve() != abs_path.resolve():
                                import shutil
                                shutil.copy2(str(scan_path), str(abs_path))
                            success = True
                            print(f"  [OK] Caption matched {canon} -> {abs_path.name}")
                            break

            # Strategy 1: PDF page extraction
            if not success and pdf_path and pdf_page:
                success = extract_from_pdf(pdf_path, pdf_page, abs_path, crop=crop)

            # Strategy 2: URL download
            if not success and url:
                success = download_image(url, abs_path)

            # Strategy 3: Auto-generate
            if not success:
                generate_placeholder(caption, abs_path)

            new_images.append(img)

        slide_data["images"] = new_images
        updated_slides.append(slide_data)

    spec["slides"] = updated_slides
    return spec


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("spec", help="Input JSON spec (same format as create_research_ppt.py)")
    parser.add_argument("--figures-dir", default="figures", help="Directory to store prepared figures (default: figures)")
    parser.add_argument("--update-spec", action="store_true",
                        help="Write the updated spec (with resolved paths) back to the JSON file")
    parser.add_argument("--scan-only", action="store_true",
                        help="Just scan PDFs and extract all figures, don't process the spec")
    args = parser.parse_args()

    spec_path = Path(args.spec)
    with open(spec_path, "r", encoding="utf-8-sig") as f:
        spec = json.load(f)

    figures_dir = Path(args.figures_dir)
    if not figures_dir.is_absolute():
        figures_dir = spec_path.parent / figures_dir

    if args.scan_only:
        # Just scan all PDFs and extract figures
        for slide_data in spec.get("slides", []):
            pdf_path = slide_data.get("pdf", "")
            if not pdf_path:
                continue
            if not Path(pdf_path).is_absolute():
                pdf_path = str(spec_path.parent / pdf_path)
            print(f"Scanning: {Path(pdf_path).name}")
            index = scan_pdf_figures(pdf_path, figures_dir)
            print(f"  Extracted {len(index)} figures/tables\n")
        print("Scan complete.")
        return

    print(f"Preparing figures for {len(spec.get('slides', []))} slides...")
    updated = prepare_all(spec, figures_dir, spec_path.parent)

    if args.update_spec:
        with open(spec_path, "w", encoding="utf-8") as f:
            json.dump(updated, f, ensure_ascii=False, indent=2)
        print(f"Updated spec written to {spec_path}")
    else:
        out = spec_path.with_name(spec_path.stem + "_resolved.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(updated, f, ensure_ascii=False, indent=2)
        print(f"Resolved spec written to {out}")

    print("Done.")


if __name__ == "__main__":
    main()
