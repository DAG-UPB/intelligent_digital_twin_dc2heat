"""PDF reader: page box, polylines, stroked polylines with colour, and text runs. Stdlib only.

Reads the raw content streams (FlateDecode or plain), including objects packed into /ObjStm
streams and Form XObjects placed with `/Name Do`. Every coordinate goes through the current
transformation matrix (q/Q/cm stack, form /Matrix), so points come out in page space with
PDF's bottom-left origin. Curves (c/v/y) are flattened, `re` becomes a closed rectangle.
Text in CID fonts is decoded through the merged /ToUnicode CMaps.

Same four functions as svg_reader: page_box, polylines, styled_polylines, text_items.
"""

from __future__ import annotations

import functools
import re
import zlib
from contextvars import ContextVar
from pathlib import Path

from ..core.limits import PDF_INFLATE_MAX_BYTES, PDF_STREAM_MAX_BYTES
from .geometry import IDENTITY, apply, cubic_bezier, mat_mul

_STREAM_RE = re.compile(rb"stream\r?\n(.*?)endstream", re.DOTALL)
_NUM = rb"[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?"
# q/Q/cm are matched in the SAME pass as the path operators: a transform only
# means anything relative to the path ops that follow it, so order matters and
# two separate scans would lose it.
# fmt: off
_PATH_OP_RE = re.compile(
    rb"(" + _NUM + rb")\s+(" + _NUM + rb")\s+m"
    rb"|(" + _NUM + rb")\s+(" + _NUM + rb")\s+l"
    rb"|(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+re"
    rb"|(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+("
    + _NUM + rb")\s+(" + _NUM + rb")\s+cm"
    rb"|(?<![A-Za-z0-9])(q|Q)(?![A-Za-z0-9])"
    # Appended last on purpose: the branches above are addressed by group
    # NUMBER, so inserting anything earlier silently renumbers them.
    rb"|(?P<pb1>" + _NUM + rb")\s+(?P<pb2>" + _NUM + rb")\s+(?P<pb3>" + _NUM + rb")\s+(?P<pb4>"
    + _NUM + rb")\s+(?P<pb5>" + _NUM + rb")\s+(?P<pb6>" + _NUM + rb")\s+c\b"
    rb"|(?P<pv1>" + _NUM + rb")\s+(?P<pv2>" + _NUM + rb")\s+(?P<pv3>" + _NUM + rb")\s+(?P<pv4>"
    + _NUM + rb")\s+(?P<pvop>[vy])\b"
    # A string literal consumed and discarded, matched BEFORE the Do
    # alternative below it: without this, "/Frm Do" sitting inside a literal
    # like "(see /Frm Do here) Tj" matches the Do alternative and draws a
    # form that was never invoked -- the text just happened to say its name.
    rb"|\((?:\\.|[^\\()])*\)"
    rb"|/(?P<pdoname>[^\s/<>\[\]()]+)\s+Do\b"
)
# fmt: on
# Text position needs the same q/Q/cm treatment as paths, and for the same
# reason: Tm/Td give a position in the current space, not on the page. Scanned
# in one pass with the text operators so ordering is preserved. Reading BT/ET
# blocks in isolation drops the enclosing cm entirely, which put every tag on
# the real hydraulic schematic near the origin instead of on its pipe.
# fmt: off
_TEXT_OP_RE = re.compile(
    rb"(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+("
    + _NUM + rb")\s+(" + _NUM + rb")\s+cm"
    rb"|(?<![A-Za-z0-9])(q|Q)(?![A-Za-z0-9])"
    rb"|(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+("
    + _NUM + rb")\s+(" + _NUM + rb")\s+Tm"
    rb"|(" + _NUM + rb")\s+(" + _NUM + rb")\s+T[dD]"
    rb"|(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)\s*(Tj|TJ)"
    rb"|/(?P<tdoname>[^\s/<>\[\]()]+)\s+Do\b"
)
# fmt: on
_MEDIABOX_RE = re.compile(rb"/MediaBox\s*\[\s*(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s+(" + _NUM + rb")\s*\]")
_TOUNICODE_BFCHAR_RE = re.compile(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>")
_TOUNICODE_BFRANGE_RE = re.compile(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>")


_left: ContextVar[list[int] | None] = ContextVar("pdf_inflate_left", default=None)  # bytes one reading may inflate


def _inflate(raw: bytes, whole: bool = True) -> bytes:
    """A FlateDecode stream, inflated: at most PDF_STREAM_MAX_BYTES of it, and within what the reading has left of
    PDF_INFLATE_MAX_BYTES (`_limited`), else ValueError (a 199 kB file once inflated to 350 MB). zlib.error for data
    that is not Flate, or (`whole`, as zlib.decompress) a stream cut off before its end."""
    d = zlib.decompressobj()
    out = d.decompress(raw, PDF_STREAM_MAX_BYTES + 1)
    if len(out) > PDF_STREAM_MAX_BYTES:
        raise ValueError(f"a stream of the PDF inflates to more than {PDF_STREAM_MAX_BYTES // 2**20} MB")
    if whole and not d.eof:
        raise zlib.error("incomplete stream")
    left = _left.get()
    if left is not None:
        left[0] -= len(out)
        if left[0] < 0:
            raise ValueError(f"the PDF inflates to more than {PDF_INFLATE_MAX_BYTES // 2**20} MB")
    return out


def _limited(read):
    """One reading (page_box, polylines, ...) inflates at most PDF_INFLATE_MAX_BYTES in all, its forms each time
    they are placed included."""

    @functools.wraps(read)
    def run(*args, **kwargs):
        if _left.get() is not None:  # inside another reading: its budget
            return read(*args, **kwargs)
        token = _left.set([PDF_INFLATE_MAX_BYTES])
        try:
            return read(*args, **kwargs)
        finally:
            _left.reset(token)

    return run


def _read_streams(pdf_path) -> list[bytes]:
    with open(pdf_path, "rb") as f:
        data = f.read()
    out = []
    for m in _STREAM_RE.finditer(data):
        raw = m.group(1)
        try:
            out.append(_inflate(raw))
        except zlib.error:
            # Not FlateDecode (or already-plain) content; use raw bytes.
            out.append(raw)
    return out


def _read_raw(pdf_path) -> bytes:
    with open(pdf_path, "rb") as f:
        return f.read()


# --- Form XObject resolution -------------------------------------------
#
# `/Name Do` places another object's content at the CTM in force when Do is
# executed. Without resolving it, a form's path/text coordinates are read as
# if they were page coordinates -- they are not, they're in the form's own
# space, fixed up only by composing the placement CTM (and the form's own
# /Matrix, if it has one). A tag inside a form with no internal `cm` then
# keeps whatever raw numbers its Tm/Td happened to use, which can look
# page-sized by coincidence and still land badly wrong (measured: a tag
# 384 units off in y, the exact height of the page's own y-flip it never
# received).
#
# The object graph needed to resolve /Name -> object is usually NOT sitting
# in the raw bytes as "N 0 obj": modern PDF writers pack most objects
# (including /Page and its /Resources) into compressed /ObjStm streams. So
# object lookup checks both: plain "N 0 obj ... endobj" bodies, and objects
# packed into /ObjStm streams (self-describing via /N count and /First
# offset -- no xref table needed to read them).
_OBJ_RE = re.compile(rb"(?<![0-9])(\d+)\s+0\s+obj\b(.*?)endobj", re.DOTALL)
_OBJSTM_HDR_RE = re.compile(rb"<<(.*?)>>\s*stream\r?\n", re.DOTALL)


def _skip_dict(data: bytes, start: int) -> int:
    """Index just past the ">>" matching the "<<" at data[start:start+2].

    String-aware: a literal string `(...)` can itself contain "<<" or ">>"
    (a PDF /Title or /Contents commonly does), which would desync a naive
    depth count. `\\(` is an escaped paren, not a string boundary.
    """
    depth, i, n = 1, start + 2, len(data)
    while depth and i < n:
        if data[i : i + 1] == b"(":
            d, i = 1, i + 1
            while d and i < n:
                if data[i : i + 1] == b"\\":
                    i += 2
                    continue
                if data[i : i + 1] == b"(":
                    d += 1
                elif data[i : i + 1] == b")":
                    d -= 1
                i += 1
            continue
        if data[i : i + 2] == b"<<":
            depth += 1
            i += 2
        elif data[i : i + 2] == b">>":
            depth -= 1
            i += 2
        else:
            i += 1
    return i


def _dict_body(obj_bytes: bytes) -> bytes | None:
    """Bytes strictly between the outer <</first dict's matching >>.

    Found by depth-counting from the first "<<", not by a greedy regex --
    obj_bytes can have a compressed stream trailing the dict, and a naive
    ``<<(.*)>>`` grabs up to the LAST ">>" in the whole blob, which for a
    stream object may not even be inside the dict.
    """
    i = obj_bytes.find(b"<<")
    if i < 0:
        return None
    return obj_bytes[i + 2 : _skip_dict(obj_bytes, i) - 2]


def _dict_get(obj_bytes: bytes, key: bytes) -> bytes | None:
    """Raw text of /key's value, scanning only the TOP LEVEL of the first
    <<...>> dict in obj_bytes -- a key search that ignored nesting depth
    matched /Type inside a nested /Group<<...Type/Group>> sub-dict instead
    of the page's own /Type/Page, which made every page look like a
    non-page object and silently dropped Do-resolution to a no-op.
    """
    body = _dict_body(obj_bytes)
    if body is None:
        return None
    i = 0
    n = len(body)
    while i < n:
        if body[i : i + 2] == b"<<":  # skip a whole nested dict
            i = _skip_dict(body, i)
            continue
        if body[i : i + 1] == b"/":
            km = re.match(rb"/[^\s/<>\[\]()]+", body[i:])
            if not km:
                i += 1
                continue
            name = km.group(0)
            i += km.end()
            if name == key:
                rest = body[i:].lstrip()
                if rest[:2] == b"<<":
                    return rest[: _skip_dict(rest, 0)]
                m = re.match(rb"\[.*?\]|[-+0-9.]+\s+0\s+R|/[^\s/<>\[\]()]+|[^\s/<>\[\]()]+", rest)
                return m.group(0) if m else None
            continue
        i += 1
    return None


def _load_objects(pdf_path) -> dict[int, bytes]:
    """Every indirect object's body (dict + optional stream), by number.

    Covers plain "N 0 obj" bodies and objects packed into /ObjStm streams.
    Object streams can only hold non-stream objects (dicts/arrays/etc, per
    spec), so this never needs to recurse into an /ObjStm found inside
    another /ObjStm.
    """
    data = _read_raw(pdf_path)
    objects: dict[int, bytes] = {}
    for m in _OBJ_RE.finditer(data):
        objects[int(m.group(1))] = m.group(2)

    for body in list(objects.values()):
        if b"/ObjStm" not in body:
            continue
        hm = _OBJSTM_HDR_RE.search(body)
        if not hm:
            continue
        hdr = hm.group(1)
        n_m = re.search(rb"/N\s+(\d+)", hdr)
        first_m = re.search(rb"/First\s+(\d+)", hdr)
        if not (n_m and first_m):
            continue
        first = int(first_m.group(1))
        # /Length is not required here: a linearized file can write it as
        # an indirect reference ("/Length 2 0 R"), which the old /Length\s+
        # (\d+) regex can't parse, dropping the ENTIRE ObjStm -- every
        # object it packs, silently -- and reverting Do-resolution to a
        # no-op. decompressobj() finds its own end of stream without
        # needing a length at all, direct or indirect.
        try:
            dec = _inflate(body[hm.end() :], whole=False)
        except zlib.error:
            continue
        pairs = dec[:first].split()
        try:
            offsets = [(int(pairs[i]), int(pairs[i + 1])) for i in range(0, len(pairs) - 1, 2)]
            for i, (onum, off) in enumerate(offsets):
                end = offsets[i + 1][1] if i + 1 < len(offsets) else len(dec) - first
                objects.setdefault(onum, dec[first + off : first + end])
        except (ValueError, IndexError):
            # A malformed ObjStm header/offset table shouldn't take the
            # whole read down -- skip just this stream, keep what plain
            # "N 0 obj" bodies and other ObjStms already gave us.
            continue
    return objects


def _xobject_names(resources_bytes: bytes | None) -> dict[bytes, int]:
    """{/Name: object number} from a /Resources dict's /XObject sub-dict."""
    if not resources_bytes:
        return {}
    xo = _dict_get(resources_bytes, b"/XObject")
    if not xo:
        return {}
    return {name: int(num) for name, num in re.findall(rb"/([^\s/<>\[\]()]+)\s+(\d+)\s+0\s+R", xo)}


def _indirect_num(raw: bytes | None) -> int | None:
    """Object number out of an indirect reference's raw bytes ("13 0 R")."""
    if not raw:
        return None
    m = re.match(rb"(\d+)\s+0\s+R", raw)
    return int(m.group(1)) if m else None


def _parse_matrix(raw: bytes | None) -> tuple[float, ...] | None:
    if not raw:
        return None
    nums = re.findall(_NUM, raw)
    if len(nums) != 6:
        return None
    return tuple(float(n) for n in nums)


def _resources_of(dict_bytes: bytes | None, objects: dict[int, bytes]) -> bytes | None:
    """A page/form's own /Resources dict, resolved whether it's an indirect
    reference ("3 0 R") or written inline ("<</XObject<<...>>>>").

    Every one of the three Do-resolution call sites, plus the page/Pages
    lookup, used to test `_indirect_num(ref) is not None` and fall back to
    the invoking resources otherwise -- which silently treated a direct
    inline /Resources dict as "no resources of its own", losing every
    nested XObject a form with an inline /Resources referenced. A form
    written `/Resources<</XObject<</Inner 10 0 R>>>>` with body `/Inner Do`
    resolved to [] before this.
    """
    if dict_bytes is None:
        return None
    r = _dict_get(dict_bytes, b"/Resources")
    if r is None:
        return None
    rn = _indirect_num(r)
    return objects.get(rn) if rn is not None else r


@_limited
def page_box(pdf_path: str | Path) -> tuple[float, float, float, float]:
    """Page rectangle in points.

    /MediaBox is required but need not be literal in the raw file: it is
    inheritable from the /Pages parent, may be an indirect reference, and in
    a cross-reference-stream PDF the object holding it is itself compressed.
    So look in the raw bytes, then inside every decompressed stream, and
    only then fall back to the drawn extent.
    """
    for blob in (_read_raw(pdf_path), *_read_streams(pdf_path)):
        m = _MEDIABOX_RE.search(blob)
        if m:
            x0, y0, x1, y1 = (float(g) for g in m.groups())
            if x1 - x0 > 1 and y1 - y0 > 1:
                return (x0, y0, x1, y1)

    # Last resort: bound the geometry itself. Loses the sheet margin, so the
    # origin is wrong by however much white space framed the drawing, but a
    # usable extent beats refusing the file.
    pls = polylines(pdf_path)
    pts = [pt for pl in pls for pt in pl]
    if not pts:
        raise ValueError("no /MediaBox and no vector paths found -- is this a scanned PDF?")
    xs = [x for x, _ in pts]
    ys = [y for _, y in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def _resolve_form(obj: bytes, ctm, resources, objects):
    """A Form XObject's own (decompressed content, composed CTM, resources),
    or None if `obj` isn't a Form (an Image, most commonly -- Do only
    recurses into a Form) or carries no usable stream.

    Shared by all three Do-aware stream walkers (paths, text, styled
    strokes) so the composition rule lives in exactly one place: the point
    goes through the form's own /Matrix first, THEN the CTM in force at the
    Do -- mat_mul(mat, ctm), not the other way round. The tests catch a reversal
    of this (a form /Matrix offset composed on the wrong side lands at a
    different point than the placement CTM alone would predict).

    Stream bytes are sliced by /Length when the dict carries one, not found
    by re-searching for a literal "endstream" -- _STREAM_RE's non-greedy
    match stops at the FIRST "endstream"-looking byte sequence, which a
    binary FlateDecode payload can contain as data, truncating the real
    stream. /Length is only a fallback-worthy source of truth when present;
    _load_objects already leans on it the same way for ObjStm bodies.
    """
    if _dict_get(obj, b"/Subtype") != b"/Form":
        return None
    sm = _STREAM_RE.search(obj)
    if not sm:
        return None
    length = _dict_get(obj, b"/Length")
    ln = int(length) if length and length.isdigit() else None
    start = sm.start(1)
    raw = obj[start : start + ln] if ln is not None else sm.group(1)
    try:
        content = _inflate(raw)
    except zlib.error:
        content = raw
    mat = _parse_matrix(_dict_get(obj, b"/Matrix"))
    form_ctm = mat_mul(mat, ctm) if mat else ctm
    # ponytail: /BBox clip ignored; add when a sheet uses forms as clipped
    # viewports and geometry outside the box needs to be dropped.
    return content, form_ctm, _resources_of(obj, objects) or resources


def _polylines_from_stream(
    content: bytes, ctm0=IDENTITY, resources=None, objects=None, depth=0
) -> list[list[tuple[float, float]]]:
    """Polylines in page space.

    Path coordinates are in the current user space, which `cm` redefines and
    q/Q save and restore. A symbol placed by its own matrix therefore carries
    local coordinates that are meaningless until the CTM is applied, so every
    point is mapped through it here rather than emitted raw.

    `/Name Do` places a form XObject's own content stream at the CTM in
    force -- so a nested stream is parsed here too, seeded with that CTM
    composed with the form's own /Matrix, recursively (depth-capped: forms
    can and do reference forms, e.g. an ExtGState soft-mask form drawing
    another form). Image XObjects are not resolved; Do only recurses when
    the referenced object is /Subtype /Form.
    """
    polylines: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    # The last path point in UNTRANSFORMED user space. Curves are defined
    # relative to it, and inverting the CTM to recover it would be both
    # slower and undefined for a degenerate matrix.
    raw_pt: tuple[float, float] | None = None
    ctm = ctm0
    stack: list[tuple] = []
    xobjects = _xobject_names(resources) if objects is not None else {}

    def xf(x, y):
        return apply(ctm, x, y)

    for m in _PATH_OP_RE.finditer(content):
        if m.group(1) is not None:  # m (moveto) -- starts a new subpath
            if len(current) >= 2:
                polylines.append(current)
            raw_pt = (float(m.group(1)), float(m.group(2)))
            current = [xf(*raw_pt)]
        elif m.group(3) is not None:  # l (lineto)
            raw_pt = (float(m.group(3)), float(m.group(4)))
            current.append(xf(*raw_pt))
        elif m.group("pb1") is not None:  # c (cubic bezier)
            if raw_pt is not None:
                n = [float(m.group(f"pb{i}")) for i in range(1, 7)]
                pts = cubic_bezier(raw_pt, (n[0], n[1]), (n[2], n[3]), (n[4], n[5]))
                current.extend(xf(x, y) for x, y in pts)
                raw_pt = pts[-1]
        elif m.group("pv1") is not None:  # v / y (one control point implied)
            if raw_pt is not None:
                a = (float(m.group("pv1")), float(m.group("pv2")))
                b_ = (float(m.group("pv3")), float(m.group("pv4")))
                c1, c2 = (raw_pt, a) if m.group("pvop") == b"v" else (a, b_)
                pts = cubic_bezier(raw_pt, c1, c2, b_)
                current.extend(xf(x, y) for x, y in pts)
                raw_pt = pts[-1]
        elif m.group(5) is not None:  # re: x y w h
            if len(current) >= 2:
                polylines.append(current)
            current = []
            x, y, w, h = (float(g) for g in m.groups()[4:8])
            polylines.append(
                [
                    xf(x, y),
                    xf(x + w, y),
                    xf(x + w, y + h),
                    xf(x, y + h),
                    xf(x, y),
                ]
            )
        elif m.group(9) is not None:  # cm: concatenate onto the CTM
            ctm = mat_mul(tuple(float(g) for g in m.groups()[8:14]), ctm)
        elif m.group(15) is not None:  # q / Q
            if m.group(15) == b"q":
                stack.append(ctm)
            elif stack:
                ctm = stack.pop()
        elif m.group("pdoname") is not None and depth < 12:  # /Name Do
            onum = xobjects.get(m.group("pdoname"))
            obj = objects.get(onum) if onum is not None else None
            resolved = _resolve_form(obj, ctm, resources, objects) if obj else None
            if resolved:
                if len(current) >= 2:
                    polylines.append(current)
                current = []
                form_content, form_ctm, form_res = resolved
                polylines.extend(_polylines_from_stream(form_content, form_ctm, form_res, objects, depth + 1))

    if len(current) >= 2:
        polylines.append(current)
    return polylines


def _page_content_and_resources(pdf_path) -> list[tuple[bytes, bytes | None, dict]]:
    """[(content_bytes, resources_bytes_or_None, objects)] for every page.

    /Contents may be one stream or an array of several (concatenated with a
    blank line between, per spec) and /Resources is inheritable from the
    /Pages parent when a page doesn't carry its own -- both handled here so
    Do-resolution has what it needs without a full page tree walk.
    """
    objects = _load_objects(pdf_path)
    out = []
    for num, body in objects.items():
        if _dict_get(body, b"/Type") != b"/Page":
            continue
        res = _resources_of(body, objects)
        parent = _indirect_num(_dict_get(body, b"/Parent"))
        seen = {num}
        while res is None and parent is not None and parent not in seen:
            seen.add(parent)
            pbody = objects.get(parent)
            if pbody is None:
                break
            res = _resources_of(pbody, objects)
            parent = _indirect_num(_dict_get(pbody, b"/Parent"))
        contents_ref = _dict_get(body, b"/Contents")
        refs = (
            [int(n) for n in re.findall(rb"(\d+)\s+0\s+R", contents_ref)]
            if contents_ref and contents_ref.startswith(b"[")
            else ([_indirect_num(contents_ref)] if contents_ref else [])
        )
        chunks = []
        for r in refs:
            cobj = objects.get(r)
            if cobj is None:
                continue
            sm = _STREAM_RE.search(cobj)
            if not sm:
                continue
            try:
                chunks.append(_inflate(sm.group(1)))
            except zlib.error:
                chunks.append(sm.group(1))
        if chunks:
            out.append((b"\n".join(chunks), res, objects))
    return out


@_limited
def polylines(pdf_path: str | Path) -> list[list[tuple[float, float]]]:
    """Every path (m/l/re/curves) of every page as a polyline in page space, painted or not."""
    pages = _page_content_and_resources(pdf_path)
    if not pages:
        # No /Page object found (e.g. an unusual writer this reader's object
        # loader doesn't cover) -- fall back to scanning every stream flat,
        # as before. Forms won't resolve, but geometry isn't lost outright.
        result: list[list[tuple[float, float]]] = []
        for content in _read_streams(pdf_path):
            result.extend(_polylines_from_stream(content))
        return result
    result = []
    for content, res, objects in pages:
        result.extend(_polylines_from_stream(content, IDENTITY, res, objects))
    return result


# Tokens relevant to graphics-state tracking for styled_polylines: path
# construction (m/l/re), state push/pop (q/Q), line width (w), stroke/fill
# colour (RG/rg/G/g), and the paint ops that end a path (S/s/f/F/f*/B/B*/b/b*/n).
# n (no-op paint -- clip-only or discarded path) is included because a q/Q or
# w between paths still needs to be seen even when the path itself isn't
# stroked.
# fmt: off
_TOKEN_RE = re.compile(
    rb"(?P<mx>" + _NUM + rb")\s+(?P<my>" + _NUM + rb")\s+m"
    rb"|(?P<lx>" + _NUM + rb")\s+(?P<ly>" + _NUM + rb")\s+l"
    rb"|(?P<rx>" + _NUM + rb")\s+(?P<ry>" + _NUM + rb")\s+(?P<rw>" + _NUM + rb")\s+(?P<rh>" + _NUM + rb")\s+re"
    rb"|(?P<ca>" + _NUM + rb")\s+(?P<cb>" + _NUM + rb")\s+(?P<cc>" + _NUM + rb")\s+(?P<cd>"
    + _NUM + rb")\s+(?P<ce>" + _NUM + rb")\s+(?P<cf>" + _NUM + rb")\s+cm\b"
    rb"|(?P<b1>" + _NUM + rb")\s+(?P<b2>" + _NUM + rb")\s+(?P<b3>" + _NUM + rb")\s+(?P<b4>"
    + _NUM + rb")\s+(?P<b5>" + _NUM + rb")\s+(?P<b6>" + _NUM + rb")\s+c\b"
    rb"|(?P<vy1>" + _NUM + rb")\s+(?P<vy2>" + _NUM + rb")\s+(?P<vy3>" + _NUM + rb")\s+(?P<vy4>"
    + _NUM + rb")\s+(?P<vyop>[vy])\b"
    rb"|(?P<q>q)\b"
    rb"|(?P<Q>Q)\b"
    rb"|(?P<wv>" + _NUM + rb")\s+w\b"
    rb"|(?P<rgr>" + _NUM + rb")\s+(?P<rgg>" + _NUM + rb")\s+(?P<rgb>" + _NUM + rb")\s+RG\b"
    rb"|(?P<Gv>" + _NUM + rb")\s+G\b"
    rb"|(?P<rgbr>" + _NUM + rb")\s+(?P<rgbg>" + _NUM + rb")\s+(?P<rgbb>" + _NUM + rb")\s+rg\b"
    rb"|(?P<gv>" + _NUM + rb")\s+g\b"
    rb"|(?P<paint>B\*|b\*|f\*|S|s|f|F|B|b|n)\b"
    # A string literal consumed and discarded, matched BEFORE the Do
    # alternative below -- see _PATH_OP_RE's copy of this for why.
    rb"|\((?:\\.|[^\\()])*\)"
    rb"|/(?P<sdoname>[^\s/<>\[\]()]+)\s+Do\b"
)
# fmt: on


def _styled_polylines_from_stream(content: bytes, ctm0=IDENTITY, resources=None, objects=None, depth=0) -> list[dict]:
    """Walk a content stream tracking the q/Q graphics-state stack, current
    line width (w) and stroke colour (RG/rg/G/g), and emit one dict per
    polyline that was actually STROKED (S/s), carrying the width/colour in
    effect at that stroke op -- not merely the last w seen in the file.

    `/Name Do` on a Form XObject is resolved the same way as in
    _polylines_from_stream/_text_items_from_stream: recurse into the form's
    stream seeded with the CTM composed at the Do (and the form's own
    /Matrix). Chromatic pipe runs live inside forms on this drawing -- 615
    of 950 chromatic strokes, 68% of the chromatic ink -- and without this
    they keep the form's local coordinates while every other stream is
    already in page space, so the pipe network reads as if it stopped 44-244
    units short of equipment it actually runs up to.
    """
    polylines_out: list[dict] = []

    # Graphics state: (line_width, stroke_color-or-None, ctm). Default width
    # is 1.0 per the PDF spec; default colour is black, represented as None
    # (caller can treat None as "not explicitly set / default").
    state = (1.0, None, ctm0)
    stack: list[tuple] = []
    xobjects = _xobject_names(resources) if objects is not None else {}

    current: list[tuple[float, float]] = []
    pending: list[list[tuple[float, float]]] = []  # subpaths since last paint op

    def flush_current():
        nonlocal current
        if len(current) >= 2:
            pending.append(current)
        current = []

    for m in _TOKEN_RE.finditer(content):
        if m.group("mx") is not None:  # m
            flush_current()
            current = [(float(m.group("mx")), float(m.group("my")))]
        elif m.group("lx") is not None:  # l
            current.append((float(m.group("lx")), float(m.group("ly"))))
        elif m.group("b1") is not None:  # c -- cubic bezier, two control pts
            if current:
                current.extend(
                    cubic_bezier(
                        current[-1],
                        (float(m.group("b1")), float(m.group("b2"))),
                        (float(m.group("b3")), float(m.group("b4"))),
                        (float(m.group("b5")), float(m.group("b6"))),
                    )
                )
        elif m.group("vy1") is not None:  # v / y -- one control pt implied
            if current:
                p0 = current[-1]
                a = (float(m.group("vy1")), float(m.group("vy2")))
                b = (float(m.group("vy3")), float(m.group("vy4")))
                # v: first control is the current point. y: second is the end.
                c1, c2 = (p0, a) if m.group("vyop") == b"v" else (a, b)
                current.extend(cubic_bezier(p0, c1, c2, b))
        elif m.group("rx") is not None:  # re
            flush_current()
            x, y, w, h = (
                float(m.group("rx")),
                float(m.group("ry")),
                float(m.group("rw")),
                float(m.group("rh")),
            )
            pending.append([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)])
        elif m.group("ca") is not None:  # cm
            state = (
                state[0],
                state[1],
                mat_mul(tuple(float(m.group(k)) for k in ("ca", "cb", "cc", "cd", "ce", "cf")), state[2]),
            )
        elif m.lastgroup == "q":
            stack.append(state)
        elif m.lastgroup == "Q":
            if stack:
                state = stack.pop()
        elif m.group("wv") is not None:  # w
            state = (float(m.group("wv")), state[1], state[2])
        elif m.group("rgr") is not None:  # RG
            r, g, b = (float(m.group("rgr")), float(m.group("rgg")), float(m.group("rgb")))
            state = (state[0], (r, g, b), state[2])
        elif m.group("Gv") is not None:  # G
            gray = float(m.group("Gv"))
            state = (state[0], (gray, gray, gray), state[2])
        elif m.group("rgbr") is not None:  # rg
            r, g, b = (float(m.group("rgbr")), float(m.group("rgbg")), float(m.group("rgbb")))
            state = (state[0], (r, g, b), state[2])
        elif m.group("gv") is not None:  # g
            gray = float(m.group("gv"))
            state = (state[0], (gray, gray, gray), state[2])
        elif m.lastgroup == "paint":
            flush_current()
            op = m.group("paint")
            # B/b fill AND stroke the path, so their outline is drawn ink
            # exactly as S/s is. Dropping them lost 213 stroked paths on the
            # real hydraulic schematic (132 B + 81 b) -- 56 polylines and 13,704 units
            # of ink that polylines() reports and this reader did not, which
            # is pipework and symbol outlines the colour pass never saw.
            if op in (b"S", b"s", b"B", b"b", b"B*", b"b*"):
                width, color, ctm = state
                pending = [[apply(ctm, x, y) for x, y in pl] for pl in pending]
                for pl in pending:
                    polylines_out.append({"points": pl, "width": width, "color": color})
            pending = []
        elif m.group("sdoname") is not None and depth < 12:  # /Name Do
            onum = xobjects.get(m.group("sdoname"))
            obj = objects.get(onum) if onum is not None else None
            resolved = _resolve_form(obj, state[2], resources, objects) if obj else None
            if resolved:
                flush_current()
                form_content, form_ctm, form_res = resolved
                polylines_out.extend(_styled_polylines_from_stream(form_content, form_ctm, form_res, objects, depth + 1))

    flush_current()
    return polylines_out


@_limited
def styled_polylines(pdf_path: str | Path) -> list[dict]:
    """Like polylines(), but keeps the stroke width and colour in effect
    when each polyline was actually stroked (S/s), tracked correctly through
    the q/Q graphics-state stack. Paths that are never stroked (only filled,
    or painted with `n`) are not included -- they have no stroke width.
    Paths painted with B/b (fill and stroke) ARE included: their outline is
    stroked ink like any other.

    Routed through the same /Name Do resolution as polylines()/text_items(),
    for the same reason: a form's own strokes carry local coordinates until
    the placement CTM is composed in.
    """
    pages = _page_content_and_resources(pdf_path)
    if not pages:
        result: list[dict] = []
        for content in _read_streams(pdf_path):
            result.extend(_styled_polylines_from_stream(content))
        return result
    result = []
    for content, res, objects in pages:
        result.extend(_styled_polylines_from_stream(content, IDENTITY, res, objects))
    return result


def _load_tounicode_maps(pdf_path) -> list[dict[int, str]]:
    """Parse every /ToUnicode CMap stream into a CID->unicode-char dict.

    Multiple fonts each carry their own map; since content streams don't
    tell us which font is active without full resource-dict tracking, we
    merge all maps together. Fine for a single-document spike where CIDs
    don't collide across fonts in ways that matter for "is text readable".
    """
    data = _read_raw(pdf_path)
    maps: list[dict[int, str]] = []
    for m in re.finditer(rb"/ToUnicode\s+(\d+)\s+0\s+R", data):
        obj_num = m.group(1)
        obj_m = re.search(obj_num + rb"\s+0\s+obj.*?stream\r?\n(.*?)endstream", data, re.DOTALL)
        if not obj_m:
            continue
        try:
            cmap_data = _inflate(obj_m.group(1))
        except zlib.error:
            cmap_data = obj_m.group(1)
        maps.append(_parse_cmap(cmap_data))
    return maps


def _parse_cmap(cmap_data: bytes) -> dict[int, str]:
    mapping: dict[int, str] = {}

    def hex_to_unicode(h: bytes) -> str:
        h = h.strip()
        # UTF-16BE code units, 4 hex chars each.
        chars = []
        for i in range(0, len(h), 4):
            chunk = h[i : i + 4]
            if len(chunk) < 4:
                break
            chars.append(chr(int(chunk, 16)))
        return "".join(chars)

    for block_m in re.finditer(rb"beginbfchar(.*?)endbfchar", cmap_data, re.DOTALL):
        for cid_hex, dst_hex in _TOUNICODE_BFCHAR_RE.findall(block_m.group(1)):
            mapping[int(cid_hex, 16)] = hex_to_unicode(dst_hex)

    for block_m in re.finditer(rb"beginbfrange(.*?)endbfrange", cmap_data, re.DOTALL):
        for lo_hex, hi_hex, dst_hex in _TOUNICODE_BFRANGE_RE.findall(block_m.group(1)):
            lo, hi = int(lo_hex, 16), int(hi_hex, 16)
            base = int(dst_hex, 16) if len(dst_hex) <= 4 else None
            for offset, cid in enumerate(range(lo, hi + 1)):
                if base is not None:
                    mapping[cid] = chr(base + offset)
                else:
                    mapping[cid] = hex_to_unicode(dst_hex)
    return mapping


def _decode_hex_string(hexbytes: bytes, unicode_map: dict[int, str]) -> str:
    cleaned = re.sub(rb"\s+", b"", hexbytes)
    if len(cleaned) % 4 != 0:
        cleaned = cleaned[: len(cleaned) - (len(cleaned) % 4)]
    out = []
    for i in range(0, len(cleaned), 4):
        cid = int(cleaned[i : i + 4], 16)
        out.append(unicode_map.get(cid, "�"))
    return "".join(out)


_LITERAL_ESCAPES = {
    b"n": "\n",
    b"r": "\r",
    b"t": "\t",
    b"b": "\b",
    b"f": "\f",
    b"(": "(",
    b")": ")",
    b"\\": "\\",
}


def _decode_literal_string(lit: bytes) -> str:
    inner = lit[1:-1]
    out = []
    i = 0
    while i < len(inner):
        c = inner[i : i + 1]
        if c == b"\\" and i + 1 < len(inner):
            nxt = inner[i + 1 : i + 2]
            if nxt in _LITERAL_ESCAPES:
                out.append(_LITERAL_ESCAPES[nxt])
                i += 2
                continue
            if nxt.isdigit():
                oct_digits = inner[i + 1 : i + 4]
                m = re.match(rb"[0-7]{1,3}", oct_digits)
                if m:
                    out.append(chr(int(m.group(), 8) & 0xFF))
                    i += 1 + len(m.group())
                    continue
            out.append(nxt.decode("latin1"))
            i += 2
            continue
        out.append(c.decode("latin1"))
        i += 1
    return "".join(out)


def _decode_show_operand(operand: bytes, unicode_map: dict[int, str]) -> str:
    if operand.startswith(b"<"):
        return _decode_hex_string(operand[1:-1], unicode_map)
    return _decode_literal_string(operand)


def _text_items_from_stream(content: bytes, merged, ctm0=IDENTITY, resources=None, objects=None, depth=0) -> list[dict]:
    """Text items in page space, resolving /Name Do into Form XObjects.

    Mirrors _polylines_from_stream's Do handling for the same reason: text
    inside a form carries the form's local coordinates until the placement
    CTM (and the form's own /Matrix) is composed in. A form with no internal
    `cm` of its own previously kept whatever raw Tm/Td numbers it used,
    which can look plausibly page-sized and still land wrong -- silently,
    since nothing about the number looks broken on its own.
    """
    items: list[dict] = []
    ctm = ctm0
    stack: list = []
    xobjects = _xobject_names(resources) if objects is not None else {}
    # PDF keeps two text matrices: Tm replaces both, Td translates the
    # LINE matrix and resets the text matrix to it. Reading Td's operands
    # as an absolute position -- which this did -- puts every run after
    # the first at a small offset like (16.9, -7.8) instead of on the
    # page. On the real hydraulic schematic that stranded six equipment tags in
    # the sheet corner: T1 followed a Tm and landed correctly, M1.2 and
    # M1.1 followed Td and did not.
    tm = line = IDENTITY
    have_pos = False
    for m in _TEXT_OP_RE.finditer(content):
        g = m.groups()
        if g[0] is not None:  # cm
            ctm = mat_mul(tuple(float(v) for v in g[0:6]), ctm)
        elif g[6] is not None:  # q / Q
            if g[6] == b"q":
                stack.append(ctm)
            elif stack:
                ctm = stack.pop()
        elif g[7] is not None:  # Tm: sets both matrices
            tm = line = tuple(float(v) for v in g[7:13])
            have_pos = True
        elif g[13] is not None:  # Td / TD: relative
            tm = line = mat_mul((1.0, 0.0, 0.0, 1.0, float(g[13]), float(g[14])), line)
            have_pos = True
        elif g[15] is not None:  # Tj / TJ
            operand, op = g[15], g[16]
            if op == b"TJ":
                text = "".join(
                    _decode_show_operand(s, merged) for s in re.findall(rb"(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)", operand)
                )
            else:
                text = _decode_show_operand(operand, merged)
            if text and have_pos:
                # Origin of the text space, through the text matrix and
                # then the CTM. Composed at the show op because a cm may
                # intervene between positioning and painting.
                px, py = apply(mat_mul(tm, ctm), 0.0, 0.0)
                items.append({"text": text, "x": px, "y": py})
        elif m.group("tdoname") is not None and depth < 12:  # /Name Do
            onum = xobjects.get(m.group("tdoname"))
            obj = objects.get(onum) if onum is not None else None
            resolved = _resolve_form(obj, ctm, resources, objects) if obj else None
            if resolved:
                form_content, form_ctm, form_res = resolved
                items.extend(_text_items_from_stream(form_content, merged, form_ctm, form_res, objects, depth + 1))
    return items


@_limited
def text_items(pdf_path: str | Path) -> list[dict]:
    """[{text, x, y}] per text-showing operator, in page space."""
    merged: dict[int, str] = {}
    for m in reversed(_load_tounicode_maps(pdf_path)):
        merged.update(m)  # the first font's map that knows a CID wins

    pages = _page_content_and_resources(pdf_path)
    if not pages:
        # No /Page object found -- fall back to the flat per-stream scan.
        # Forms won't resolve, but text isn't lost outright.
        items: list[dict] = []
        for content in _read_streams(pdf_path):
            items.extend(_text_items_from_stream(content, merged))
        return items
    items = []
    for content, res, objects in pages:
        items.extend(_text_items_from_stream(content, merged, IDENTITY, res, objects))
    return items
