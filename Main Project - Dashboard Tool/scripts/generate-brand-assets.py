"""Generate MS-CollabDash brand assets from "New Logo 2.jpg"."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "New Logo 2.jpg"
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)

PAPER = 232  # paper texture in the source is ~235-245

def whiten(img):
    return img.convert("RGB").point(lambda v: min(255, round(v * 255 / PAPER)))

def knock_out_paper(img):
    img = img.convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, _ = px[x, y]
            alpha = max(0, min(255, (PAPER + 8 - min(r, g, b)) * 10))
            px[x, y] = (r, g, b, alpha)
    return img

def square(img, size, pad=0.06):
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    inner = int(size * (1 - 2 * pad))
    canvas = canvas.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(canvas, ((size - inner) // 2,) * 2, canvas)
    return out

src = Image.open(SRC)
full = whiten(src.crop((340, 140, 1070, 630)))
full.save(OUT / "logo.png", optimize=True)

icon = knock_out_paper(src.crop((520, 150, 890, 475)))
icon = icon.crop(icon.getbbox())
for size in (32, 64, 180, 192, 512):
    square(icon, size).save(OUT / f"favicon-{size}.png", optimize=True)
square(icon, 64).save(OUT / "favicon.ico", sizes=[(32, 32), (64, 64)])
(ROOT / "favicon.ico").write_bytes((OUT / "favicon.ico").read_bytes())
print("Brand assets written to", OUT)
