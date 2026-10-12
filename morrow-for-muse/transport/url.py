"""Shared HTTPS site-base normalizer.

Call this before a session or a cookie is attached. The rules are
moodle.contracts.normalize_moodle_base. MOODLE_BASE_ALLOW_HTTP=1
accepts http for tests and LAN fixtures.
"""
from moodle.contracts import normalize_moodle_base


def normalize_base_url(raw: str) -> str:
    """Return the HTTPS site base. Refuse plaintext unless overridden."""
    return normalize_moodle_base(raw)
