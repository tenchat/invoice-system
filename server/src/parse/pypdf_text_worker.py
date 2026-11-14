"""Extract positioned PDF text for files whose embedded fonts are missed by PDF.js."""
import json
import math
import sys
from io import BytesIO

from pypdf import PdfReader


def main():
    reader = PdfReader(BytesIO(sys.stdin.buffer.read()), strict=False)
    items = []

    for page in reader.pages[:2]:
        def visitor(text, _cm, tm, _font, font_size):
            original = str(text).replace("\r", "").replace("\n", "")
            leading = len(original) - len(original.lstrip())
            value = original.strip()
            if not value:
                return

            scale = math.hypot(float(tm[0]), float(tm[1])) or 1.0
            effective_size = float(font_size) * scale

            def width_of(char):
                if char.isspace():
                    return effective_size * 0.25
                if ord(char) >= 0x2E80:
                    return effective_size
                if char.isalnum():
                    return effective_size * 0.55
                return effective_size * 0.5

            x = float(tm[4]) + sum(width_of(char) for char in original[:leading])
            items.append({
                "str": value,
                "x": x,
                "y": float(tm[5]),
                "width": sum(width_of(char) for char in value),
                "height": effective_size,
            })

        page.extract_text(visitor_text=visitor)

    print(json.dumps(items, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
