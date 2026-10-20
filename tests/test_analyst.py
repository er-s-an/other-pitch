"""Pass expected value is completion times receipt xG. The shot scores as xG."""

from otherpitch.analyst import analyse
from otherpitch.analytics import expected_goals, pass_expected_value, pressure_at
from otherpitch.generator import generate


def test_pass_value_and_shot_score_identities():
    report = analyse(generate(7))
    shot = report["shot"]
    assert shot["decision_score"] == shot["expected_value"] == shot["xg"]
    assert 0.0 <= shot["pressure"] <= 1.0
    for option in report["passes"]:
        assert option["decision_score"] == option["expected_value"]
        assert option["decision_score"] == round(
            pass_expected_value(option["completion"], option["xg_receipt"]), 4
        )
        assert 0.0 <= option["completion"] <= 1.0
        assert 0.0 <= option["lane_block"] <= 1.0
    ranking = [next(item for item in report["passes"] + [shot] if item["id"] == name) for name in report["ranking"]]
    scores = [item["decision_score"] for item in ranking]
    assert scores == sorted(scores, reverse=True)
    assert any(item["taken"] for item in report["passes"])


def test_geometry_helpers_stay_in_range():
    xg = expected_goals(90, 34, 105, 0.2)
    assert 0.005 <= xg <= 0.95
    assert expected_goals(90, 34, 105, 0.0) > expected_goals(90, 34, 105, 0.9)
    assert pressure_at(50, 34, []) == 0.0
    close = pressure_at(50, 34, [(50.5, 34.2)])
    far = pressure_at(50, 34, [(70, 34)])
    assert close > far
