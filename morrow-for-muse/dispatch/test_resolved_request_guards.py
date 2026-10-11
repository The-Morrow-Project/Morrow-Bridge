"""Provider effects use resolved requests and the reviewed object identity."""

import json
import os

import pytest

from dispatch import admission
from dispatch import executor as ex
from dispatch.test_direct_lane_hardening import BASE, _pack, hermetic  # noqa: F401
from dispatch.test_round4_write_ceremony import hermetic_keys  # noqa: F401
from dispatch.test_chromium_presend_refusals import (  # noqa: F401
    CONV, TEACHER, USER, _session, reauth_home)
from modes.errors import DestructiveConfirmationRequired
from transport import browser_backend as bb


PAGE_PATH = "/api/v1/courses/{course_id}/pages/{url_or_id}"
ASSIGNMENT_PATH = "/api/v1/courses/{course_id}/assignments/{id}"
CTX = {"user_id": USER, "conversation_id": CONV,
       "course_resolution": {"course_id": "101", "confidence": 1.0,
                             "user_confirmed": True}}


class CanvasTab:
    def __init__(self, assignment=None):
        self.calls = []
        self.page = {"page_id": 7, "url": "welcome", "title": "Welcome"}
        self.other_page = None
        self.bound_page_response = None
        self.assignment = dict(assignment or {"id": 900, "name": "Essay",
                                             "is_quiz_lti_assignment": False})
        self.module = {"id": 7, "name": "Week 1"}

    def api(self, method, path, data=None, **kwargs):
        bare = path.split("?", 1)[0]
        self.calls.append((method, bare, data))
        if bare == "/api/v1/users/self":
            value = {"id": TEACHER, "name": "Edu T. Or"}
        elif bare.endswith(("/users", "/enrollments")):
            value = []
        elif bare == "/api/v1/courses/101":
            value = {"id": 101, "name": "Bio 101"}
        elif "/pages/" in bare:
            locator = bare.rsplit("/", 1)[-1]
            pages = [p for p in (self.page, self.other_page) if p is not None]
            if locator.startswith("page_id:"):
                value = next((p for p in pages
                              if str(p.get("page_id")) == locator[8:]), None)
                if self.bound_page_response is not None:
                    value = self.bound_page_response
            else:
                value = next((p for p in pages if p["url"] == locator), None)
                if value is None:
                    value = next((p for p in pages
                                  if str(p.get("page_id")) == locator), None)
            if method == "PUT" and value is not None:
                value.update(data["wiki_page"])
            elif method == "DELETE" and value is not None:
                if value is self.page:
                    self.page = None
                else:
                    self.other_page = None
        elif bare.endswith("/assignments/900"):
            value = self.assignment
            if method == "PUT" and value is not None:
                value.update(data["assignment"])
            elif method == "DELETE":
                self.assignment = None
        elif bare.endswith("/modules/7/items/3"):
            value = {"id": 3, "type": "Assignment", "content_id": 900}
        elif bare.endswith("/modules/7"):
            value = self.module
            if method == "DELETE":
                self.module = None
        else:
            raise AssertionError((method, path))
        return (404, {}, "{}") if value is None else (
            200, {}, json.dumps(value))

    def writes(self):
        return [c for c in self.calls if c[0] in ex.WRITE_METHODS]


@pytest.fixture
def canvas(monkeypatch):
    monkeypatch.setattr(ex._chromium_session_mod(),
                        "verify_helper_tenant_binding", lambda _base: None)
    tab = CanvasTab()
    return tab, _session(tab)


