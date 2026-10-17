import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from analyze_recordings import listened  # noqa: E402


def test_listened_window_is_kept_once_counts_are_typed():
    row = {"listen_from": "0:41", "listen_to": "2:17", "your_fillers": "22", "your_repairs": ""}
    assert listened(row) == (41, 137)
    assert listened({**row, "listen_to": "02:17:00"}) == (41, 137)
    assert listened({**row, "your_fillers": ""}) is None
    assert listened({}) is None
