"""The PDF and SVG readers, on synthetic content streams and documents."""

import zlib

import pytest
from pid_drawings import form_xobject, make_pdf

from backend.pid import extract, pdf_reader, sniff, svg_reader
from backend.pid.geometry import IDENTITY

# --- sniff and reader dispatch ------------------------------------------------


@pytest.mark.parametrize(
    ("header", "suffix"),
    [(b"%PDF-1.7\n", ".pdf"), (b"  <?xml version='1.0'?>", ".svg"), (b"<SVG xmlns='x'>", ".svg"), (b"<svg>", ".svg")],
)
def test_sniff_by_content(header, suffix):
    assert sniff(header) == suffix


def test_sniff_rejects_other_files():
    message = r"^Not a PDF, SVG or DEXPI file \(no %PDF- header, no <svg> and no <PlantModel> element\)\.$"
    with pytest.raises(ValueError, match=message):
        sniff(b"not a drawing")


def test_reader_by_extension():
    assert extract._reader("x.SVG") is svg_reader  # case-insensitive
    assert extract._reader("x.pdf") is pdf_reader
    with pytest.raises(ValueError, match="dwg"):
        extract._reader("drawing.dwg")


# --- PDF content streams ---------------------------------------------------------

PAGE_RESOURCES = b"<</XObject<</Frm 9 0 R>>>>"
PLACED = b"q 2 0 0 2 100 100 cm /Frm Do Q"  # scale 2, offset (100, 100)


def _text_positions(content: bytes) -> list[tuple[float, float]]:
    return [(t["x"], t["y"]) for t in pdf_reader._text_items_from_stream(content, {})]


def test_td_is_relative_to_the_line_matrix():
    # A drawing that positions text with Td once stranded six tags in the sheet corner.
    content = b"BT 1 0 0 1 100 200 Tm (A)Tj 10 5 Td (B)Tj 10 5 Td (C)Tj ET"
    assert _text_positions(content) == [(100.0, 200.0), (110.0, 205.0), (120.0, 210.0)]


def test_text_goes_through_the_ctm():
    assert _text_positions(b"q 1 0 0 1 50 60 cm BT 1 0 0 1 5 5 Tm (A)Tj ET Q") == [(55.0, 65.0)]


def test_literal_strings_decode_escapes():
    items = pdf_reader._text_items_from_stream(rb"BT 1 0 0 1 0 0 Tm (WT\0404a \(x\))Tj ET", {})
    assert items[0]["text"] == "WT 4a (x)"


def test_cid_text_decodes_through_tounicode():
    cmap = b"beginbfchar <0001> <0050> endbfchar beginbfrange <0002> <0003> <0031> endbfrange"
    mapping = pdf_reader._parse_cmap(cmap)
    assert pdf_reader._decode_hex_string(b"0001 0002 0003", mapping) == "P12"


def test_cid_text_in_a_pdf_uses_the_first_font_map_that_knows_the_cid(tmp_path):
    def obj(n, body):
        return b"%d 0 obj\n%s\nendobj\n" % (n, body)

    def stream(text):
        return b"<</Length %d>>stream\n%s\nendstream" % (len(text), text)

    path = tmp_path / "x.pdf"
    path.write_bytes(
        b"%PDF-1.4\n"
        + obj(1, b"<</Type/Font/ToUnicode 2 0 R>>")
        + obj(2, stream(b"beginbfchar <0001> <0050> endbfchar"))
        + obj(3, b"<</Type/Font/ToUnicode 4 0 R>>")
        + obj(4, stream(b"beginbfchar <0001> <0058> <0002> <0031> endbfchar"))
        + obj(5, b"<</Type/Page/MediaBox[0 0 100 100]/Contents 6 0 R>>")
        + obj(6, stream(b"BT 1 0 0 1 10 20 Tm <00010002> Tj ET"))
    )
    assert pdf_reader.text_items(path) == [{"text": "P1", "x": 10.0, "y": 20.0}]


