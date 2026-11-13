"""Read one image from stdin and emit positioned OCR text as UTF-8 JSON."""
import json
import sys

from rapidocr import RapidOCR


def main():
    engine = RapidOCR(params={"Det.limit_side_len": 1600})
    if "--warmup" in sys.argv:
        return
    result = engine(sys.stdin.buffer.read())
    rows = []
    if result.boxes is not None:
        for box, text, score in zip(result.boxes, result.txts, result.scores):
            if score >= 0.55:
                x = box[:, 0]
                y = box[:, 1]
                rows.append({
                    "str": text,
                    "x": float(x.min()),
                    "y": -float(y.mean()),
                    "width": float(x.max() - x.min()),
                    "height": float(y.max() - y.min()),
                })
    print(json.dumps(rows, ensure_ascii=False))


if __name__ == "__main__":
    main()

