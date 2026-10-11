"""Onboarding requires readable cookies persisted in the helper profile."""

import importlib.util
import os
import sqlite3
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
TREE = os.path.dirname(HERE)
for path in (TREE, os.path.join(TREE, "transport"), HERE):
    if path not in sys.path:
        sys.path.insert(0, path)


@pytest.fixture
def server(tmp_path, monkeypatch):
    import config.selftest_home  # noqa: F401
    spec = importlib.util.spec_from_file_location(
        "helper_cookie_store_test", os.path.join(HERE, "server.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "PROFILE_DIR", str(tmp_path))
    return module


def _cookie_store(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE cookies (value TEXT)")
        connection.executemany("INSERT INTO cookies VALUES (?)",
                               [("scratch-cookie",)] * rows)


def test_absent_cookie_store_does_not_complete_onboarding(server):
    assert server._profile_has_cookies() is False


@pytest.mark.parametrize("candidate", ("Default/Cookies", "Cookies"))
@pytest.mark.parametrize("rows", (0, 1))
def test_cookie_store_requires_persisted_rows(server, tmp_path, candidate, rows):
    _cookie_store(tmp_path / candidate, rows)
    assert server._profile_has_cookies() is (rows > 0)


@pytest.mark.parametrize("invalid_store", ("corrupt", "missing-table"))
@pytest.mark.parametrize("fallback_populated", (False, True))
def test_unreadable_cookie_store_checks_remaining_candidate(
        server, tmp_path, invalid_store, fallback_populated):
    candidate = tmp_path / "Default" / "Cookies"
    candidate.parent.mkdir()
    if invalid_store == "corrupt":
        candidate.write_bytes(b"not a SQLite cookie database")
    else:
        with sqlite3.connect(candidate) as connection:
            connection.execute("CREATE TABLE unrelated (value TEXT)")
    if fallback_populated:
        _cookie_store(tmp_path / "Cookies", 1)
    assert server._profile_has_cookies() is fallback_populated