def test_fill_and_stroke_paths_kept_fill_only_dropped():
    styled = pdf_reader._styled_polylines_from_stream(
        b"q 1 0 0 RG 10 10 m 90 10 l B 0 0 1 RG 10 30 m 90 30 l S 0 1 0 RG 10 50 m 90 50 l f Q"
    )
    painted = {d["color"] for d in styled}
    assert (1.0, 0.0, 0.0) in painted  # B: fill and stroke
    assert (0.0, 0.0, 1.0) in painted  # S
    assert (0.0, 1.0, 0.0) not in painted  # f: no stroke


def test_stroke_keeps_width_and_grey_through_q_and_Q():
    styled = pdf_reader._styled_polylines_from_stream(b"3 w 0.5 G q 1 w 0 0 m 1 1 l S Q 0 0 m 2 2 l S")
    assert [(d["width"], d["color"]) for d in styled] == [(1.0, (0.5, 0.5, 0.5)), (3.0, (0.5, 0.5, 0.5))]


def test_curves_are_flattened_and_both_readers_agree():
    curve = b"q 0 0 1 RG 0 0 m 0 100 100 100 100 0 c S Q"
    (styled,) = pdf_reader._styled_polylines_from_stream(curve)
    pts = styled["points"]
    assert len(pts) >= 8
    assert pts[-1] == pytest.approx((100.0, 0.0))
    assert max(y for _, y in pts) > 50  # the apex (75), not the straight chord
    assert len(pdf_reader._polylines_from_stream(curve)[0]) == len(pts)


def test_rectangle_is_a_closed_polyline():
    assert pdf_reader._polylines_from_stream(b"1 2 10 20 re S") == [[(1, 2), (11, 2), (11, 22), (1, 22), (1, 2)]]


def test_form_text_gets_the_placement_ctm():
    objects = {9: form_xobject(b"BT 1 0 0 1 5 5 Tm (F)Tj ET")}
    items = pdf_reader._text_items_from_stream(PLACED, {}, IDENTITY, PAGE_RESOURCES, objects)
    assert [(t["x"], t["y"]) for t in items] == [(110.0, 110.0)]


def test_form_matrix_composes_under_the_placement_ctm():
    objects = {9: form_xobject(b"BT 1 0 0 1 0 0 Tm (G)Tj ET", matrix="1 0 0 1 10 10")}
    items = pdf_reader._text_items_from_stream(PLACED, {}, IDENTITY, PAGE_RESOURCES, objects)
    assert [(t["x"], t["y"]) for t in items] == [(120.0, 120.0)]


def test_image_xobject_is_not_resolved():
    image = b"<</Subtype/Image/Width 1/Height 1/Length 27>>stream\nBT 1 0 0 1 5 5 Tm (I)Tj ET\nendstream"
    assert pdf_reader._text_items_from_stream(PLACED, {}, IDENTITY, PAGE_RESOURCES, {9: image}) == []


def test_form_paths_and_strokes_resolve_like_text():
    objects = {9: form_xobject(b"1 0 0 RG 0 0 m 10 10 l S")}
    poly = pdf_reader._polylines_from_stream(PLACED, IDENTITY, PAGE_RESOURCES, objects)
    assert poly[0][0] == (100.0, 100.0)
    (styled,) = pdf_reader._styled_polylines_from_stream(PLACED, IDENTITY, PAGE_RESOURCES, objects)
    assert styled["points"] == [(100.0, 100.0), (120.0, 120.0)]
    assert styled["color"] == (1.0, 0.0, 0.0)


def test_nested_form_through_inline_resources():
    outer = (
        b"<</BBox[0 0 50 50]/Subtype/Form/Type/XObject/Resources<</XObject<</Inner 20 0 R>>>>/Length 10>>"
        b"stream\n/Inner Do\nendstream"
    )
    objects = {9: outer, 20: form_xobject(b"BT 1 0 0 1 5 5 Tm (N)Tj ET")}
    items = pdf_reader._text_items_from_stream(PLACED, {}, IDENTITY, PAGE_RESOURCES, objects)
    assert [(t["x"], t["y"]) for t in items] == [(110.0, 110.0)]


