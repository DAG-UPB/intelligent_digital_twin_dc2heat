"""Plane-geometry primitives shared by the readers and the two extractors.

Matrices are PDF/SVG affine matrices [a b c d e f] in row-vector convention:
(x, y) maps to (a x + c y + e, b x + d y + f).
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar

Point = tuple[float, float]
Matrix = tuple[float, float, float, float, float, float]

IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

_deadline: ContextVar[tuple[float, float] | None] = ContextVar("pid_deadline", default=None)


@contextmanager
def time_limit(seconds: float) -> Iterator[None]:
    """A reading that `in_time` stops once it has taken `seconds` (in the same thread: the readers run in one)."""
    token = _deadline.set((time.monotonic() + seconds, seconds))
    try:
        yield
    finally:
        _deadline.reset(token)


def in_time() -> None:
    """TimeoutError once the reading's `time_limit` has passed: the steps that grow faster than the drawing (pairs of
    path ends, nodes against paths) call it in their loops, as a thread cannot be stopped from outside."""
    limit = _deadline.get()
    if limit is not None and time.monotonic() > limit[0]:
        raise TimeoutError(f"the drawing took longer than {limit[1]:g} s to read: crop it to the part you need")


def mat_mul(m: Matrix, n: Matrix) -> Matrix:
    """m x n: apply m first, then n."""
    a1, b1, c1, d1, e1, f1 = m
    a2, b2, c2, d2, e2, f2 = n
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def apply(m: Matrix, x: float, y: float) -> Point:
    """Map one point through a matrix."""
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


def cubic_bezier(p0: Point, c1: Point, c2: Point, p3: Point, steps: int = 8) -> list[Point]:
    """Sample a cubic Bezier as `steps` points, excluding the start point.

    A pipe elbow only needs to survive as a connected path, not to be smooth: 8 keeps a
    90-degree arc within a fraction of a unit of true.
    """
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1.0 - t
        out.append(
            (
                u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
                u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
            )
        )
    return out


def path_length(points: Sequence[Point]) -> float:
    """Length of a polyline."""
    return sum(math.dist(points[i], points[i + 1]) for i in range(len(points) - 1))


def centroid(points: Sequence[Point]) -> Point:
    """Mean of the points."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def point_seg_distance(p: Point, a: Point, b: Point) -> tuple[float, float]:
    """Distance from p to segment a-b, and the fraction t (clamped to [0, 1]) of the foot along a-b."""
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    den = dx * dx + dy * dy
    if den == 0:
        return math.dist(p, a), 0.0
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / den))
    return math.dist(p, (ax + t * dx, ay + t * dy)), t


class UnionFind:
    """Disjoint sets over 0..n-1; groups() lists members in index order (deterministic ids)."""

    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        """Root of i's set (with path halving)."""
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, i: int, j: int) -> None:
        """Merge the sets of i and j."""
        ri, rj = self.find(i), self.find(j)
        if ri != rj:
            self.parent[ri] = rj

    def groups(self) -> list[list[int]]:
        """Every set as a list of its members."""
        g = defaultdict(list)
        for i in range(len(self.parent)):
            g[self.find(i)].append(i)
        return list(g.values())
