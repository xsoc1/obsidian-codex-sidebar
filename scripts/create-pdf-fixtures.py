"""Original public PDF fixtures. Run explicitly with a Python that has reportlab/Pillow."""
from pathlib import Path
from io import BytesIO
import os
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont

Output = Path(__file__).resolve().parent.parent / "examples" / "pdf"
Output.mkdir(parents=True, exist_ok=True)
Text = canvas.Canvas(str(Output / "text-mini.pdf"), pagesize=(612, 792), invariant=1)
for Title, Lines in [
	("Original Lie algebra mini lesson", ["A bracket can be computed as [X,Y] = XY - YX.", "X = diag(1,-1), Y has Y_12 = 1 and other entries zero.", "XY = Y and YX = -Y. Therefore [X,Y] = 2Y.", "Exercise: compute [X,3Y] by the same two products."]),
	("Original analysis mini lesson", ["Consider f(x) = x^2 and a fixed real number a.", "f(a+h)-f(a) = 2ah+h^2.", "For 0 < |h| < 1, |2ah+h^2| <= (2|a|+1)|h|.", "Choose delta = min(1, epsilon/(2|a|+1)).", "Then |h| < delta implies |f(a+h)-f(a)| < epsilon."])
]:
	Text.setFont("Helvetica-Bold", 20)
	Text.drawString(48, 735, Title)
	Text.setFont("Helvetica", 14)
	for Index, Line in enumerate(Lines):
		Text.drawString(48, 680 - 36 * Index, Line)
	Text.setFont("Helvetica", 10)
	Text.drawString(48, 40, "Original public test material - no private course content")
	Text.showPage()
Text.save()

Scan = Image.new("RGB", (1224, 1584), "white")
Draw = ImageDraw.Draw(Scan)
FontName = str(Path(os.environ.get("WINDIR", "")) / "Fonts" / "arial.ttf") if os.name == "nt" else "DejaVuSans.ttf"
Font = ImageFont.truetype(FontName, 32)
for Index, Line in enumerate(["Original scanned-page test", "Visual marker: PHI-2718", "(a+b)^2 = a^2 + 2ab + b^2", "Compute at a=2, b=3:", "Left side = 25; right side = 4 + 12 + 9 = 25.", "The middle term is needed even when a=b."]):
	Draw.text((96, 120 + 100 * Index), Line, font=Font, fill="black")
ImageBytes = BytesIO()
Scan.save(ImageBytes, format="JPEG", quality=85)
(Output / "scanned-page.jpg").write_bytes(ImageBytes.getvalue())
Scanned = canvas.Canvas(str(Output / "scanned-mini.pdf"), pagesize=(612, 792), invariant=1)
Scanned.drawImage(ImageReader(ImageBytes), 0, 0, width=612, height=792)
Scanned.showPage()
Scanned.save()
print("Created two original PDFs (text: 2 pages; image-only: 1 page)")
