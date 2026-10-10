#!/usr/bin/env python3
"""PDF 내려받기용 Pretendard 서브셋 생성 (KS X 1001 한글 2,350자 + ASCII + 기호).
웹 화면용 폰트와는 별개다 (웹은 public/fonts 의 다이나믹 서브셋).
pdf-lib 의 fontkit 은 서브셋 임베딩이 글자를 빠뜨려서(`subset:true` 시 일부 글리프 누락) 이 서브셋을 통째로 내장한다.
굵은 글씨는 Regular 를 살짝 겹쳐 찍어 흉내 낸다 (src/server/export.ts).
사용: python3 scripts/build-pdf-font.py   (필요: fonttools, brotli)
"""
import subprocess, sys, tempfile, os
from pathlib import Path

SRC = Path("node_modules/pretendard/dist/public/static")
OUT = Path("src/server/fonts")
OUT.mkdir(parents=True, exist_ok=True)

chars = set(chr(c) for c in range(0x20, 0x7F))
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try:
            chars.add(bytes([hi, lo]).decode("euc-kr"))
        except UnicodeDecodeError:
            pass
chars.update("“”‘’·…–—−×÷±→←↑↓■□●○◆◇※℃₩~˜▲▼△▽∼≈≤≥≠°㎡㈜①②③④⑤")
print(f"{len(chars)}자")

with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
    f.write("".join(sorted(chars)))
    text = f.name

from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen


def otf_to_ttf(path_in, path_out):
    """CFF(OTF) → TrueType(TTF). pdf-lib 의 fontkit 은 CFF 서브셋 임베딩을 지원하지 않는다."""
    font = TTFont(path_in)
    glyph_order = font.getGlyphOrder()
    gs = font.getGlyphSet()
    glyf = newTable("glyf")
    glyf.glyphOrder = glyph_order
    glyf.glyphs = {}
    for name in glyph_order:
        pen = TTGlyphPen(gs)
        gs[name].draw(Cu2QuPen(pen, 1.0, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
    font["loca"] = newTable("loca")
    font["glyf"] = glyf
    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for attr in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs", "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
        setattr(maxp, attr, 0)
    maxp.maxZones = 1
    maxp.maxPoints = maxp.maxContours = maxp.maxCompositePoints = maxp.maxCompositeContours = maxp.maxComponentDepth = 0
    del font["CFF "]
    font["head"].glyphDataFormat = 0
    post = font["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = glyph_order
    font.sfntVersion = "\x00\x01\x00\x00"
    font.save(path_out)


for weight in ("Regular",):
    tmp = OUT / f"_{weight}.otf"
    out = OUT / f"Pretendard-{weight}.subset.ttf"
    subprocess.check_call([
        sys.executable, "-m", "fontTools.subset", str(SRC / f"Pretendard-{weight}.otf"),
        f"--text-file={text}", f"--output-file={tmp}", "--layout-features=kern", "--no-hinting",
        "--desubroutinize", "--name-IDs=*", "--drop-tables+=DSIG",
    ])
    otf_to_ttf(tmp, out)
    os.unlink(tmp)
    stale = OUT / f"Pretendard-{weight}.subset.otf"
    if stale.exists():
        os.unlink(stale)
    print(out, os.path.getsize(out) // 1024, "KB")
os.unlink(text)