def test_do_inside_a_string_literal_is_not_executed():
    objects = {9: form_xobject(b"50 50 m 60 60 l S")}
    poly = pdf_reader._polylines_from_stream(b"BT (see /Frm Do here) Tj ET 0 0 m 1 1 l S", IDENTITY, PAGE_RESOURCES, objects)
    assert poly == [[(0.0, 0.0), (1.0, 1.0)]]


def test_objstm_with_indirect_length_is_loaded(tmp_path):
    packed = zlib.compress(b"1 0 <</Type/Page/MediaBox[0 0 100 100]>>")
    path = tmp_path / "x.pdf"
    path.write_bytes(
        b"%PDF-1.6\n5 0 obj\n<</Length 6 0 R/Filter/FlateDecode/N 1/First 4/Type/ObjStm>>stream\n"
        + packed
        + b"\nendstream\nendobj\n6 0 obj\n"
        + str(len(packed)).encode()
        + b"\nendobj\n"
    )
    objects = pdf_reader._load_objects(path)
    assert pdf_reader._dict_get(objects[1], b"/Type") == b"/Page"


def test_whole_pdf_page_box_text_and_forms(tmp_path):
    path = tmp_path / "x.pdf"
    path.write_bytes(
        make_pdf(
            b"BT 1 0 0 1 40 300 Tm (P4711)Tj ET 1 0 0 RG 0 0 m 50 0 l S q 1 0 0 1 200 100 cm /Br Do Q",
            box=(0, 0, 400, 300),
            xobjects={"Br": form_xobject(b"0 0 1 RG 0 0 m 0 50 l S")},
        )
    )
    assert pdf_reader.page_box(path) == (0.0, 0.0, 400.0, 300.0)
    assert pdf_reader.text_items(path) == [{"text": "P4711", "x": 40.0, "y": 300.0}]
    assert pdf_reader.polylines(path) == [[(0.0, 0.0), (50.0, 0.0)], [(200.0, 100.0), (200.0, 150.0)]]
    assert [d["color"] for d in pdf_reader.styled_polylines(path)] == [(1.0, 0.0, 0.0), (0.0, 0.0, 1.0)]


def test_flate_compressed_content_and_page_box_fallback(tmp_path):
    # no /MediaBox: the page box is the drawn extent
    path = tmp_path / "x.pdf"
    stream = zlib.compress(b"10 20 m 110 220 l S")
    path.write_bytes(
        b"%PDF-1.4\n1 0 obj\n<</Type/Page/Contents 2 0 R>>\nendobj\n"
        + b"2 0 obj\n<</Length %d/Filter/FlateDecode>>stream\n%s\nendstream\nendobj\n" % (len(stream), stream)
    )
    assert pdf_reader.polylines(path) == [[(10.0, 20.0), (110.0, 220.0)]]
    assert pdf_reader.page_box(path) == (10.0, 20.0, 110.0, 220.0)


# --- SVG -------------------------------------------------------------------------

SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 80">
  <defs><symbol id="valve"><path d="M -2 -2 L 2 2" stroke="black"/></symbol>
        <g id="glyph0-1"><path d="M 0 0 L 900 900"/></g></defs>
  <clipPath id="c"><rect x="0" y="0" width="999" height="999"/></clipPath>
  <g transform="translate(10,20)">
    <line x1="0" y1="0" x2="30" y2="0" stroke="#ff0000" stroke-width="2"/>
    <rect x="0" y="10" width="20" height="10" stroke="blue"/>
  </g>
  <path d="M 5 5 L 15 5 L 15 15" stroke="rgb(0,255,255)"/>
  <path d="M 5 70 h 10" stroke="rgb(100%,0%,0%)"/>
  <circle cx="50" cy="50" r="5" stroke="none" fill="black"/>
  <use xlink:href="#valve" x="60" y="40"/>
  <text x="40" y="70">P-101</text>
