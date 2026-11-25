"""Read only an area of a drawing: the part the user selected before import, without the legend, the instrument
tables and the title block around it.

The area comes as fractions of the page (x0, y0, x1, y1; y down from the top, as the preview shows it). The readers'
geometry is in page space (y up): every polyline is clipped to the area (a pipe that leaves it is cut at the
border, not dropped), texts outside it are left out, and everything is moved so the area starts at (0, 0). The
extractors then see a smaller page and nothing of the rest.
"""

from __future__ import annotations

MIN_SIZE = 0.02  # an area narrower than 2 % of the page is a slip of the mouse, not a selection


def parse(text: str | None) -> tuple[float, float, float, float] | None:
    """ "x0,y0,x1,y1" (fractions of the page, y down) -> the area, or None for none; ValueError when malformed."""
    if not text:
        return None
    try:
        x0, y0, x1, y1 = (float(v) for v in text.split(","))
    except ValueError as exc:
        raise ValueError("crop is x0,y0,x1,y1: four fractions of the page") from exc
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        raise ValueError("crop must lie on the page: 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1")
    if x1 - x0 < MIN_SIZE or y1 - y0 < MIN_SIZE:
        raise ValueError("The selected area is too small")
    return x0, y0, x1, y1


def page_area(box: tuple, crop: tuple) -> tuple[float, float, float, float]:
    """The area in page space (y up): (X0, Y0, X1, Y1)."""
    bx0, by0, bx1, by1 = box
    w, h = bx1 - bx0, by1 - by0
    x0, y0, x1, y1 = crop
    return bx0 + x0 * w, by1 - y1 * h, bx0 + x1 * w, by1 - y0 * h


def _clip(p, q, area):
    """The segment p-q inside the area (Liang-Barsky), or None."""
    X0, Y0, X1, Y1 = area
    dx, dy = q[0] - p[0], q[1] - p[1]
    t0, t1 = 0.0, 1.0
    for d, lo in ((-dx, p[0] - X0), (dx, X1 - p[0]), (-dy, p[1] - Y0), (dy, Y1 - p[1])):
        if d == 0:
            if lo < 0:
                return None
            continue
        t = lo / d
        if d < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return (p[0] + t0 * dx, p[1] + t0 * dy), (p[0] + t1 * dx, p[1] + t1 * dy)


def clip_polyline(points: list, area: tuple) -> list[list[tuple[float, float]]]:
    """The pieces of a polyline inside the area (a polyline that leaves and comes back gives two)."""
    pieces: list[list[tuple[float, float]]] = []
    if len(points) == 1:
        x, y = points[0]
        return [[(x, y)]] if area[0] <= x <= area[2] and area[1] <= y <= area[3] else []
    for p, q in zip(points, points[1:], strict=False):
        seg = _clip(p, q, area)
        if seg is None:
            continue
        a, b = seg
        if pieces and pieces[-1][-1] == a:
            pieces[-1].append(b)
        else:
            pieces.append([a, b])
    return pieces


def crop(box, polylines, styled, texts, area_fractions):
    """(box, polylines, styled, texts) of the area only, moved so it starts at (0, 0)."""
    area = page_area(box, area_fractions)
    X0, Y0, X1, Y1 = area

    def move(pts):
        return [(x - X0, y - Y0) for x, y in pts]

    out_lines = [move(piece) for pl in polylines for piece in clip_polyline(pl, area)]
    out_styled = [{**d, "points": move(piece)} for d in styled for piece in clip_polyline(d["points"], area)]
    out_texts = [{**t, "x": t["x"] - X0, "y": t["y"] - Y0} for t in texts if X0 <= t["x"] <= X1 and Y0 <= t["y"] <= Y1]
    return (0.0, 0.0, X1 - X0, Y1 - Y0), out_lines, out_styled, out_texts


def demo() -> None:
    """Self-check: the right half of a 100 x 100 page, a pipe across it cut at the border, a text left out."""
    box, lines, styled, texts = crop(
        (0, 0, 100, 100),
        [[(10, 50), (90, 50)], [(10, 10), (20, 10)]],
        [{"points": [(60, 0), (60, 100)], "color": (1, 0, 0)}],
        [{"text": "legend", "x": 5, "y": 5}, {"text": "P1", "x": 70, "y": 40}],
        parse("0.5,0,1,1"),
    )
    assert box == (0.0, 0.0, 50.0, 100.0), box
    assert lines == [[(0.0, 50.0), (40.0, 50.0)]], lines  # cut at x = 50, the part on the left gone
    assert styled == [{"points": [(10.0, 0.0), (10.0, 100.0)], "color": (1, 0, 0)}], styled
    assert texts == [{"text": "P1", "x": 20, "y": 40}], texts
    # y down in the fractions: the top fifth of the page is the highest y in page space
    assert page_area((0, 0, 100, 100), (0, 0, 1, 0.2)) == (0, 80, 100, 100)


if __name__ == "__main__":
    demo()
    print("ok")
