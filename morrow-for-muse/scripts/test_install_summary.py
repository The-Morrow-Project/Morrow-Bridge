"""The installer gives next steps for the selected provider."""
import os
from pathlib import Path
import subprocess

import pytest


TREE = Path(__file__).resolve().parents[1]


def _summary(provider, base):
    source = (TREE / "install.sh").read_text()
    marker = 'note "Install complete. What is next for you:"'
    tail = source[source.index(marker):]
    env = {**os.environ, "LMS_PROVIDER": provider, "LMS_BASE": base,
           "ENV_FILE": "/installed/morrow/helper/env"}
    return subprocess.run(
        ["bash", "-c", 'set -u\nnote() { printf \'%s\\n\' "$*"; }\n' + tail],
        env=env, text=True, capture_output=True, check=True).stdout


@pytest.mark.parametrize("base", ["https://lms.school.edu/moodle", ""])
def test_moodle_install_summary_uses_account_pairing(base):
    output = _summary("moodle", base)
    assert "MOODLE_BASE" in output
    assert "private helper card" in output
    assert "development candidate" in output
    assert "live provider proof remain release gates" in output
    assert "Connect my Canvas account" not in output
    assert "/api/v1/users/self" not in output
    if base:
        assert "bin/morrow moodle pair --site " + base in output
        assert "bin/morrow moodle status --site " + base in output
    else:
        assert "moodle/SKILL.md" in output
        assert "--site" not in output


def test_canvas_install_summary_keeps_own_profile_check():
    output = _summary("canvas", "https://school.instructure.com")
    assert "CANVAS_BASE" in output
    assert "catalog --name users_self" in output
    assert "/api/v1/users/self" in output
    assert "Connect my Canvas account" in output
    assert "moodle pair" not in output
