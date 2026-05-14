#!/usr/bin/env python
"""Render selected PDF pages to PNG files for PPT evidence figures."""

from __future__ import annotations

import argparse
from pathlib import Path

import pypdfium2 as pdfium


def parse_pages(value: str):
    pages = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            pages.extend(range(int(a), int(b) + 1))
        else:
            pages.append(int(part))
    return sorted(set(pages))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", help="Input PDF path")
    parser.add_argument("out_dir", help="Output directory")
    parser.add_argument("--pages", required=True, help="1-based pages, e.g. 2,5,10 or 20-22")
    parser.add_argument("--scale", type=float, default=2.0, help="Render scale; 2.0 is usually enough for PPT")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(args.pdf)
    for page_num in parse_pages(args.pages):
        page = doc[page_num - 1]
        image = page.render(scale=args.scale).to_pil()
        out = out_dir / f"page_{page_num:03d}.png"
        image.save(out)
        print(out)


if __name__ == "__main__":
    main()
