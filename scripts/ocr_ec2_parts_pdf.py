#!/usr/bin/env python3
"""
EC2 試作 部品表PDF（スキャン）を OCR し、D指令・原価部品 JSON を出力する。

依存: pymupdf, easyocr, numpy
例:
  python scripts/ocr_ec2_parts_pdf.py ^
    --parts-pdf "C:\\Users\\S002\\Downloads\\★EC2型乾燥機試作図面一覧表_部品表.pdf" ^
    --out exports/ec2-bom-parsed.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path


def normalize_drawing(raw: str) -> str:
    if not raw:
        return ""
    s = raw.upper().replace(" ", "")
    for a, b in [("一", "-"), ("–", "-"), ("—", "-"), ("ー", "-")]:
        s = s.replace(a, b)
    s = (
        s.replace("SKIO", "SK10")
        .replace("SK1O", "SK10")
        .replace("SKI0", "SK10")
        .replace("SKL0", "SK10")
    )
    s = re.sub(r"SK10+", "SK10", s)
    m = re.search(r"SK10[-]?([0-9OILA-Z\-]+)", s)
    if m:
        rest = m.group(1)
    elif re.fullmatch(r"[0-9OIL]{3,5}(?:-[0-9A-Z]+)?", s):
        rest = s
    else:
        return ""
    rest = rest.replace("O", "0").replace("I", "1")
    rest = re.sub(r"[^0-9A-Z\-]", "", rest)
    rest = re.sub(r"-+", "-", rest).strip("-")
    if not rest:
        return ""
    m2 = re.match(r"^0(\d)([A-Z])$", rest)
    if m2:
        rest = f"00{m2.group(1)}{m2.group(2)}"
    return f"SK10-{rest}"


COLS = [
    ("size", 0, 180),
    ("drawing", 180, 400),
    ("name", 400, 720),
    ("material", 720, 950),
    ("qty", 950, 1120),
    ("dry", 1120, 1280),
    ("note", 1280, 2000),
]

HEADER_KEYS = [
    ("size", ("サイズ",)),
    ("drawing", ("図面番号", "図番")),
    ("name", ("部品名",)),
    ("material", ("材質",)),
    ("qty", ("発生機",)),
    ("dry", ("乾燥室", "2.5坪", "２．５坪")),
    ("note", ("備考",)),
]


def emit_progress(payload: dict) -> None:
    print("PROGRESS " + json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)


def scaled_cols(page_width: float) -> list[tuple[str, float, float]]:
    ref = 1600.0
    s = max(0.5, page_width / ref)
    return [(n, a * s, b * s) for n, a, b in COLS]


def detect_col_bands(page: dict, header_y: float) -> list[tuple[str, float, float]]:
    found: list[tuple[float, str]] = []
    for L in page["lines"]:
        if abs(L["y"] - header_y) > 24:
            continue
        t = L["text"].replace(" ", "").replace("\u3000", "")
        for name, keys in HEADER_KEYS:
            if any(k in t for k in keys):
                found.append((float(L["x"]), name))
                break
    uniq: list[tuple[float, str]] = []
    seen = set()
    for x, name in sorted(found):
        if name in seen:
            continue
        seen.add(name)
        uniq.append((x, name))
    if len(uniq) < 3:
        return scaled_cols(float(page.get("width") or 1600))
    bands: list[tuple[str, float, float]] = []
    width = float(page.get("width") or uniq[-1][0] + 200)
    for i, (x, name) in enumerate(uniq):
        x0 = 0.0 if i == 0 else (uniq[i - 1][0] + x) / 2
        x1 = width if i == len(uniq) - 1 else (x + uniq[i + 1][0]) / 2
        bands.append((name, x0, x1))
    return bands


def classify_page(page: dict) -> str:
    blob = "".join(str(L.get("text") or "") for L in page.get("lines") or [])
    compact = blob.replace(" ", "").replace("\u3000", "")
    if "製作指図" in compact:
        return "instruction"
    if "ネジ類" in compact or "部材(ネジ" in compact or "部材（ネジ" in compact:
        return "screws"
    if "構成部品表" in compact or ("図面番号" in compact and "部品名" in compact and "材質" in compact):
        return "parts"
    h = float(page.get("height") or 1)
    bottom = "".join(str(L.get("text") or "") for L in page.get("lines") or [] if float(L.get("y") or 0) > h * 0.62)
    if "構成部品表" not in compact and "図面番号" not in compact:
        if "図番" in bottom or re.search(r"SK10-\d", compact, re.I):
            return "drawing"
    return "unknown"


def parse_cover(pages: list[dict]) -> dict:
    product_name = ""
    model_type = ""
    created_on = ""
    owner = ""
    for page in pages:
        lines = sorted(page.get("lines") or [], key=lambda L: (float(L.get("y") or 0), float(L.get("x") or 0)))
        for L in lines:
            t = re.sub(r"[\s:：]", "", str(L.get("text") or ""))
            same = [
                x
                for x in lines
                if abs(float(x.get("y") or 0) - float(L.get("y") or 0)) < 14
                and float(x.get("x") or 0) > float(L.get("x") or 0) + 8
            ]
            same.sort(key=lambda x: float(x.get("x") or 0))
            right = " ".join(str(x.get("text") or "") for x in same[:6]).strip()
            if t == "品名" or t.startswith("品名"):
                val = right or t.replace("品名", "")
                if val and (len(val) > len(product_name) or ("乾燥機" in val and "乾燥機" not in product_name)):
                    product_name = val
            if t == "型式" or t.startswith("型式"):
                blob = right.replace(" ", "")
                m = re.search(r"EC[\dA-Z][\dA-Z.\-]{3,}", blob, re.I)
                if m:
                    model_type = m.group(0)
                elif right and not model_type:
                    model_type = right
            if t == "作成" and right and not created_on:
                created_on = right
            if t in ("担当", "担当者") and right and not owner:
                owner = right
        blob = "".join(str(L.get("text") or "") for L in lines)
        if not model_type:
            m = re.search(r"EC\d{2}-[A-Z0-9.\-]+", blob.replace(" ", ""), re.I)
            if m:
                model_type = m.group(0)
        if not product_name or "乾燥機" not in product_name:
            m = re.search(r"環境負荷低減型[^。\n]{4,48}", blob)
            if m:
                product_name = m.group(0)
    return {
        "product_name": product_name.strip(),
        "model_type": model_type.strip(),
        "created_on": created_on.strip(),
        "owner": owner.strip(),
    }

# ネジ類表（横長）: 部品名称 / 用途 / 工場 / 現場 / 合計
SCREW_COLS = [
    ("name", 0, 520),
    ("usage", 520, 980),
    ("factory", 980, 1180),
    ("site", 1180, 1380),
    ("total", 1380, 2000),
]


def col_of(bands, x0: float, x1: float) -> str:
    x = (x0 + x1) / 2
    for name, a, b in bands:
        if a <= x < b:
            return name
    return bands[-1][0]


def parse_qty(t: str) -> float:
    t = (t or "").strip()
    if not t:
        return 0.0
    if re.search(r"[Ll]/[Rr]|[左右]", t) and re.search(r"\d", t):
        nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)", t)]
        return sum(nums) if nums else 2.0
    if any(k in t for k in ("式", "各", "個")):
        m = re.search(r"(\d+(?:\.\d+)?)", t)
        return float(m.group(1)) if m else 1.0
    m = re.search(r"(\d+(?:\.\d+)?)", t.replace(",", ""))
    return float(m.group(1)) if m else 0.0


def is_assembly(name: str) -> bool:
    n = (name or "").lower()
    return any(k in n for k in ("外形図", "組立図", "assy"))


def find_header_y(page: dict) -> float:
    cands: list[float] = []
    for L in page["lines"]:
        t = L["text"].replace(" ", "").replace("}", "")
        if t == "サイズ" or "図面番号" in t or t == "発生機":
            if 80 < L["y"] < 900:
                cands.append(L["y"])
    return min(cands) if cands else 0.0


def find_screw_header_y(page: dict) -> float:
    for L in page["lines"]:
        t = L["text"].replace(" ", "")
        if "部品名称" in t or ("ネジ" in t and "表" in t) or "工場組立" in t:
            if L["y"] < 500:
                return L["y"]
    return 0.0


def cluster_rows(page: dict, header_y: float, gap: float = 20.0) -> list[float]:
    ys = [L["y"] for L in page["lines"] if L["y"] > header_y + 12]
    ys.sort()
    clusters: list[list[float]] = []
    for y in ys:
        if not clusters or y - clusters[-1][0] > gap:
            clusters.append([y])
        else:
            clusters[-1].append(y)
    return [sum(c) / len(c) for c in clusters]


def parse_instruction(page: dict) -> dict:
    rei = None
    serial = None
    product = "EC2型乾燥機(試作機)"
    for L in page["lines"]:
        t = L["text"].strip()
        if re.match(r"^令\d+$", t):
            rei = t
        if L["y"] < 250 and re.fullmatch(r"\d{2,4}", t) and t not in ("8", "20"):
            if serial is None or L["x"] < 400:
                serial = t
    year = rei[1:] if rei and rei.startswith("令") else "8"
    order_no = f"DR{year}-{str(serial or '0').zfill(4)}"
    return {
        "order_no": order_no,
        "product_name": product,
        "bom_model": product,
        "qty": 1,
        "unit": "式",
        "source_no_raw": f"{rei}-{serial}" if rei else None,
    }


def parse_parts_table(page: dict) -> list[dict]:
    header_y = find_header_y(page)
    if not header_y:
        return []
    bands = detect_col_bands(page, header_y)
    out: list[dict] = []
    last_draw = ""
    pending = ""
    for cy in cluster_rows(page, header_y):
        cells: dict[str, list[str]] = defaultdict(list)
        for L in page["lines"]:
            if abs(L["y"] - cy) > 16:
                continue
            cells[col_of(bands, L["x0"], L["x1"])].append(L["text"])
        size = " ".join(cells.get("size", [])).strip()
        drawing_raw = " ".join(cells.get("drawing", [])).strip()
        name = " ".join(cells.get("name", [])).strip()
        material = " ".join(cells.get("material", [])).strip()
        qty_raw = " ".join(cells.get("qty", [])).strip()
        dry_raw = " ".join(cells.get("dry", [])).strip()
        note = " ".join(cells.get("note", [])).strip()

        if re.fullmatch(r"SK\s*1[0O].*", drawing_raw, re.I) and not re.search(r"\d{3,}", drawing_raw):
            pending = drawing_raw
            m = re.match(r"^(\d{3,5}(?:-\d+)?)\s*(.*)$", name)
            if m:
                drawing_raw = f"{drawing_raw} {m.group(1)}"
                name = m.group(2)
                pending = ""
            else:
                continue
        elif pending and re.fullmatch(r"[0-9OIl]{3,5}(?:-[0-9A-Za-z]+)?", drawing_raw.replace(" ", "")):
            drawing_raw = f"{pending} {drawing_raw}"
            pending = ""
        else:
            pending = ""

        if not name and not drawing_raw:
            continue
        if name.replace(" ", "") in ("部品名", "部名"):
            continue
        if re.fullmatch(r"\d+\s*/\s*\S*", name):
            continue

        draw = normalize_drawing(drawing_raw)
        if not draw and drawing_raw.strip() in ("〃", '"', "同", "々", "メ"):
            draw = last_draw
        if draw:
            last_draw = draw
        if not draw and not name:
            continue

        qty = parse_qty(qty_raw) or parse_qty(dry_raw) or 0.0
        kind = "assembly" if is_assembly(name) else ("drawing_part" if draw else "purchased")
        out.append(
            {
                "page": page["page"],
                "size": size,
                "drawing_no": draw,
                "drawing_raw": drawing_raw,
                "part_name": name or draw,
                "material": material,
                "spec": material,
                "qty": qty,
                "qty_raw": qty_raw or dry_raw,
                "qty_generator": qty_raw,
                "qty_chamber": dry_raw,
                "note": note,
                "kind": kind,
                "include": kind in ("drawing_part", "purchased"),
                "part_key": draw.upper() if draw else "",
            }
        )
    return out


def parse_screw_table(page: dict) -> list[dict]:
    header_y = find_screw_header_y(page)
    if not header_y:
        # fallback: pages that look like screw sheets by title fragments
        title_hit = any("ネジ" in L["text"] or "部材" in L["text"] for L in page["lines"][:30])
        if not title_hit:
            return []
        header_y = 120.0

    out: list[dict] = []
    last_usage = ""
    for cy in cluster_rows(page, header_y, gap=18.0):
        cells: dict[str, list[str]] = defaultdict(list)
        for L in page["lines"]:
            if abs(L["y"] - cy) > 14:
                continue
            cells[col_of(SCREW_COLS, L["x0"], L["x1"])].append(L["text"])
        name = " ".join(cells.get("name", [])).strip()
        usage = " ".join(cells.get("usage", [])).strip()
        factory = " ".join(cells.get("factory", [])).strip()
        site = " ".join(cells.get("site", [])).strip()
        total = " ".join(cells.get("total", [])).strip()
        if not name:
            continue
        if any(k in name.replace(" ", "") for k in ("部品名称", "用途", "工場組立", "合計")):
            continue
        if usage.strip() in ("〃", '"', "同", "々"):
            usage = last_usage
        elif usage:
            last_usage = usage
        qty = parse_qty(total) or (parse_qty(factory) + parse_qty(site)) or 1.0
        out.append(
            {
                "page": page["page"],
                "size": "",
                "drawing_no": "",
                "drawing_raw": "",
                "part_name": name,
                "material": usage,
                "spec": usage,
                "qty": qty,
                "qty_raw": total or factory or site,
                "note": "ネジ類・購入部材",
                "kind": "purchased",
                "include": True,
                "part_key": "",
            }
        )
    return out


def _ocr_numpy(reader, img) -> list[dict]:
    result = reader.readtext(img, detail=1, paragraph=False)
    lines = []
    for bbox, text, conf in result:
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        lines.append(
            {
                "text": text,
                "conf": float(conf),
                "x": float(sum(xs) / 4),
                "y": float(sum(ys) / 4),
                "x0": float(min(xs)),
                "x1": float(max(xs)),
                "y0": float(min(ys)),
                "y1": float(max(ys)),
            }
        )
    return lines


def _ocr_quality(lines: list[dict]) -> float:
    """日本語・英数字が連続する行が多いほど高スコア（横倒しページの自動判定用）"""
    score = 0.0
    for L in lines:
        t = (L.get("text") or "").strip()
        if len(t) >= 4:
            score += 2.0
        elif len(t) >= 2:
            score += 0.5
        if "ネジ" in t or "部品名称" in t or "SK10" in t.upper() or "製作指図" in t:
            score += 20.0
    return score


def ocr_pdf(pdf_path: Path, max_pages: int = 0, stop_at_drawings: bool = False) -> list[dict]:
    import numpy as np
    import fitz
    import easyocr
    import easyocr.utils as u

    u.progress_hook = lambda *a, **k: None
    reader = easyocr.Reader(["ja", "en"], gpu=False, verbose=False)
    doc = fitz.open(str(pdf_path))
    limit = doc.page_count if max_pages <= 0 else min(doc.page_count, max_pages)
    emit_progress({"phase": "loading", "page": 0, "total": limit})
    pages: list[dict] = []
    seen_parts = False
    miss = 0
    for i in range(limit):
        t0 = time.time()
        page = doc[i]
        pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5))
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            img = img[:, :, :3]

        lines0 = _ocr_numpy(reader, img)
        q0 = _ocr_quality(lines0)
        best_lines, best_q, best_rot, best_shape = lines0, q0, 0, img.shape[:2]

        # ネジ類など横置きスキャンは 270° 回転が有効なことが多い
        if q0 < 40:
            for k, rot in ((1, 90), (3, 270)):
                img_r = np.rot90(img, k)
                lines_r = _ocr_numpy(reader, img_r)
                q = _ocr_quality(lines_r)
                if q > best_q:
                    best_lines, best_q, best_rot, best_shape = lines_r, q, rot, img_r.shape[:2]

        rec = {
            "page": i + 1,
            "width": int(best_shape[1]),
            "height": int(best_shape[0]),
            "rotation": best_rot,
            "lines": best_lines,
        }
        kind = classify_page(rec)
        rec["kind"] = kind
        print(
            f"OCR page {i + 1}/{limit} kind={kind} lines={len(best_lines)} rot={best_rot} q={best_q:.0f} {time.time() - t0:.1f}s",
            file=sys.stderr,
            flush=True,
        )
        emit_progress({"phase": "ocr", "page": i + 1, "total": limit, "kind": kind})

        if stop_at_drawings and kind == "drawing" and (seen_parts or i >= 1):
            break
        if kind == "parts":
            seen_parts = True
            miss = 0
        elif kind in ("instruction", "screws"):
            miss = 0
        else:
            miss += 1
            if stop_at_drawings and seen_parts and miss >= 2:
                break
        pages.append(rec)
    return pages


def build_payload(
    pages: list[dict],
    parts_pdf: str,
    drawings_pdf: str | None,
    skip_screws: bool = False,
) -> dict:
    instruction = parse_instruction(pages[0]) if pages else {
        "order_no": "DR8-0000",
        "product_name": "",
        "bom_model": "",
        "qty": 1,
        "unit": "式",
        "source_no_raw": None,
    }
    cover = parse_cover(pages)
    if cover.get("product_name"):
        instruction["product_name"] = cover["product_name"]
    if cover.get("model_type"):
        instruction["bom_model"] = cover["model_type"]
    all_parts: list[dict] = []
    for page in pages:
        kind = page.get("kind") or classify_page(page)
        if kind == "instruction":
            continue
        if kind == "screws":
            if not skip_screws:
                all_parts.extend(parse_screw_table(page))
            continue
        if kind != "parts":
            screw_rows = parse_screw_table(page)
            if screw_rows and len(screw_rows) >= 5:
                if not skip_screws:
                    all_parts.extend(screw_rows)
                continue
        all_parts.extend(parse_parts_table(page))

    seen: set[str] = set()
    uniq: list[dict] = []
    for p in all_parts:
        key = p["drawing_no"] or f"NAME:{p['part_name']}|{p['page']}|{p.get('qty_raw','')}"
        if key in seen:
            continue
        seen.add(key)
        uniq.append(p)

    return {
        "source": {
            "parts_list_pdf": parts_pdf,
            "drawings_pdf": drawings_pdf,
        },
        "work_order": instruction,
        "cover": cover,
        "parts": uniq,
        "summary": {
            "total": len(uniq),
            "drawing_parts": sum(1 for p in uniq if p["kind"] == "drawing_part"),
            "purchased": sum(1 for p in uniq if p["kind"] == "purchased"),
            "assembly_excluded": sum(1 for p in uniq if p["kind"] == "assembly"),
            "include_count": sum(1 for p in uniq if p["include"]),
            "kinds": dict(Counter(p["kind"] for p in uniq)),
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parts-pdf", default="", help="部品表PDF（製作指図書+構成部品表+ネジ類）")
    ap.add_argument("--pdf", default="", help="--parts-pdf の別名")
    ap.add_argument("--drawings-pdf", default=None, help="図面のみPDF（突合用・任意）")
    ap.add_argument("--raw-json", default=None, help="既存OCR生JSONがあれば再解析のみ")
    ap.add_argument("--save-raw", default=None, help="OCR生JSONの保存先")
    ap.add_argument("--out", required=True, help="解析結果JSON出力先")
    ap.add_argument("--max-pages", type=int, default=0)
    ap.add_argument("--stop-at-drawings", action="store_true")
    ap.add_argument("--skip-screws", action="store_true")
    args = ap.parse_args()

    parts_pdf = args.parts_pdf or args.pdf
    if args.raw_json:
        pages = json.loads(Path(args.raw_json).read_text(encoding="utf-8"))
    else:
        if not parts_pdf:
            print("PDF not specified", file=sys.stderr)
            return 2
        pages = ocr_pdf(
            Path(parts_pdf),
            max_pages=args.max_pages,
            stop_at_drawings=args.stop_at_drawings,
        )
        if args.save_raw:
            Path(args.save_raw).write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding="utf-8")

    payload = build_payload(
        pages,
        Path(parts_pdf).name if parts_pdf else "",
        Path(args.drawings_pdf).name if args.drawings_pdf else None,
        skip_screws=args.skip_screws,
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {"ok": True, "out": str(out), "summary": payload["summary"], "work_order": payload["work_order"], "cover": payload.get("cover")},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
