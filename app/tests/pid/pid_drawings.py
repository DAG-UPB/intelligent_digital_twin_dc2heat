"""Synthetic P&ID drawings built in code, so no real (confidential) drawing is ever needed.

Each builder returns the file's bytes. The PDFs are minimal but valid (with an xref table),
so poppler renders them too; the content streams are uncompressed so they read like the
operators they test.
"""

from __future__ import annotations


def make_pdf(content: bytes, box=(0, 0, 600, 400), xobjects: dict[str, bytes] | None = None) -> bytes:
    """One-page PDF around a raw content stream; `xobjects` maps /Name to a Form XObject stream."""
    xobjects = xobjects or {}
    objs = [b"<</Type/Catalog/Pages 2 0 R>>", b"<</Type/Pages/Kids[3 0 R]/Count 1>>"]
    first_form = 5
    names = b"".join(b"/%s %d 0 R" % (name.encode(), first_form + i) for i, name in enumerate(xobjects))
    media = b"[%s]" % b" ".join(str(v).encode() for v in box)
    objs.append(b"<</Type/Page/Parent 2 0 R/MediaBox%s/Contents 4 0 R/Resources<</XObject<<%s>>>>>>" % (media, names))
    objs.append(b"<</Length %d>>stream\n%s\nendstream" % (len(content), content))
    for body in xobjects.values():
        objs.append(body)
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def form_xobject(content: bytes, matrix: str = "") -> bytes:
    """A Form XObject object body (dict + stream) for make_pdf(xobjects=...)."""
    mat = f"/Matrix[{matrix}]".encode() if matrix else b""
    return b"<</Type/XObject/Subtype/Form/BBox[0 0 100 100]%s/Length %d>>stream\n%s\nendstream" % (
        mat,
        len(content),
        content,
    )


def _tag(text: str, x: float, y: float) -> bytes:
    return f"BT /F1 8 Tf 1 0 0 1 {x} {y} Tm ({text}) Tj ET\n".encode()


def mono_pdf() -> bytes:
    """Monochrome sheet: the geometric extractor's case (tags + a 5-endpoint junction + a bend)."""
    c = b"0 0 0 RG 1 w\n0 0 600 400 re S\n"  # frame: longer than BORDER_LEN_MIN, ignored
    c += _tag("P4711", 80, 300) + _tag("V1001", 480, 300) + _tag("T2002", 300, 120)
    c += _tag("DN 800", 150, 310) + _tag("1", 10, 390)
    c += b"95 300 m 200 300 l S\n"  # P4711 -> bend
    c += b"200 300 m 200 200 l 300 200 l S\n"  # bend -> junction
    c += b"300 200 m 470 200 l 470 290 l S\n"  # junction -> V1001
    c += b"300 200 m 300 135 l S\n"  # junction -> T2002
    c += b"300 200 m 304 204 l S\n"  # two stubs make the junction 5 endpoints dense
    c += b"296 196 m 300 200 l S\n"
    for x in (120, 380):  # valve bowties: glyph paths
        c += f"{x} 295 m {x + 10} 305 l {x + 10} 295 l {x} 305 l {x} 295 l S\n".encode()
    c += b"50 50 m 550 50 l S\n50 30 m 550 30 l S\n"  # title-block rules below the content floor
    return make_pdf(c)


def colour_pdf() -> bytes:
    """Colour-coded sheet: red main with a dashed stretch, a blue branch drawn inside a form XObject."""
    c = b"0.5 G 1 w\n10 10 580 380 re S\n"  # grey frame: achromatic
    c += _tag("P4711", 40, 300) + _tag("WT 4a", 470, 305) + _tag("H1007", 250, 112)
    c += b"1 0 0 RG 2 w\n50 300 m 200 300 l S\n"
    c += b"".join(f"{x} 300 m {x + 10} 300 l S\n".encode() for x in range(205, 300, 15))  # dashes
    c += b"300 300 m 460 300 l S\n"
    c += b"q 1 0 0 1 250 120 cm /Br Do Q\n"  # the branch: local coordinates, placed by cm
    c += b"0 0 0 RG 1 w\n245 295 m 255 305 l S\n245 305 m 255 295 l S\n"  # a valve on the main
    form = form_xobject(b"0 0 1 RG 2 w 0 0 m 0 180 l S")
    return make_pdf(c, xobjects={"Br": form})


def colour_svg() -> bytes:
    """Colour-coded SVG: <g transform>, <use>/<symbol>, rgb() percentages, a pump body splitting a pipe."""
    return b"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 400 300" width="400" height="300">
  <defs>
    <symbol id="pump"><circle cx="0" cy="0" r="8" stroke="black" fill="none"/></symbol>
  </defs>
  <rect x="5" y="5" width="390" height="290" stroke="#808080" fill="none"/>
  <g transform="translate(20,0)">
    <line x1="30" y1="100" x2="142" y2="100" stroke="rgb(100%,0%,0%)" stroke-width="2"/>
    <use xlink:href="#pump" x="150" y="100"/>
    <line x1="158" y1="100" x2="280" y2="100" stroke="rgb(100%,0%,0%)"/>
    <path d="M 220 100 L 220 200" stroke="#0000ff"/>
    <path d="M 220 200 H 300" stroke="blue"/>
  </g>
  <line x1="40" y1="250" x2="360" y2="250" stroke="#333"/>
  <line x1="40" y1="260" x2="360" y2="260" stroke="#333"/>
  <line x1="40" y1="270" x2="360" y2="270" stroke="#333"/>
  <circle cx="200" cy="40" r="5" stroke="none" fill="black"/>
  <text x="44" y="92">P4711</text>
  <text x="304" y="92">WT 4a</text>
  <text x="326" y="204">H1007</text>
  <text x="160" y="84">M1.1</text>
  <text x="60" y="240">DN 800</text>