</svg>"""


@pytest.fixture
def svg_path(tmp_path):
    path = tmp_path / "x.svg"
    path.write_bytes(SVG)
    return path


def test_svg_page_box_from_viewbox(svg_path):
    assert svg_reader.page_box(svg_path) == (0.0, 0.0, 100.0, 80.0)


def test_svg_styles_transforms_and_y_flip(svg_path):
    sp = svg_reader.styled_polylines(svg_path)
    colors = [d["color"] for d in sp]
    assert len(sp) == 5  # stroke="none" skipped; clipPath, <defs> and glyph templates not drawn
    red = [d for d in sp if d["color"] == (1.0, 0.0, 0.0)]
    assert red[0]["width"] == 2.0
    assert red[0]["points"][0] == (10.0, 60.0)  # translate(10,20), then y flipped: 80 - 20
    assert (0.0, 0.0, 1.0) in colors  # named colour
    assert (0.0, 1.0, 1.0) in colors  # rgb() 0-255
    assert red[1]["points"] == [(5.0, 10.0), (15.0, 10.0)]  # rgb() percentages, relative h


def test_svg_symbol_drawn_only_through_use(svg_path):
    valve = [pl for pl in svg_reader.polylines(svg_path) if pl[0] == (58.0, 42.0)]
    assert valve == [[(58.0, 42.0), (62.0, 38.0)]]


def test_svg_text(svg_path):
    assert svg_reader.text_items(svg_path) == [{"text": "P-101", "x": 40.0, "y": 10.0}]


def test_svg_transform_list_applies_left_to_right():
    m = svg_reader._parse_transform("translate(10,0) scale(2)")
    assert svg_reader.apply(m, 1, 1) == (12.0, 2.0)


def test_svg_placement_offset_cancels_pdftocairo_translate_pair(tmp_path):
    path = tmp_path / "x.svg"
    path.write_bytes(
        b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs><g id="surface1" transform="translate(30,40)"><line x1="0" y1="0" x2="10" y2="0" stroke="red"/></g></defs>
        <g transform="translate(-30,-40)"><use href="#surface1"/></g>
        </svg>"""
    )
    root = svg_reader.ET.parse(path).getroot()
    assert svg_reader._placement_offset(root)[4:] == (-30.0, -40.0)


def _flate_pdf(*contents: bytes) -> bytes:
    """A page whose content streams are these, each FlateDecode."""
    objs = []
    for i, c in enumerate(contents):
        s = zlib.compress(c, 9)
        objs.append(
            b"%d 0 obj\n<< /Length %d /Filter /FlateDecode >>\nstream\n" % (10 + i, len(s)) + s + b"\nendstream\nendobj\n"
        )
    refs = b" ".join(b"%d 0 R" % (10 + i) for i in range(len(contents)))
    page = b"1 0 obj\n<< /Type /Page /MediaBox [0 0 100 100] /Contents [" + refs + b"] >>\nendobj\n"
    return b"%PDF-1.4\n" + page + b"".join(objs) + b"%%EOF\n"


def test_a_pdf_stream_is_inflated_within_its_limits(tmp_path, monkeypatch):
    # B-S5: a 199 kB PDF inflated to 350 MB (56 s), a 1 MB one ran the app into the 2 GB guard

    p = tmp_path / "ok.pdf"
    p.write_bytes(_flate_pdf(b"0 0 m 10 10 l S\n"))
    assert pdf_reader.polylines(p) == [[(0.0, 0.0), (10.0, 10.0)]]
    monkeypatch.setattr(pdf_reader, "PDF_STREAM_MAX_BYTES", 1000)
    monkeypatch.setattr(pdf_reader, "PDF_INFLATE_MAX_BYTES", 3000)
    p.write_bytes(_flate_pdf(b" " * 1001))  # one stream over its cap
    with pytest.raises(ValueError, match="inflates to more than"):
        pdf_reader.polylines(p)
    p.write_bytes(_flate_pdf(*[b" " * 900] * 4))  # each within, together over the total
    with pytest.raises(ValueError, match="inflates to more than"):
        pdf_reader.polylines(p)
    p.write_bytes(_flate_pdf(*[b" " * 900] * 3))  # the total is per reading, not for good
    pdf_reader.polylines(p)
    pdf_reader.polylines(p)