BLOCKED = [
    ("canvas_update_create_page_courses", "PUT", PAGE_PATH,
     {"course_id": "101", "url_or_id": "welcome"},
     {"wiki_page": "params.payload"},
     {"title": "New", "notify_of_update": True}, admission.NeverDispatch),
    ("canvas_update_course", "PUT", "/api/v1/courses/{id}", {"id": "101"},
     {"course": "params.payload"}, {"event": "delete"}, admission.EvidenceHold),
    ("canvas_update_single_quiz", "PATCH",
     "/api/quiz/v1/courses/{course_id}/quizzes/{assignment_id}",
     {"course_id": "101", "assignment_id": "900"},
     {"quiz": "params.payload"}, {"published": True}, admission.EvidenceHold),
    ("canvas_create_assignment", "POST",
     "/api/v1/courses/{course_id}/assignments", {"course_id": "101"},
     {"assignment": "params.payload"},
     {"name": "Forum", "submission_types": ["discussion_topic"]},
     admission.EvidenceHold),
]


@pytest.mark.parametrize("name,method,path,params,body,payload,refusal", BLOCKED)
def test_resolved_forbidden_fields_refuse_dispatch_and_preparation(
        canvas, name, method, path, params, body, payload, refusal):
    tab, session = canvas
    params = dict(params, payload=payload)
    with pytest.raises(refusal):
        ex.dispatch_catalog_op(name, method, path, params=params,
                               extra={"body": body}, session=session,
                               mode_ctx=CTX, pack=_pack())
    with pytest.raises(refusal):
        ex.prepare_plan_write(name, method, path, params, body, session,
                              _pack())
    assert tab.calls == []
    assert not ex.journal_pending_ops()


def test_resolved_quiet_update_keeps_approval_and_write_body_equal(canvas):
    tab, session = canvas
    params = {"course_id": "101", "url_or_id": "welcome",
              "payload": {"title": "New", "notify_of_update": False}}
    body = {"wiki_page": "params.payload"}
    prepared = ex.prepare_plan_write(
        "canvas_update_create_page_courses", "PUT", PAGE_PATH,
        params, body, session, _pack())
    with open(ex.pending_write_path(prepared["op_id"]), encoding="utf-8") as f:
        pending = json.load(f)
    assert pending["approval"]["request"]["body"] == {
        "wiki_page": params["payload"]}
    result = ex.approve_plan_write(prepared["op_id"], "Yes", session, _pack())
    assert result["outcome"] == "verified"
    assert tab.writes()[0][2] == pending["approval"]["request"]["body"]


@pytest.mark.parametrize("target", ["assignment", "module item"])
def test_resolved_publish_reads_and_refuses_the_new_quiz(canvas, target):
    tab, session = canvas
    tab.assignment["is_quiz_lti_assignment"] = True
    if target == "assignment":
        name = "canvas_edit_assignment"
        path = ASSIGNMENT_PATH
        params = {"course_id": "101", "id": "900"}
        body = {"assignment": "params.payload"}
    else:
        name = "canvas_update_module_item"
        path = "/api/v1/courses/{course_id}/modules/{module_id}/items/{id}"
        params = {"course_id": "101", "module_id": "7", "id": "3"}
        body = {"module_item": "params.payload"}
    params["payload"] = {"published": True}
    with pytest.raises(admission.EvidenceHold):
        ex.dispatch_catalog_op(name, "PUT", path, params=params,
                               extra={"body": body}, session=session,
                               mode_ctx=CTX, pack=_pack())
    with pytest.raises(admission.EvidenceHold):
        ex.prepare_plan_write(name, "PUT", path, params, body, session,
                              _pack())
    assert ("GET", "/api/v1/courses/101/assignments/900", None) in tab.calls
    assert tab.writes() == []
    assert not ex.journal_pending_ops()


def test_resolved_replacement_requires_destructive_confirmation(canvas):
    tab, session = canvas
    params = {"course_id": "101", "id": "900",
              "payload": {"assignment_overrides": []}}
    with pytest.raises(DestructiveConfirmationRequired):
        ex.dispatch_catalog_op(
            "canvas_edit_assignment", "PUT", ASSIGNMENT_PATH,
            params=params, extra={"body": {"assignment": "params.payload"}},
            session=session, mode_ctx=CTX, pack=_pack())
    assert tab.calls == []
    assert not ex.journal_pending_ops()


