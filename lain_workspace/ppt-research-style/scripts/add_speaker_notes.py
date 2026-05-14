#!/usr/bin/env python
"""Add speaker notes to a PPTX file using OOXML notesSlides."""

from __future__ import annotations

import argparse
import html
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"


def _xml_escape(text: str) -> str:
    return html.escape(text or "", quote=False)


def _next_rid(rels_root) -> str:
    used = []
    for rel in rels_root:
        rid = rel.attrib.get("Id", "")
        if rid.startswith("rId") and rid[3:].isdigit():
            used.append(int(rid[3:]))
    return f"rId{(max(used) if used else 0) + 1}"


def _notes_master_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200" dirty="0"/></a:lvl1pPr></p:notesStyle></p:notesMaster>"""


def _notes_slide_xml(note_text: str) -> str:
    paragraphs = []
    for para in (note_text or "").splitlines():
        if para.strip():
            paragraphs.append(
                f'<a:p><a:r><a:rPr lang="zh-CN" sz="1200"/><a:t>{_xml_escape(para.strip())}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="1200"/></a:p>'
            )
    if not paragraphs:
        paragraphs.append('<a:p><a:endParaRPr lang="zh-CN" sz="1200"/></a:p>')
    body = "".join(paragraphs)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{body}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"""


def add_speaker_notes(input_pptx: Path | str, notes: list[str], output_pptx: Path | str) -> None:
    input_pptx = Path(input_pptx)
    output_pptx = Path(output_pptx)
    ET.register_namespace("", REL_NS)
    ET.register_namespace("", CT_NS)

    with zipfile.ZipFile(input_pptx, "r") as zin:
        names = set(zin.namelist())
        slide_names = sorted(
            [n for n in names if n.startswith("ppt/slides/slide") and n.endswith(".xml")],
            key=lambda n: int(Path(n).stem.replace("slide", "")),
        )
        content_types = ET.fromstring(zin.read("[Content_Types].xml"))
        pres_rels = ET.fromstring(zin.read("ppt/_rels/presentation.xml.rels"))
        existing = {n: zin.read(n) for n in names}

    def add_override(part_name: str, content_type: str) -> None:
        for child in content_types:
            if child.attrib.get("PartName") == part_name:
                return
        node = ET.Element(f"{{{CT_NS}}}Override")
        node.set("PartName", part_name)
        node.set("ContentType", content_type)
        content_types.append(node)

    if not any(rel.attrib.get("Type", "").endswith("/notesMaster") for rel in pres_rels):
        rel = ET.Element(f"{{{REL_NS}}}Relationship")
        rel.set("Id", _next_rid(pres_rels))
        rel.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster")
        rel.set("Target", "notesMasters/notesMaster1.xml")
        pres_rels.append(rel)
    add_override("/ppt/notesMasters/notesMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml")

    with zipfile.ZipFile(output_pptx, "w", zipfile.ZIP_DEFLATED) as zout:
        skip = {"[Content_Types].xml", "ppt/_rels/presentation.xml.rels"}
        for name, data in existing.items():
            if name in skip:
                continue
            if name.startswith("ppt/notesSlides/") or name.startswith("ppt/notesMasters/"):
                continue
            if name.startswith("ppt/slides/_rels/slide") and name.endswith(".xml.rels"):
                continue
            zout.writestr(name, data)

        for idx, _slide_name in enumerate(slide_names, start=1):
            rel_path = f"ppt/slides/_rels/slide{idx}.xml.rels"
            rels_root = ET.fromstring(existing[rel_path]) if rel_path in existing else ET.Element(f"{{{REL_NS}}}Relationships")
            rel = ET.Element(f"{{{REL_NS}}}Relationship")
            rel.set("Id", _next_rid(rels_root))
            rel.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide")
            rel.set("Target", f"../notesSlides/notesSlide{idx}.xml")
            rels_root.append(rel)
            zout.writestr(rel_path, ET.tostring(rels_root, encoding="utf-8", xml_declaration=True))

            add_override(f"/ppt/notesSlides/notesSlide{idx}.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml")
            note = notes[idx - 1] if idx - 1 < len(notes) else ""
            zout.writestr(f"ppt/notesSlides/notesSlide{idx}.xml", _notes_slide_xml(note).encode("utf-8"))
            zout.writestr(
                f"ppt/notesSlides/_rels/notesSlide{idx}.xml.rels",
                f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide{idx}.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/></Relationships>""".encode("utf-8"),
            )

        zout.writestr("ppt/notesMasters/notesMaster1.xml", _notes_master_xml().encode("utf-8"))
        zout.writestr("ppt/_rels/presentation.xml.rels", ET.tostring(pres_rels, encoding="utf-8", xml_declaration=True))
        zout.writestr("[Content_Types].xml", ET.tostring(content_types, encoding="utf-8", xml_declaration=True))


def load_notes(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, list):
        return [str(x) for x in data]
    slides = data.get("slides", [])
    return [str(s.get("notes") or s.get("speaker_notes") or "") for s in slides]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_pptx")
    parser.add_argument("notes_json", help="JSON list of notes or a deck spec with slides[].notes")
    parser.add_argument("output_pptx")
    args = parser.parse_args()
    add_speaker_notes(args.input_pptx, load_notes(Path(args.notes_json)), args.output_pptx)
    print(f"Wrote {args.output_pptx}")


if __name__ == "__main__":
    main()
