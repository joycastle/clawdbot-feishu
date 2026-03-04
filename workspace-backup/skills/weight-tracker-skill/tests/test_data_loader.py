"""Tests for data_loader module."""
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

# 让 tests/ 能 import scripts/ 下的模块
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from data_loader import load_data, compute_person_stats, find_mvp, xp_for_level, total_xp_for_level, level_from_xp, compute_xp


SAMPLE_CSV = """\
date,name,weight,calories_in,calories_out,target_weight,start_weight,start_date,end_date
2026-03-01,小王子,73.5,1480,1800,70,75,2026-02-15,2026-04-01
2026-03-01,小红,65.3,1200,1500,63,67,2026-02-15,2026-04-01
2026-03-02,小王子,73.2,1480,1810,70,75,2026-02-15,2026-04-01
2026-03-02,小红,65.1,1180,1520,63,67,2026-02-15,2026-04-01
"""


@pytest.fixture
def csv_path(tmp_path):
    p = tmp_path / "test_data.csv"
    p.write_text(SAMPLE_CSV, encoding="utf-8")
    return str(p)


class TestLoadData:
    def test_loads_csv_returns_dataframe(self, csv_path):
        df = load_data(csv_path)
        assert isinstance(df, pd.DataFrame)
        assert len(df) == 4

    def test_date_column_is_datetime(self, csv_path):
        df = load_data(csv_path)
        assert pd.api.types.is_datetime64_any_dtype(df["date"])

    def test_filters_by_target_date(self, csv_path):
        df = load_data(csv_path, target_date=date(2026, 3, 2))
        today = df[df["date"] == pd.Timestamp("2026-03-02")]
        assert len(today) == 2


class TestComputePersonStats:
    def test_basic_stats(self, csv_path):
        df = load_data(csv_path)
        stats = compute_person_stats(df, "小王子", date(2026, 3, 2))

        assert stats["name"] == "小王子"
        assert stats["weight"] == 73.2
        assert stats["target_weight"] == 70
        assert stats["start_weight"] == 75
        assert stats["calories_in"] == 1480
        assert stats["calories_out"] == 1810

    def test_calorie_deficit(self, csv_path):
        df = load_data(csv_path)
        stats = compute_person_stats(df, "小王子", date(2026, 3, 2))
        assert stats["calorie_deficit"] == -330

    def test_weight_change_from_yesterday(self, csv_path):
        df = load_data(csv_path)
        stats = compute_person_stats(df, "小王子", date(2026, 3, 2))
        assert abs(stats["weight_change"] - (-0.3)) < 0.01

    def test_progress_percentage(self, csv_path):
        df = load_data(csv_path)
        stats = compute_person_stats(df, "小王子", date(2026, 3, 2))
        assert abs(stats["progress"] - 0.36) < 0.01

    def test_day_number(self, csv_path):
        df = load_data(csv_path)
        stats = compute_person_stats(df, "小王子", date(2026, 3, 2))
        assert stats["day_number"] == 15

    def test_days_remaining(self, csv_path):
        df = load_data(csv_path)
        stats = compute_person_stats(df, "小王子", date(2026, 3, 2))
        assert stats["days_remaining"] == 30

    def test_is_on_track_when_deficit(self, csv_path):
        df = load_data(csv_path)
        stats = compute_person_stats(df, "小王子", date(2026, 3, 2))
        assert stats["is_on_track"] is True


class TestFindMVP:
    def test_finds_person_with_largest_deficit(self, csv_path):
        df = load_data(csv_path)
        stats_list = [
            compute_person_stats(df, "小王子", date(2026, 3, 2)),
            compute_person_stats(df, "小红", date(2026, 3, 2)),
        ]
        mvp = find_mvp(stats_list)
        assert mvp["name"] == "小红"

    def test_weight_history(self, csv_path):
        df = load_data(csv_path)
        stats = compute_person_stats(df, "小王子", date(2026, 3, 2))
        history = stats["weight_history"]
        assert len(history) == 2
        assert history[-1] == 73.2


class TestXPSystem:
    def test_xp_for_level(self):
        assert xp_for_level(1) == 100   # LV.1 需要 100
        assert xp_for_level(2) == 150   # LV.2 需要 150
        assert xp_for_level(3) == 200   # LV.3 需要 200
        assert xp_for_level(4) == 250   # LV.4 需要 250

    def test_total_xp_for_level(self):
        assert total_xp_for_level(1) == 100    # LV.1: 100
        assert total_xp_for_level(2) == 250    # LV.2: 100+150
        assert total_xp_for_level(3) == 450    # LV.3: 100+150+200

    def test_level_from_xp_zero(self):
        level, cur, needed = level_from_xp(0)
        assert level == 0
        assert cur == 0
        assert needed == 100

    def test_level_from_xp_exact_level1(self):
        level, cur, needed = level_from_xp(100)
        assert level == 1
        assert cur == 0
        assert needed == 150

    def test_level_from_xp_mid_level2(self):
        level, cur, needed = level_from_xp(200)
        assert level == 1
        assert cur == 100
        assert needed == 150

    def test_level_from_xp_exact_level2(self):
        level, cur, needed = level_from_xp(250)
        assert level == 2
        assert cur == 0
        assert needed == 200

    def test_compute_xp_with_sample_data(self, csv_path):
        """Day1: 小王子deficit=-320(MVP), 小红deficit=-300
        Day2: 小王子deficit=-330, 小红deficit=-340(MVP)
        小王子: 达标50*2 + MVP100*1 = 200
        小红: 达标50*2 + MVP100*1 = 200"""
        df = load_data(csv_path)
        xp_wangzi = compute_xp(df, "小王子", date(2026, 3, 2))
        xp_hong = compute_xp(df, "小红", date(2026, 3, 2))

        # 小王子: 2天达标*50 + 1天MVP*100 = 200 → LV.1 (剩100/150)
        assert xp_wangzi["total_xp"] == 200
        assert xp_wangzi["level"] == 1

        # 小红: 2天达标*50 + 1天MVP*100 = 200 → LV.1 (剩100/150)
        assert xp_hong["total_xp"] == 200
        assert xp_hong["level"] == 1
