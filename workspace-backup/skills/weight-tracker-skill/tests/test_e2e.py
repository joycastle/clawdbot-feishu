"""End-to-end test: CSV → PNG report."""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from generate_report import generate_report

SKILL_DIR = Path(__file__).parent.parent


def test_generates_png_from_sample_data(tmp_path):
    csv_path = SKILL_DIR / "data" / "sample.csv"
    output_path = tmp_path / "test_report.png"

    generate_report(
        csv_path=str(csv_path),
        target_date=date(2026, 3, 2),
        output_path=str(output_path),
        team_name="测试勇士团",
    )

    assert output_path.exists()
    assert output_path.stat().st_size > 5000


def test_output_is_valid_png(tmp_path):
    from PIL import Image

    csv_path = SKILL_DIR / "data" / "sample.csv"
    output_path = tmp_path / "test_report.png"

    generate_report(
        csv_path=str(csv_path),
        target_date=date(2026, 3, 2),
        output_path=str(output_path),
    )

    img = Image.open(str(output_path))
    assert img.size == (800, 1200)
    assert img.mode == "RGB"