@pytest.mark.parametrize("reply", [
    "No", "not sure", "Maybe", "   ", True,
    "Please don't delete it", "Please don’t delete it",
    "I do not want this deleted", "Absolutely not",
])
def test_destructive_nonapproval_stops_before_a_provider_call(canvas, reply):
    tab, session = canvas
    with pytest.raises(DestructiveConfirmationRequired):
        ex.dispatch_catalog_op(
            "canvas_delete_module", "DELETE",
            "/api/v1/courses/{course_id}/modules/{id}",
            params={"course_id": "101", "id": "7"}, session=session,
            mode_ctx=dict(CTX, destructive_confirmed=reply), pack=_pack())
    assert tab.calls == []
    assert not ex.journal_pending_ops()


@pytest.mark.parametrize("reply", [
    "Yes, delete it", "Please delete it", "I do want this deleted",
    "Absolutely, yes. Delete it.",
])
def test_destructive_educator_confirmation_still_deletes(canvas, reply):
    tab, session = canvas
    result = ex.dispatch_catalog_op(
        "canvas_delete_module", "DELETE",
        "/api/v1/courses/{course_id}/modules/{id}",
        params={"course_id": "101", "id": "7"}, session=session,
        mode_ctx=dict(CTX, destructive_confirmed=reply), pack=_pack())
    assert result["outcome"] == "verified"
    assert [c[0] for c in tab.writes()] == ["DELETE"]


@pytest.mark.parametrize("quiz", [
    {"is_quiz_lti_assignment": True},
    {"submission_types": ["external_tool"], "external_tool_tag_attributes": {
        "url": "https://school.quiz-lti-iad-prod.instructure.com/lti/launch"}},
])
def test_assignment_delete_checks_the_live_new_quiz_type(canvas, quiz):
    tab, session = canvas
    tab.assignment.update(quiz)
    with pytest.raises(ex.NewQuizRefused):
        ex.dispatch_catalog_op(
            "canvas_delete_assignment", "DELETE", ASSIGNMENT_PATH,
            params={"course_id": "101", "id": "900"}, session=session,
            mode_ctx=dict(CTX, destructive_confirmed="Yes"), pack=_pack())
    with pytest.raises(ex.NewQuizRefused):
        ex.prepare_plan_write(
            "canvas_delete_assignment", "DELETE", ASSIGNMENT_PATH,
            {"course_id": "101", "id": "900"}, None, session, _pack())
    assert tab.writes() == []
    assert not ex.journal_pending_ops()


def test_assignment_delete_rechecks_type_after_preparation(canvas):
    tab, session = canvas
    prepared = ex.prepare_plan_write(
        "canvas_delete_assignment", "DELETE", ASSIGNMENT_PATH,
        {"course_id": "101", "id": "900"}, None, session, _pack())
    tab.assignment["is_quiz_lti_assignment"] = True
    with pytest.raises(ex.NewQuizRefused):
        ex.approve_plan_write(prepared["op_id"], "Yes", session, _pack())
    assert tab.writes() == []
    assert not ex.journal_pending_ops()


def test_assignment_delete_that_cannot_inspect_the_target_is_not_sent(canvas):
    tab, session = canvas
    tab.assignment = None
    with pytest.raises(ex.WriteNotAttempted):
        ex.dispatch_catalog_op(
            "canvas_delete_assignment", "DELETE", ASSIGNMENT_PATH,
            params={"course_id": "101", "id": "900"}, session=session,
            mode_ctx=dict(CTX, destructive_confirmed="Yes"), pack=_pack())
    assert tab.writes() == []
    assert not ex.journal_pending_ops()


