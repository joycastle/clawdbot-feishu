"""Smoke tests for renderer module."""
import sys
from datetime import date
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from renderer import (
    create_canvas, render_title, render_character_status,
    render_weight_trend, render_calorie_chart, render_footer,
)


class TestCreateCanvas:
    def test_creates_image_of_correct_size(self):
        img = create_canvas()
        assert img.size == (800, 1200)
        assert img.mode == "RGB"


class TestRenderTitle:
    def test_renders_without_error(self):
        img = create_canvas()
        render_title(img, team_name="测试勇士团", day_number=14, days_remaining=28)
        assert img.size == (800, 1200)


class TestRenderCharacterStatus:
    def test_renders_single_person(self):
        img = create_canvas()
        stats = {
            "name": "小王子", "weight": 73.2, "target_weight": 70,
            "start_weight": 75, "calories_in": 1480, "calories_out": 1810,
            "calorie_deficit": -330, "weight_change": -0.3,
            "progress": 0.36, "day_number": 15, "is_on_track": True,
        }
        render_character_status(img, [stats])
        assert img.size == (800, 1200)

    def test_renders_multiple_people(self):
        img = create_canvas()
        stats_list = [
            {"name": "小王子", "weight": 73.2, "target_weight": 70, "start_weight": 75,
             "calories_in": 1480, "calories_out": 1810, "calorie_deficit": -330,
             "weight_change": -0.3, "progress": 0.36, "day_number": 15, "is_on_track": True},
            {"name": "小红", "weight": 65.1, "target_weight": 63, "start_weight": 67,
             "calories_in": 1180, "calories_out": 1520, "calorie_deficit": -340,
             "weight_change": -0.5, "progress": 0.475, "day_number": 15, "is_on_track": True},
        ]
        render_character_status(img, stats_list)
        assert img.size == (800, 1200)


class TestRenderWeightTrend:
    def test_renders_trend_chart(self):
        img = create_canvas()
        stats_list = [
            {"name": "小王子", "target_weight": 70,
             "weight_history": [75.0, 74.8, 74.5, 74.2, 73.8, 73.5, 73.2],
             "date_history": [date(2026, 2, 20+i) for i in range(7)]},
            {"name": "小红", "target_weight": 63,
             "weight_history": [67.0, 66.5, 66.2, 65.8, 65.5, 65.2, 65.1],
             "date_history": [date(2026, 2, 20+i) for i in range(7)]},
        ]
        render_weight_trend(img, stats_list)
        assert img.size == (800, 1200)


class TestRenderCalorieChart:
    def test_renders_calorie_bars(self):
        img = create_canvas()
        stats_list = [
            {"name": "小王子", "calories_in": 1480, "calories_out": 1810},
            {"name": "小红", "calories_in": 1180, "calories_out": 1520},
        ]
        render_calorie_chart(img, stats_list)
        assert img.size == (800, 1200)


class TestRenderFooter:
    def test_renders_footer(self):
        img = create_canvas()
        mvp = {"name": "小红", "calorie_deficit": -340}
        render_footer(img, mvp, date(2026, 3, 2))
        assert img.size == (800, 1200)
