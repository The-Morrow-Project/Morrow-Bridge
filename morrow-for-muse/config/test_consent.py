"""Explicit negative consent stays negative after polite qualifiers."""

import pytest

from config.consent import explicit_nonapproval


@pytest.mark.parametrize("reply", [
    "No", "not sure", "Maybe", "don't approve", "I don't approve",
    "Please don't delete it", "Please don’t delete it",
    "Please, do not delete it", "Please not now",
    "I do not want this deleted", "I don't want this deleted",
    "Absolutely not", "Definitely no", "Certainly not",
    '  "Please, absolutely not"  ',
    "Ｐｌｅａｓｅ ｄｏｎ’ｔ ｄｅｌｅｔｅ ｉｔ",
])
def test_clear_denial_and_uncertainty_are_not_approval(reply):
    assert explicit_nonapproval(reply)


@pytest.mark.parametrize("reply", [
    "Yes", "Yes, delete it", "Please delete it",
    "Please, go ahead", "I do want this deleted",
    "Absolutely, yes. Delete it.", "Certainly, proceed",
    "Yes, delete it and do not send a notification",
])
def test_clear_positive_consent_is_not_rejected(reply):
    assert not explicit_nonapproval(reply)