def test_ordinary_assignment_delete_still_runs_the_plan_ceremony(canvas):
    tab, session = canvas
    prepared = ex.prepare_plan_write(
        "canvas_delete_assignment", "DELETE", ASSIGNMENT_PATH,
        {"course_id": "101", "id": "900"}, None, session, _pack())
    result = ex.approve_plan_write(prepared["op_id"], "Yes", session, _pack())
    assert result["outcome"] == "verified"
    assert [c[0] for c in tab.writes()] == ["DELETE"]


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
@pytest.mark.parametrize("replacement_response", [False, True])
def test_page_replacement_with_the_same_title_is_not_the_reviewed_page(
        canvas, method, replacement_response):
    tab, session = canvas
    prepared = ex.prepare_plan_write(
        "canvas_delete_page_courses" if method == "DELETE"
        else "canvas_update_create_page_courses", method, PAGE_PATH,
        {"course_id": "101", "url_or_id": "welcome"},
        None if method == "DELETE" else {"wiki_page": {"title": "New"}},
        session, _pack())
    tab.page = dict(tab.page, page_id=8)
    if replacement_response:
        tab.bound_page_response = tab.page
    with pytest.raises(ex.TargetIdentityMismatch):
        ex.approve_plan_write(prepared["op_id"], "Yes", session, _pack())
    assert tab.writes() == []
    assert not ex.journal_pending_ops()
    assert os.path.exists(ex.pending_write_path(prepared["op_id"]))


@pytest.mark.parametrize("locator", ["welcome", "7"])
def test_prepared_page_uses_the_exact_id_when_a_numeric_slug_exists(
        canvas, locator):
    tab, session = canvas
    tab.other_page = {"page_id": 8, "url": "7", "title": "Other Page"}
    prepared = ex.prepare_plan_write(
        "canvas_update_create_page_courses", "PUT", PAGE_PATH,
        {"course_id": "101", "url_or_id": locator},
        {"wiki_page": {"body": "Reviewed content"}}, session, _pack())
    with open(ex.pending_write_path(prepared["op_id"]), encoding="utf-8") as f:
        pending = json.load(f)
    expected_id = "7" if locator == "welcome" else "8"
    expected_path = "/api/v1/courses/101/pages/page_id:" + expected_id
    assert pending["descriptor"]["params"]["url_or_id"] == "page_id:" + expected_id
    assert pending["plan"]["params"] == pending["descriptor"]["params"]
    assert pending["plan"]["request"]["path"] == expected_path
    assert pending["approval"]["request"]["path"] == expected_path
    assert pending["plan"]["target_identity"]["object_id"] == expected_id
    assert pending["approval"]["target"]["object_id"] == expected_id
    result = ex.approve_plan_write(prepared["op_id"], "Yes", session, _pack())
    assert result["outcome"] == "verified"
    assert tab.writes() == [("PUT", expected_path,
                             {"wiki_page": {"body": "Reviewed content"}})]
    reviewed = tab.page if locator == "welcome" else tab.other_page
    other = tab.other_page if locator == "welcome" else tab.page
    assert reviewed["body"] == "Reviewed content"
    assert "body" not in other


@pytest.mark.parametrize("page_id", [None, True, "invalid"])
def test_page_without_an_authoritative_id_is_not_prepared(canvas, page_id):
    tab, session = canvas
    tab.page["page_id"] = page_id
    with pytest.raises(ex.TargetIdentityMismatch):
        ex.prepare_plan_write(
            "canvas_update_create_page_courses", "PUT", PAGE_PATH,
            {"course_id": "101", "url_or_id": "welcome"},
            {"wiki_page": {"title": "New"}}, session, _pack())
    assert tab.writes() == []
    assert not ex.journal_pending_ops()


def test_browser_completion_checks_the_resolved_body():
    entry = ex.catalog_descriptor_to_entry(
        "canvas_update_create_page_courses", "PUT", PAGE_PATH,
        extra={"body": {"wiki_page": "params.payload"}})
    params = {"course_id": "101", "url_or_id": "welcome",
              "payload": {"title": "New", "notify_of_update": True}}
    with pytest.raises(admission.NeverDispatch):
        bb._admission_hard_checks(entry, params, BASE)
    params["payload"]["notify_of_update"] = False
    bb._admission_hard_checks(entry, params, BASE)
