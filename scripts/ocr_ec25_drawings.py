#!/usr/bin/env python3
"""
EC25 全図面PDF（スキャン）のタイトルブロックを OCR し、図番→頁を索引する。

PDFタイトルブロック:
  品名 上段 → パーツ名
  品名 下段 → 機種名
  図番     → パーツキー（△1 は -1 と同一視）

依存: pymupdf, numpy, rapidocr（優先・高速） / easyocr（フォールバック）
例:
  python scripts/ocr_ec25_drawings.py --pdf "path/to.pdf" --out exports/ec25-drawing-index.json
  python scripts/ocr_ec25_drawings.py --pdf "path/to.pdf" --render-drawings SK10-1511,SK10-1512-1 --images-dir tmp/ec25-pages
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import re
import sys
from pathlib import Path


DRAWING_RE = re.compile(
    r"(?:"
    r"SK\s*10|SK\s*02|SP\s*11|SPR\s*0?1|CVES|A3B|A4B|S-?FX|"
    r"SSK|HMG\s*\d{2}"
    r")"
    r"[- ]?[0-9A-Z][0-9A-Z\- △▲Δ∆▽]{0,28}",
    re.I,
)
DRAWING_FALLBACK_RE = re.compile(
    r"(?:SK\d+|SK02|SP11|SPR0?1|CVES|A3B|A4B|SFX|SSK|HMG\d{2})(?:-[0-9A-Z]+)+",
    re.I,
)
MODEL_RE = re.compile(r"環境負荷|環墳負荷|乾燥機|乾爆機|葉もぎ|藁もぎ|菓子巻|もぎ機|EC\s*[\d_１Iｌ己P]?\s*型")
TITLE_LABEL_MAP = {
    "図番": "drawing_no",
    "図面番号": "drawing_no",
    "図名": "part_name",
    "品名": "part_name",
    "部品名": "part_name",
    "機種名": "model_name",
    "機種": "model_name",
    "材質": "material",
}
NOISE_RE = re.compile(
    r"承認|検図|設計|製図|尺度|材質|三州|産業|株式会|有留|担当|作成|個数|型式|図中|技術課|表面処理"
)
MATERIAL_RE = re.compile(
    r"(?:ZAM|SPHC|SGCC|SECC|S45C|SS400|SUS\s*\d+|FB\s*\d+\s*[×xX]?\s*t?\d|カラー鋼板|t\s*\d+(?:\.\d+)?)",
    re.I,
)
OCR_CONFUSABLES = str.maketrans(
    {
        "町": "部",
        "爆": "燥",
        "様": "機",
        "転": "乾",
        "盆": "図",
        "課": "面",
        "飛": "産",
        "麗": "州",
    }
)


def canonicalize_drawing(raw: str) -> str:
    if not raw:
        return ""
    s = raw.upper().replace(" ", "").replace("\u3000", "")
    for a, b in [("一", "-"), ("–", "-"), ("—", "-"), ("ー", "-")]:
        s = s.replace(a, b)
    s = (
        s.replace("SKIO", "SK10")
        .replace("SK1O", "SK10")
        .replace("SKI0", "SK10")
        .replace("SKL0", "SK10")
    )
    s = re.sub(r"[#＃]\d+$", "", s)
    s = re.sub(r"[-]?(?:△|▲|Δ|∆|▽)\s*(\d+)", r"-\1", s)
    s = re.sub(r"-+", "-", s).strip("-")
    m = DRAWING_RE.search(s) or re.search(
        r"(?:SK\d+|SK02|SP11|SPR0?1|CVES|A3B|A4B|SFX)(?:-[0-9A-Z]+)+", s
    )
    if not m:
        return ""
    return re.sub(r"[-]?(?:△|▲|Δ|∆|▽)\s*(\d+)", r"-\1", m.group(0).replace(" ", "")).strip("-")


def drawing_family(raw: str) -> str:
    c = canonicalize_drawing(raw)
    if not c:
        return ""
    parts = c.split("-")
    if len(parts) >= 3 and parts[-1].isdigit():
        return "-".join(parts[:-1])
    return c


def compact_name(raw: str) -> str:
    return re.sub(r"[\s\u3000()（）・,，、]", "", str(raw or ""))


def fold_ocr_name(raw: str) -> str:
    s = compact_name(raw).translate(OCR_CONFUSABLES)
    return s.replace("せ切", "仕切").replace("乾爆", "乾燥").replace("火固定", "火炉固定")


def name_score(excel_name: str, ocr_name: str) -> float:
    from difflib import SequenceMatcher

    a = compact_name(excel_name)
    if not a or len(a) < 2:
        return 0.0
    best = 0.0
    for v in (compact_name(ocr_name), fold_ocr_name(ocr_name)):
        if not v or len(v) < 2:
            continue
        if a == v:
            return 1.0
        if a in v or v in a:
            best = max(best, 0.92)
        best = max(best, SequenceMatcher(None, a, v).ratio())
    return best


def emit_progress(payload: dict) -> None:
    print("PROGRESS " + json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)


TITLE_CLIPS = (
    (0.55, 0.64, 1.0, 1.0),
    (0.48, 0.70, 1.0, 1.0),
    (0.42, 0.62, 1.0, 1.0),
)
TITLE_BLOCK_FRAC = (0.55, 0.64, 1.0, 1.0)

_ENGINE = None
_DOC = None
_DPI = 130


class RapidAdapter:
    def __init__(self, engine):
        self.engine = engine

    def read_items(self, arr):
        out = self.engine(arr, use_cls=False)
        boxes = getattr(out, "boxes", None)
        txts = getattr(out, "txts", None)
        scores = getattr(out, "scores", None)
        if boxes is None:
            boxes = []
        if txts is None:
            txts = []
        if scores is None:
            scores = []
        items = []
        for i, text in enumerate(txts):
            raw_box = boxes[i] if i < len(boxes) else [[0, 0], [1, 0], [1, 1], [0, 1]]
            conf = float(scores[i]) if i < len(scores) else 0.0
            pts = []
            try:
                for p in raw_box:
                    pts.append([float(p[0]), float(p[1])])
            except (TypeError, ValueError, IndexError):
                pts = [[0, 0], [1, 0], [1, 1], [0, 1]]
            if len(pts) < 4:
                pts = [[0, 0], [1, 0], [1, 1], [0, 1]]
            items.append((pts, str(text or "").strip(), conf))
        return items


class EasyAdapter:
    def __init__(self, reader):
        self.reader = reader

    def read_items(self, arr):
        return self.reader.readtext(
            arr,
            detail=1,
            paragraph=False,
            mag_ratio=1.0,
            canvas_size=1280,
            min_size=12,
        )


def create_title_engine():
    try:
        from rapidocr import RapidOCR

        engine = RapidOCR(
            params={
                "Global.use_cls": False,
                "Global.log_level": "error",
                "EngineConfig.onnxruntime.intra_op_num_threads": 1,
                "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            }
        )
        return RapidAdapter(engine)
    except Exception as exc:
        import easyocr

        print(f"RapidOCR を使えないため EasyOCR に切替: {exc}", file=sys.stderr)
        reader = easyocr.Reader(["ja", "en"], gpu=False, verbose=False)
        return EasyAdapter(reader)


def ocr_reader():
    return create_title_engine()


def _limit_width(arr, max_w: int = 800):
    import numpy as np

    if arr is None or arr.size == 0:
        return arr
    h, w = arr.shape[:2]
    if w <= max_w or w < 32:
        return arr
    nh = max(1, int(round(h * (max_w / float(w)))))
    try:
        import cv2

        return cv2.resize(arr, (max_w, nh), interpolation=cv2.INTER_AREA)
    except Exception:
        yi = (np.linspace(0, h - 1, nh)).astype(np.int32)
        xi = (np.linspace(0, w - 1, max_w)).astype(np.int32)
        return arr[yi][:, xi]


def render_title_clip(page, dpi: int, frac: tuple[float, float, float, float], max_w: int = 800):
    import fitz
    import numpy as np

    rect = page.rect
    x0, y0, x1, y1 = frac
    clip = fitz.Rect(
        rect.x0 + rect.width * x0,
        rect.y0 + rect.height * y0,
        rect.x0 + rect.width * x1,
        rect.y0 + rect.height * y1,
    )
    if clip.width < 8 or clip.height < 8:
        return None
    pix = page.get_pixmap(
        matrix=fitz.Matrix(dpi / 72, dpi / 72),
        clip=clip,
        alpha=False,
        colorspace=fitz.csGRAY,
    )
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    if arr.size == 0:
        return None
    rgb = np.stack([arr, arr, arr], axis=-1)
    return _limit_width(rgb, max_w)


def items_to_page_boxes(items, frac: tuple[float, float, float, float], crop_w: int, crop_h: int) -> list[dict]:
    x0, y0, x1, y1 = frac
    fw = max(1e-6, x1 - x0)
    fh = max(1e-6, y1 - y0)
    if crop_w <= 0 or crop_h <= 0:
        return []
    out: list[dict] = []
    for item in items:
        box, text, conf = item[0], str(item[1] or "").strip(), float(item[2] or 0)
        if not text:
            continue
        try:
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
        except (TypeError, ValueError, IndexError):
            continue
        if not xs or not ys:
            continue
        out.append(
            {
                "text": text,
                "conf": round(conf, 3),
                "x0": round(x0 + (min(xs) / crop_w) * fw, 5),
                "y0": round(y0 + (min(ys) / crop_h) * fh, 5),
                "x1": round(x0 + (max(xs) / crop_w) * fw, 5),
                "y1": round(y0 + (max(ys) / crop_h) * fh, 5),
            }
        )
    return out


def merge_page_boxes(existing: list[dict], incoming: list[dict]) -> list[dict]:
    for b in incoming:
        dup = False
        for e in existing:
            if (
                e.get("text") == b.get("text")
                and abs(float(e.get("x0") or 0) - float(b.get("x0") or 0)) < 0.012
                and abs(float(e.get("y0") or 0) - float(b.get("y0") or 0)) < 0.012
            ):
                dup = True
                break
        if not dup:
            existing.append(b)
    return existing


def relabel_boxes(boxes: list[dict], page_no: int) -> list[dict]:
    out = []
    for i, b in enumerate(boxes):
        rec = dict(b)
        rec["id"] = f"p{page_no}-b{i}"
        out.append(rec)
    return out


def ocr_clip(
    engine,
    page,
    dpi: int,
    frac: tuple[float, float, float, float],
    max_w: int = 800,
) -> tuple[list[dict], dict]:
    arr = render_title_clip(page, dpi, frac, max_w=max_w)
    if arr is None:
        return [], empty_title()
    items = engine.read_items(arr)
    parsed = parse_title_block(items)
    h, w = arr.shape[:2]
    return items_to_page_boxes(items, frac, w, h), parsed


def items_from_plain_text(text: str) -> list:
    items = []
    for y, line in enumerate(str(text or "").splitlines()):
        t = line.strip()
        if t:
            items.append(([[0, y], [80, y], [80, y + 1], [0, y + 1]], t, 1.0))
    return items


def _center(box) -> tuple[float, float]:
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    return (sum(xs) / 4.0, sum(ys) / 4.0)


def extract_drawing_candidates(texts: list[str]) -> list[str]:
    joined = "".join(texts).replace(" ", "").replace("\u3000", "")
    joined = (
        joined.upper()
        .replace("SKIO", "SK10")
        .replace("SK1O", "SK10")
        .replace("SKI0", "SK10")
        .replace("SKL0", "SK10")
    )
    found: list[str] = []
    for m in DRAWING_RE.finditer(joined):
        d = canonicalize_drawing(m.group(0))
        if d and d not in found:
            found.append(d)
    if not found:
        blob = joined.upper()
        for m in DRAWING_FALLBACK_RE.finditer(blob):
            d = canonicalize_drawing(m.group(0))
            if d and d not in found and not d.startswith("EC25-") and not d.startswith("EC30"):
                found.append(d)
    return found


def _item_box(box) -> tuple[float, float, float, float, float, float]:
    xs = [float(p[0]) for p in box]
    ys = [float(p[1]) for p in box]
    return min(xs), min(ys), max(xs), max(ys), sum(xs) / 4.0, sum(ys) / 4.0


def _value_near_label(label_item, items: list) -> str:
    lx0, ly0, lx1, ly1, lcx, lcy = _item_box(label_item[0])
    lh = max(1.0, ly1 - ly0)
    best = ""
    best_score = 1e18
    for item in items:
        if item is label_item:
            continue
        text = str(item[1] or "").strip()
        key = compact_name(text)
        if not text or key in TITLE_LABEL_MAP:
            continue
        x0, y0, x1, y1, cx, cy = _item_box(item[0])
        if x0 >= lx1 - 6 and abs(cy - lcy) <= lh * 1.5:
            dist = x0 - lx1
            if 0 <= dist < 480 and dist < best_score:
                best, best_score = text, dist
        elif y0 >= ly1 - 6 and abs(cx - lcx) < 200:
            dist = 180 + (y0 - ly1)
            if 0 <= (y0 - ly1) < 90 and dist < best_score:
                best, best_score = text, dist
    return best


def parse_title_block(items: list[tuple]) -> dict:
    """OCR items → 図番 / 図名 / 機種名 / 材質。ラベル右・下の値を優先する。"""
    rows = []
    for item in items:
        box, text, conf = item[0], str(item[1] or "").strip(), float(item[2] or 0)
        if not text:
            continue
        cx, cy = _center(box)
        rows.append({"text": text, "conf": conf, "x": cx, "y": cy, "item": item})
    rows.sort(key=lambda r: (r["y"], r["x"]))

    texts = [r["text"] for r in rows]
    drawings = extract_drawing_candidates(texts)
    for i, r in enumerate(rows):
        nxt = rows[i + 1]["text"] if i + 1 < len(rows) else ""
        combo = canonicalize_drawing(r["text"] + nxt)
        if combo and combo not in drawings and DRAWING_RE.search(combo.replace(" ", "")):
            drawings.append(combo)

    labeled = {"drawing_no": "", "part_name": "", "model_name": "", "material": ""}
    for r in rows:
        field = TITLE_LABEL_MAP.get(compact_name(r["text"]))
        if not field or labeled[field]:
            continue
        val = _value_near_label(r["item"], items)
        if val:
            if field == "drawing_no":
                labeled[field] = canonicalize_drawing(val) or val
            else:
                labeled[field] = val

    model_name = labeled["model_name"]
    if not model_name:
        for r in rows:
            if MODEL_RE.search(r["text"]):
                model_name = r["text"]
                break

    part_name = labeled["part_name"]
    if not part_name:
        name_cands: list[str] = []
        for r in rows:
            t = r["text"]
            if NOISE_RE.search(t) or MODEL_RE.search(t) or canonicalize_drawing(t):
                continue
            if compact_name(t) in TITLE_LABEL_MAP:
                continue
            jp = len(re.findall(r"[\u3040-\u30ff\u4e00-\u9fff]", t))
            if jp >= 2 and len(t) >= 2:
                name_cands.append(t)
        if name_cands:
            part_name = max(name_cands, key=len)

    drawing_no = labeled["drawing_no"] or (drawings[0] if drawings else "")
    material = labeled["material"]
    if not material:
        blob = " ".join(texts)
        mats = [m.group(0).replace(" ", "") for m in MATERIAL_RE.finditer(blob)]
        uniq: list[str] = []
        for m in mats:
            if m.upper() not in {x.upper() for x in uniq}:
                uniq.append(m)
        material = " / ".join(uniq[:4])
    return {
        "drawing_no": drawing_no,
        "drawings": drawings,
        "part_name": part_name,
        "model_name": model_name,
        "material": material,
        "ocr": " ".join(texts)[:400],
    }


def ocr_title_image(engine, arr) -> dict:
    if arr is None or getattr(arr, "size", 0) == 0:
        return empty_title()
    items = engine.read_items(arr)
    return parse_title_block(items)


def merge_title_parse(best: dict, parsed: dict, seen: list[str]) -> dict:
    for d in parsed.get("drawings") or []:
        if d and d not in seen:
            seen.append(d)
    if not best.get("drawing_no") and parsed.get("drawing_no"):
        best = dict(parsed)
    elif parsed.get("drawing_no") and len(parsed["drawing_no"]) > len(best.get("drawing_no") or ""):
        best = dict(parsed)
    if not best.get("part_name") and parsed.get("part_name"):
        best["part_name"] = parsed["part_name"]
    if not best.get("model_name") and parsed.get("model_name"):
        best["model_name"] = parsed["model_name"]
    if not best.get("material") and parsed.get("material"):
        best["material"] = parsed["material"]
    if parsed.get("ocr") and (not best.get("ocr") or len(parsed["ocr"]) > len(best.get("ocr") or "")):
        best["ocr"] = parsed["ocr"]
    best["drawings"] = seen or best.get("drawings") or []
    if not best.get("drawing_no") and seen:
        best["drawing_no"] = seen[0]
    return best


def ocr_title_crops(reader, arr) -> dict:
    engine = reader if hasattr(reader, "read_items") else EasyAdapter(reader)
    h, w = arr.shape[:2]
    crops = [
        arr[int(h * 0.70) :, int(w * 0.48) :],
        arr[int(h * 0.62) :, int(w * 0.42) :],
    ]
    best = empty_title()
    seen: list[str] = []
    for crop in crops:
        if crop.size == 0:
            continue
        parsed = ocr_title_image(engine, _limit_width(crop))
        best = merge_title_parse(best, parsed, seen)
        if best.get("drawing_no"):
            break
    return best


def empty_title() -> dict:
    return {
        "drawing_no": "",
        "drawings": [],
        "part_name": "",
        "model_name": "",
        "material": "",
        "ocr": "",
    }


def classify_page_kind(header_ocr: str, drawing_no: str, page_width: float) -> str:
    h = compact_name(header_ocr)
    if "製作指図" in h:
        return "sashizu"
    if "製作内容" in h or "詳細表" in h:
        return "detail"
    if "見積" in h:
        return "quote"
    if "購入部品" in h or "購入品一覧" in h or "購入品リスト" in h or "購入品表" in h:
        return "purchase_list"
    if drawing_no:
        return "drawing"
    if page_width >= 700:
        return "drawing"
    return "document"


def page_record(i: int, parsed: dict, page_kind: str = "", header_ocr: str = "", page_width: float = 0) -> dict:
    found = parsed.get("drawings") or []
    drawing_no = canonicalize_drawing(parsed.get("drawing_no") or (found[0] if found else ""))
    part_name = parsed.get("part_name") or ""
    model_name = parsed.get("model_name") or ""
    kind = page_kind or classify_page_kind(header_ocr, drawing_no, page_width)
    return {
        "page": i + 1,
        "page_kind": kind,
        "drawing_no": drawing_no,
        "part_name": part_name,
        "model_name": model_name,
        "material": parsed.get("material") or "",
        "drawings": [canonicalize_drawing(d) for d in found if canonicalize_drawing(d)],
        "ocr": parsed.get("ocr") or "",
        "header_ocr": (header_ocr or "")[:300],
        "width": page_width,
        "boxes": [],
    }


def ocr_pdf_page(page, i: int, engine, dpi: int) -> dict:
    native = ""
    try:
        native = page.get_text("text") or ""
    except Exception:
        native = ""
    width = float(getattr(page.rect, "width", 0) or 0)
    height = float(getattr(page.rect, "height", 0) or 0)
    boxes: list[dict] = []
    header_frac = (0.0, 0.0, 1.0, 0.22)
    header_boxes, header_parsed = ocr_clip(engine, page, min(dpi, 120), header_frac)
    header_ocr = header_parsed.get("ocr") or ""
    boxes = merge_page_boxes(boxes, header_boxes)

    title_boxes, title_parsed = ocr_clip(engine, page, max(dpi, 160), TITLE_BLOCK_FRAC, max_w=1200)
    boxes = merge_page_boxes(boxes, title_boxes)
    best = merge_title_parse(empty_title(), title_parsed, [])
    seen: list[str] = list(best.get("drawings") or [])
    best = merge_title_parse(best, header_parsed, seen)

    if native.strip():
        parsed = parse_title_block(items_from_plain_text(native))
        best = merge_title_parse(best, parsed, seen)

    locked = {"sashizu", "detail", "quote", "purchase_list"}
    kind = classify_page_kind(header_ocr, best.get("drawing_no") or "", width)
    if kind == "document" and (best.get("drawing_no") or best.get("part_name")):
        kind = "drawing"
    if kind not in locked and width > height * 1.05:
        kind = "drawing"

    if kind in locked or kind == "document":
        full_boxes, full_parsed = ocr_clip(engine, page, min(dpi, 110), (0.0, 0.0, 1.0, 1.0), max_w=1100)
        boxes = merge_page_boxes(full_boxes, boxes)
        best = merge_title_parse(best, full_parsed, seen)
        kind = classify_page_kind(header_ocr or full_parsed.get("ocr") or "", best.get("drawing_no") or "", width)
        if kind == "document" and (best.get("drawing_no") or ""):
            kind = "drawing"

    rec = page_record(i, best, page_kind=kind, header_ocr=header_ocr, page_width=width)
    rec["boxes"] = relabel_boxes(boxes, rec["page"])
    rec["height"] = height
    return rec


def _init_worker(pdf_path: str, dpi: int) -> None:
    global _ENGINE, _DOC, _DPI
    import fitz

    _DPI = dpi
    _DOC = fitz.open(pdf_path)
    _ENGINE = create_title_engine()


def _ocr_page_i(i: int) -> dict:
    return ocr_pdf_page(_DOC[i], i, _ENGINE, _DPI)


def default_workers() -> int:
    cpu = os.cpu_count() or 2
    return max(1, min(4, cpu - 1))


def collect_index_maps(pages: list[dict], pdf_path: Path, page_count: int) -> dict:
    by_drawing: dict[str, list[int]] = {}
    by_name: dict[str, list[int]] = {}
    for rec in pages:
        for d in rec.get("drawings") or ([rec.get("drawing_no")] if rec.get("drawing_no") else []):
            key = canonicalize_drawing(d or "")
            if key:
                by_drawing.setdefault(key, []).append(rec["page"])
        if rec.get("part_name"):
            by_name.setdefault(rec["part_name"], []).append(rec["page"])
    return {
        "pdf": str(pdf_path),
        "page_count": page_count,
        "indexed_pages": len(pages),
        "drawings": {k: sorted(set(v)) for k, v in by_drawing.items()},
        "by_name": {k: sorted(set(v)) for k, v in by_name.items()},
        "pages": pages,
    }


def index_pdf_images_only(pdf_path: Path, max_pages: int | None = None) -> dict:
    import fitz

    doc = fitz.open(pdf_path)
    n = doc.page_count if max_pages is None else min(doc.page_count, max_pages)
    emit_progress({"phase": "render", "page": 0, "total": n})
    pages: list[dict] = []
    for i in range(n):
        page = doc[i]
        width = float(page.rect.width)
        height = float(page.rect.height)
        landscape = width > height
        if i == 0 and not landscape:
            kind = "sashizu"
        elif landscape:
            kind = "drawing"
        else:
            kind = "document"
        rec = page_record(i, empty_title(), page_kind=kind, page_width=width)
        rec["boxes"] = []
        pages.append(rec)
        emit_progress({"phase": "render", "page": i + 1, "total": n})
    return collect_index_maps(pages, pdf_path, doc.page_count)


def ocr_user_boxes(image_path: Path, boxes: list[dict]) -> list[dict]:
    from PIL import Image
    import numpy as np

    engine = create_title_engine()
    img = np.array(Image.open(image_path).convert("RGB"))
    if img.size == 0:
        return [{"id": b.get("id"), "text": "", "conf": 0} for b in boxes]
    h, w = img.shape[:2]
    out: list[dict] = []
    for b in boxes:
        x0 = int(round(max(0.0, min(float(w), float(b.get("x0") or 0) * w))))
        x1 = int(round(max(0.0, min(float(w), float(b.get("x1") or 0) * w))))
        y0 = int(round(max(0.0, min(float(h), float(b.get("y0") or 0) * h))))
        y1 = int(round(max(0.0, min(float(h), float(b.get("y1") or 0) * h))))
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if x1 - x0 < 4 or y1 - y0 < 4:
            out.append({"id": b.get("id"), "text": "", "conf": 0})
            continue
        crop = img[y0:y1, x0:x1]
        crop = np.pad(crop, ((10, 10), (10, 10), (0, 0)), constant_values=255)
        ch, cw = crop.shape[:2]
        if max(cw, ch) < 280:
            scale = 280 / max(cw, ch)
            try:
                import cv2

                crop = cv2.resize(crop, (max(1, int(cw * scale)), max(1, int(ch * scale))), interpolation=cv2.INTER_CUBIC)
            except Exception:
                pass
        items = engine.read_items(crop)
        texts = [str(t).strip() for _, t, _c in items if str(t or "").strip()]
        confs = [float(_c or 0) for _, t, _c in items if str(t or "").strip()]
        out.append(
            {
                "id": b.get("id"),
                "text": " ".join(texts).strip(),
                "conf": round(max(confs) if confs else 0.0, 3),
            }
        )
    return out


def index_pdf(
    pdf_path: Path,
    dpi: int = 130,
    max_pages: int | None = None,
    workers: int | None = None,
) -> dict:
    import fitz

    doc = fitz.open(pdf_path)
    n = doc.page_count if max_pages is None else min(doc.page_count, max_pages)
    worker_n = default_workers() if workers is None else max(1, int(workers))
    if n <= 2:
        worker_n = 1
    emit_progress({"phase": "loading", "page": 0, "total": n, "workers": worker_n})

    pages: list[dict] = []
    if worker_n == 1:
        engine = create_title_engine()
        emit_progress({"phase": "ocr", "page": 0, "total": n})
        for i in range(n):
            rec = ocr_pdf_page(doc[i], i, engine, dpi)
            pages.append(rec)
            print(
                f"page {rec['page']}/{n} {rec['drawing_no'] or '-'} {rec['part_name'] or ''}",
                file=sys.stderr,
                flush=True,
            )
            emit_progress(
                {
                    "phase": "ocr",
                    "page": rec["page"],
                    "total": n,
                    "found": rec.get("drawings") or [],
                    "drawing_no": rec["drawing_no"],
                    "part_name": rec["part_name"],
                }
            )
    else:
        try:
            ctx = mp.get_context("spawn")
            done = 0
            with ctx.Pool(processes=worker_n, initializer=_init_worker, initargs=(str(pdf_path), dpi)) as pool:
                emit_progress({"phase": "ocr", "page": 0, "total": n, "workers": worker_n})
                for rec in pool.imap_unordered(_ocr_page_i, range(n), chunksize=1):
                    pages.append(rec)
                    done += 1
                    print(
                        f"page {rec['page']}/{n} {rec['drawing_no'] or '-'} {rec['part_name'] or ''}",
                        file=sys.stderr,
                        flush=True,
                    )
                    emit_progress(
                        {
                            "phase": "ocr",
                            "page": done,
                            "total": n,
                            "found": rec.get("drawings") or [],
                            "drawing_no": rec["drawing_no"],
                            "part_name": rec["part_name"],
                        }
                    )
            pages.sort(key=lambda r: r["page"])
        except Exception as exc:
            print(f"並列OCRに失敗したため逐次実行: {exc}", file=sys.stderr, flush=True)
            return index_pdf(pdf_path, dpi=dpi, max_pages=n, workers=1)

    return collect_index_maps(pages, pdf_path, doc.page_count)


def resolve_pages(index: dict, drawing: str, part_name: str = "") -> list[int]:
    drawings = index.get("drawings") or {}
    pages = index.get("pages") or []
    wanted = canonicalize_drawing(drawing)
    family = drawing_family(wanted)
    if wanted:
        for key, nums in drawings.items():
            if canonicalize_drawing(key) == wanted:
                return sorted(set(nums))
        hit = [p["page"] for p in pages if canonicalize_drawing(p.get("drawing_no") or "") == wanted]
        if hit:
            return sorted(set(hit))
        family_keys = [k for k in drawings if drawing_family(k) == family]
        if len(family_keys) == 1:
            return sorted(set(drawings[family_keys[0]]))
        family_pages = []
        fam_drawings = set()
        for p in pages:
            d = canonicalize_drawing(p.get("drawing_no") or "")
            if drawing_family(d) == family:
                family_pages.append(p["page"])
                fam_drawings.add(d)
        if len(fam_drawings) == 1 and family_pages:
            return sorted(set(family_pages))
        if family_keys and len(set(sum((drawings[k] for k in family_keys), []))) == 1:
            return sorted(set(drawings[family_keys[0]]))

    if part_name:
        scored = []
        for p in pages:
            s = name_score(part_name, p.get("part_name") or "")
            if s >= 0.72:
                scored.append((s, p))
        if scored:
            scored.sort(key=lambda x: -x[0])
            fam = [p for s, p in scored if drawing_family(p.get("drawing_no") or "") == family]
            pick = fam or [p for _, p in scored]
            return sorted(set(p["page"] for p in pick[:2]))
        name_map = index.get("by_name") or {}
        hits = []
        for name, nums in name_map.items():
            if name_score(part_name, name) >= 0.72:
                hits.extend(nums)
        if hits:
            return sorted(set(hits))
    return []


def render_pages(
    pdf_path: Path,
    page_nos: list[int],
    images_dir: Path,
    dpi: int = 160,
    jpeg: bool = False,
    max_width: int = 1000,
) -> list[dict]:
    import fitz

    images_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    out = []
    for pno in page_nos:
        if pno < 1 or pno > doc.page_count:
            continue
        page = doc[pno - 1]
        scale = 1.0
        raw_w = max(1.0, float(page.rect.width) * dpi / 72.0)
        if jpeg and raw_w > max_width:
            scale = max_width / raw_w
        pix = page.get_pixmap(matrix=fitz.Matrix((dpi / 72) * scale, (dpi / 72) * scale), alpha=False)
        if jpeg:
            dest = images_dir / f"page-{pno:03d}.jpg"
            try:
                pix.save(str(dest), jpg_quality=78)
            except Exception:
                dest = images_dir / f"page-{pno:03d}.png"
                pix.save(str(dest))
            rec = {"page": pno, "path": str(dest), "width": pix.width, "height": pix.height}
            tdest = images_dir / f"title-{pno:03d}.jpg"
            title_info = render_title_jpeg(page, tdest, TITLE_BLOCK_FRAC, dpi=170)
            if title_info:
                rec["title_path"] = title_info["path"]
                rec["title_width"] = title_info["width"]
                rec["title_height"] = title_info["height"]
            out.append(rec)
        else:
            dest = images_dir / f"page-{pno:03d}.png"
            pix.save(str(dest))
            out.append({"page": pno, "path": str(dest), "width": pix.width, "height": pix.height})
    return out


def render_title_jpeg(page, dest: Path, frac: tuple[float, float, float, float], dpi: int = 170) -> dict | None:
    import fitz

    rect = page.rect
    x0, y0, x1, y1 = frac
    clip = fitz.Rect(
        rect.x0 + rect.width * x0,
        rect.y0 + rect.height * y0,
        rect.x0 + rect.width * x1,
        rect.y0 + rect.height * y1,
    )
    if clip.width < 8 or clip.height < 8:
        return None
    pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), clip=clip, alpha=False)
    try:
        pix.save(str(dest), jpg_quality=82)
    except Exception:
        dest = dest.with_suffix(".png")
        pix.save(str(dest))
    return {"path": str(dest), "width": pix.width, "height": pix.height}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default="")
    ap.add_argument("--png", default="", help="単ページPNGのタイトルブロック検証")
    ap.add_argument("--out", default="")
    ap.add_argument("--index-json", default="")
    ap.add_argument("--max-pages", type=int, default=0)
    ap.add_argument("--render-pages", default="", help="comma page numbers 1-based")
    ap.add_argument("--render-drawings", default="", help="comma drawing nos")
    ap.add_argument("--part-names", default="", help="comma part names aligned with render-drawings")
    ap.add_argument("--targets-json", default="", help='[{"drawing":"...","name":"..."}]')
    ap.add_argument("--images-dir", default="")
    ap.add_argument("--result-json", default="")
    ap.add_argument("--dpi", type=int, default=130)
    ap.add_argument("--workers", type=int, default=0, help="並列数。0 なら CPU に応じて自動（最大4）")
    ap.add_argument(
        "--dorder",
        action="store_true",
        help="製作指図書PDF: 文書ページを画像化し page_kind を付ける",
    )
    ap.add_argument("--images-only", action="store_true", help="OCRせずページ画像だけ出す")
    ap.add_argument("--ocr-image", default="", help="指定画像の枠だけOCR")
    ap.add_argument("--boxes-json", default="", help="枠座標JSON（--ocr-image用）")
    args = ap.parse_args()

    if args.ocr_image:
        raw = args.boxes_json
        if raw.startswith("@") or (raw and Path(raw).exists()):
            raw = Path(raw[1:] if raw.startswith("@") else raw).read_text(encoding="utf-8")
        boxes = json.loads(raw or "[]")
        result = ocr_user_boxes(Path(args.ocr_image), boxes if isinstance(boxes, list) else [])
        print(json.dumps({"boxes": result}, ensure_ascii=False))
        return 0

    if args.png:
        from PIL import Image
        import numpy as np

        reader = ocr_reader()
        arr = np.array(Image.open(args.png).convert("RGB"))
        parsed = ocr_title_crops(reader, arr)
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
        return 0

    if not args.pdf:
        print("PDF not specified", file=sys.stderr)
        return 2

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 2

    index = None
    need_index = bool(args.out) or bool(args.render_drawings) or bool(args.targets_json) or bool(args.dorder)
    if args.index_json:
        index = json.loads(Path(args.index_json).read_text(encoding="utf-8"))
        need_index = False
    if args.images_only:
        index = index_pdf_images_only(pdf_path, max_pages=args.max_pages or None)
        if args.out:
            Path(args.out).write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
        need_index = False
    if need_index and not index:
        index = index_pdf(
            pdf_path,
            dpi=args.dpi,
            max_pages=args.max_pages or None,
            workers=args.workers or None,
        )
        if args.out:
            Path(args.out).write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    rendered = []
    page_nos: list[int] = []
    targets = []
    if args.targets_json:
        raw = args.targets_json
        if raw.startswith("@") or Path(raw).exists():
            raw = Path(raw[1:] if raw.startswith("@") else raw).read_text(encoding="utf-8")
        targets = json.loads(raw)
    elif args.render_drawings:
        drawings = [x.strip() for x in args.render_drawings.split(",") if x.strip()]
        names = [x.strip() for x in args.part_names.split(",")] if args.part_names else []
        targets = [{"drawing": d, "name": names[i] if i < len(names) else ""} for i, d in enumerate(drawings)]

    if args.render_pages:
        page_nos.extend(int(x) for x in args.render_pages.split(",") if x.strip().isdigit())

    if targets:
        if index is None:
            index = index_pdf(
                pdf_path,
                dpi=args.dpi,
                max_pages=args.max_pages or None,
                workers=args.workers or None,
            )
        for t in targets:
            pages = resolve_pages(index, t.get("drawing") or "", t.get("name") or "")
            t["pages"] = pages
            page_nos.extend(pages)

    if args.dorder and index:
        doc_kinds = {"sashizu", "detail", "quote", "purchase_list", "document"}
        all_pages = [int(p["page"]) for p in (index.get("pages") or [])]
        doc_pages = [
            int(p["page"])
            for p in (index.get("pages") or [])
            if str(p.get("page_kind") or "") in doc_kinds
        ]
        page_nos.extend(all_pages or doc_pages)
        index["doc_pages"] = doc_pages
        index["doc_type"] = "sashizu" if any(
            str(p.get("page_kind")) == "sashizu" for p in (index.get("pages") or [])
        ) else "mixed"

    if page_nos:
        images_dir = Path(args.images_dir or (Path(args.out).parent if args.out else Path("exports/ec25-pages")))
        rendered = render_pages(
            pdf_path,
            sorted(set(page_nos)),
            images_dir,
            dpi=100 if args.dorder else max(args.dpi, 150),
            jpeg=bool(args.dorder),
            max_width=900 if args.dorder else 1400,
        )

    result = index or {"pdf": str(pdf_path), "drawings": {}, "pages": []}
    result["rendered"] = rendered
    if targets:
        result["targets"] = targets
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
    if args.result_json:
        Path(args.result_json).write_text(payload, encoding="utf-8")
    if not args.out:
        print(payload)
    return 0


if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main())