</svg>
"""


def instrument_svg() -> bytes:
    """colour_svg plus instrument bubbles: TI 101 on the main, a PT with its code and number in one text, a motor
    (M: not an instrument), and a legend lattice of four bubbles (left out)."""
    bubbles = [("TI", "101", 120, 70), ("PT 7", None, 260, 70), ("M", None, 340, 150)]
    bubbles += [("FT", None, 20, 20), ("LT", None, 40, 20), ("TT", None, 20, 40), ("PI", None, 40, 40)]
    extra = ""
    for code, loop, x, y in bubbles:
        extra += f'<circle cx="{x}" cy="{y}" r="6" stroke="black" fill="none"/><text x="{x - 4}" y="{y + 1}">{code}</text>'
        if loop:
            extra += f'<text x="{x - 5}" y="{y + 5}">{loop}</text>'
    return colour_svg().replace(b"</svg>", extra.encode() + b"\n</svg>")


PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x35\x81\x84\x00\x00\x00\x00IEND\xaeB`\x82"
)


def dexpi_xml() -> bytes:
    """A small DEXPI (Proteus) sheet, 400 x 300 mm, y up: tank T-101 (own graphics, extent 40..80 x 200..260) and
    pump P-101 (a catalogue symbol placed at 300, 100) joined by one pipe from nozzle N1 to N2; instrument TI 101
    (a bubble of radius 5 at 150, 200) and a pressure gauge labelled only by its texts."""
    return b"""<?xml version="1.0" encoding="UTF-8"?>
<PlantModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <PlantInformation SchemaVersion="4.1.1" OriginatingSystem="test" Units="Millimetre"/>
  <Drawing Name="Test" Type="PID"><Extent><Min X="0" Y="0"/><Max X="400" Y="300"/></Extent></Drawing>
  <ShapeCatalogue Name="symbols">
    <Equipment ComponentName="PUMP_SYMBOL" ComponentClass="CentrifugalPump">
      <Circle Radius="10">
        <Position><Location X="0" Y="0"/><Axis X="0" Y="0" Z="1"/><Reference X="1" Y="0" Z="0"/></Position>
      </Circle>
      <Line><Coordinate X="0" Y="10"/><Coordinate X="10" Y="10"/></Line>
    </Equipment>
  </ShapeCatalogue>
  <Equipment ID="TNK1" ComponentClass="Tank" ComponentName="T-101-instance">
    <Extent><Min X="40" Y="200"/><Max X="80" Y="260"/></Extent>
    <Position><Location X="40" Y="200"/><Axis X="0" Y="0" Z="1"/><Reference X="1" Y="0" Z="0"/></Position>
    <GenericAttributes Set="DexpiAttributes">
      <GenericAttribute Name="TagNameAssignmentClass" Format="string" Value="T-101"/>
    </GenericAttributes>
    <Shape NumPoints="4"><Presentation LineWeight="0.5" R="0" G="0" B="1"/>
      <Coordinate X="40" Y="200"/><Coordinate X="80" Y="200"/><Coordinate X="80" Y="260"/><Coordinate X="40" Y="260"/>
    </Shape>
    <Nozzle ID="N1"><Position><Location X="80" Y="210"/></Position></Nozzle>
  </Equipment>
  <Equipment ID="PMP1" ComponentClass="CentrifugalPump" ComponentName="PUMP_SYMBOL" TagName="P-101">
    <Position><Location X="300" Y="100"/><Axis X="0" Y="0" Z="1"/><Reference X="0" Y="1" Z="0"/></Position>
    <Nozzle ID="N2"><Position><Location X="290" Y="100"/></Position></Nozzle>
  </Equipment>
  <PipingNetworkSystem ID="PNS1">
    <GenericAttributes Set="DexpiAttributes"><GenericAttribute Name="LineNumberAssignmentClass" Value="L-1"/></GenericAttributes>
    <PipingNetworkSegment ID="SEG1">
      <CenterLine NumPoints="3">
        <Coordinate X="80" Y="210"/><Coordinate X="200" Y="210"/><Coordinate X="200" Y="100"/>
      </CenterLine>
      <CenterLine NumPoints="2"><Coordinate X="200" Y="100"/><Coordinate X="290" Y="100"/></CenterLine>
      <Connection FromID="N1" ToID="N2"/>
    </PipingNetworkSegment>
  </PipingNetworkSystem>
  <ProcessInstrumentationFunction ID="PIF1" ComponentClass="ProcessInstrumentationFunction">
    <GenericAttributes Set="DexpiAttributes">
      <GenericAttribute Name="ProcessInstrumentationFunctionCategoryAssignmentClass" Value="T"/>
      <GenericAttribute Name="ProcessInstrumentationFunctionsAssignmentClass" Value="I"/>
      <GenericAttribute Name="ProcessInstrumentationFunctionNumberAssignmentClass" Value="101"/>
    </GenericAttributes>
    <Circle Radius="5"><Position><Location X="150" Y="200"/></Position></Circle>
    <Label><Text String="TI" Height="3"><Position><Location X="147" Y="200"/></Position></Text></Label>
  </ProcessInstrumentationFunction>
  <ProcessInstrumentationFunction ID="PIF2">
    <Position><Location X="250" Y="150"/></Position>
    <Label><Text String="PI"/><Text String="7"/></Label>
  </ProcessInstrumentationFunction>
</PlantModel>
"""
