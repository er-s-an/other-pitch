"""Shot expected goals and pass expected value.

The pitch is 105 by 68 metres. Home attacks toward x = 105. Goal posts sit
3.66 metres either side of y = 34. Every figure is a deterministic function
of geometry and a pressure term in [0, 1]. Nothing here is learned from a
real match.
"""

from __future__ import annotations

import math

PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0
GOAL_Y = 34.0
GOAL_HALF = 3.66


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def sigmoid(z: float) -> float:
    if z >= 0:
        ez = math.exp(-z)
        return 1.0 / (1.0 + ez)
    ez = math.exp(z)
    return ez / (1.0 + ez)


def fmt(value: float) -> str:
    """Two-decimal text. Narration may only use strings produced here."""
    return f"{float(value):.2f}"


def goal_angle(x: float, y: float, goal_x: float) -> float:
    """Angle in radians subtended by the goal mouth from (x, y)."""
    v1 = (goal_x - x, (GOAL_Y - GOAL_HALF) - y)
    v2 = (goal_x - x, (GOAL_Y + GOAL_HALF) - y)
    n1 = math.hypot(*v1)
    n2 = math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return 0.0
    cos = clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2), -1.0, 1.0)
    return math.acos(cos)


def expected_goals(x: float, y: float, goal_x: float, pressure: float) -> float:
    """Logistic xG. Closer, more central, and calmer shots score higher."""
    angle = goal_angle(x, y, goal_x)
    dist = math.hypot(goal_x - x, GOAL_Y - y)
    logit = -0.35 + 3.45 * angle - 0.098 * dist - 1.5 * clamp(pressure, 0.0, 1.0)
    return clamp(sigmoid(logit), 0.005, 0.95)


def point_segment_distance(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    abx, aby = bx - ax, by - ay
    ab2 = abx * abx + aby * aby
    if ab2 < 1e-9:
        return math.hypot(px - ax, py - ay)
    t = clamp(((px - ax) * abx + (py - ay) * aby) / ab2, 0.0, 1.0)
    return math.hypot(px - (ax + t * abx), py - (ay + t * aby))


def lane_block(
    ax: float,
    ay: float,
    bx: float,
    by: float,
    opponents: list[tuple[float, float]],
) -> float:
    """1 when an opponent stands on the pass, 0 when the lane is clear for 6m."""
    if not opponents:
        return 0.0
    closest = min(point_segment_distance(ox, oy, ax, ay, bx, by) for ox, oy in opponents)
    return clamp(1.0 - closest / 6.0, 0.0, 1.0)


def pressure_at(
    x: float,
    y: float,
    opponents: list[tuple[float, float]],
    radius: float = 8.0,
) -> float:
    if not opponents:
        return 0.0
    acc = 0.0
    for ox, oy in opponents:
        dist = math.hypot(ox - x, oy - y)
        if dist < radius:
            acc += (1.0 - dist / radius) ** 2
    return clamp(acc / 2.2, 0.0, 1.0)


def pass_completion(distance: float, lane: float, pressure: float) -> float:
    logit = 3.2 - 0.055 * distance - 2.55 * lane - 1.25 * pressure
    return clamp(sigmoid(logit), 0.02, 0.97)


def pass_expected_value(completion: float, xg_on_receipt: float) -> float:
    """Immediate value of a pass: chance it arrives, times xG from the receiver."""
    return completion * xg_on_receipt


def best_option(options: list[dict]) -> dict:
    return max(options, key=lambda opt: opt["decision_score"])
