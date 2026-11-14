"""Render an original PDF page to PNG on stdout."""
import io
import sys
import pypdfium2 as pdfium

document = pdfium.PdfDocument(sys.stdin.buffer.read())
page_number = int(sys.argv[1])
scale = float(sys.argv[2])
if page_number < 1 or page_number > len(document) or not 0.1 <= scale <= 4:
    raise ValueError("Invalid PDF page or scale")
page = document[page_number - 1]
bitmap = page.render(scale=scale)
output = io.BytesIO()
bitmap.to_pil().save(output, format="PNG")
sys.stdout.buffer.write(output.getvalue())
bitmap.close()
page.close()
document.close()
