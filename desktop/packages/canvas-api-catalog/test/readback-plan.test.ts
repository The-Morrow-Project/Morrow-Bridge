import { describe, expect, it } from "vitest";
import catalogJson from "../../../artifacts/canvas-api/canvas-api-catalog.json";
import { parseCanvasApiCatalog } from "../src/index.js";
import { evaluateBrowserReadback, planBrowserReadback } from "../src/readback-plan.js";

const catalog = parseCanvasApiCatalog(catalogJson);

function plan(toolName: string, args: Readonly<Record<string, unknown>>, response: unknown) {
  const write = catalog.operations.find((operation) => operation.toolName === toolName);
  expect(write).toBeDefined();
  const result = planBrowserReadback(catalog.operations, write, args, response);
  expect(result).not.toBeNull();
  return result!;
}

const rubricArguments = {
  course_id: "42",
  rubric_title: "Requested rubric",
  rubric_free_form_criterion_comments: true,
  rubric_criteria: {
    "10": { description: " Second criterion ", points: 4, ratings: { "0": { description: "Done", points: 4 } } },
    "2": {
      id: " criterion-a ", description: " First criterion ", long_description: " Description ",
      points: 5, criterion_use_range: false,
      ratings: { "0": { description: " Missing ", points: 0 }, "1": { description: " Complete ", points: 5 } },
    },
  },
  rubric_association_association_id: "888",
  rubric_association_association_type: "Assignment",
  rubric_association_purpose: "grading",
  rubric_association_use_for_grading: true,
  rubric_association_hide_score_total: false,
};

function savedRubric() {
  return {
    id: "77", title: "Requested rubric", free_form_criterion_comments: true,
    data: [
      {
        id: "criterion-a", description: "First criterion", long_description: "Description",
        points: 5, criterion_use_range: false,
        ratings: [
          { id: "77_1", criterion_id: "criterion-a", description: "Complete", long_description: "", points: 5 },
          { id: "77_2", criterion_id: "criterion-a", description: "Missing", long_description: "", points: 0 },
        ],
      },
      { id: "77_3", description: "Second criterion", long_description: "", points: 4, ratings: [{ id: "77_4", description: "Done", points: 4 }] },
    ],
    associations: [{ id: "99", rubric_id: "77", association_id: "888", association_type: "Assignment", purpose: "grading", use_for_grading: true, hide_score_total: false }],
  };
}

function rubricResponse(saved = savedRubric()) {
  // The join record comes first so it cannot accidentally supply the rubric's locator.
  return { rubric_association: saved.associations[0], rubric: saved };
}

describe("rubric creation readback", () => {
  it.each([
    { rubric_association: { id: "99", rubric_id: "77" } },
    { rubric: null, rubric_association: { id: "99", rubric_id: "77" } },
    { rubric: { ratings: [{ id: "99" }] }, rubric_association: { id: "99", rubric_id: "77" } },
    { rubric: { id: null }, rubric_association: { id: "99", rubric_id: "77" } },
  ])("requires the returned rubric's own id before choosing a readback target", (response) => {
    const write = catalog.operations.find((operation) => operation.toolName === "canvas_create_single_rubric");
    expect(planBrowserReadback(catalog.operations, write, { course_id: "42", id: "55", rubric_title: "Requested rubric" }, response)).toBeNull();
  });

  it("checks the approved fields after indexed criteria and ratings are normalized", () => {
    const readback = plan("canvas_create_single_rubric", rubricArguments, rubricResponse());
    expect(readback.arguments).toEqual({ course_id: "42", id: "77", include: ["associations"] });
    expect(readback.targetId).toBe("77");
    expect(evaluateBrowserReadback(readback, { ok: true, data: savedRubric() }).status).toBe("verified");
  });

  it.each(["title", "criterion", "rating", "comments", "association", "association flag"])(
    "refuses unexpected %s values even when POST and GET agree",
    (field) => {
      const saved = savedRubric();
      if (field === "title") saved.title = "Different rubric";
      if (field === "criterion") saved.data[0]!.description = "Different criterion";
      if (field === "rating") saved.data[0]!.ratings[0]!.points = 1;
      if (field === "comments") saved.free_form_criterion_comments = false;
      if (field === "association") saved.associations[0]!.association_id = "999";
      if (field === "association flag") saved.associations[0]!.use_for_grading = false;
      const readback = plan("canvas_create_single_rubric", rubricArguments, rubricResponse(saved));
      expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
    },
  );

  it("requires the association's fields on one exact join record", () => {
    const saved = savedRubric();
    saved.associations.push({ ...saved.associations[0]!, id: "100", association_id: "999" });
    const readback = plan("canvas_create_single_rubric", rubricArguments, rubricResponse(saved));
    saved.associations[0]!.use_for_grading = false;
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
  });

  it("does not confirm a missing or ambiguous join record", () => {
    const readback = plan("canvas_create_single_rubric", rubricArguments, rubricResponse());
    const saved = savedRubric();
    expect(evaluateBrowserReadback(readback, { ok: true, data: { ...saved, associations: [] } }).status).toBe("mismatch");
    expect(evaluateBrowserReadback(readback, { ok: true, data: { ...saved, associations: undefined } }).status).toBe("unconfirmed");
    saved.associations.push({ ...saved.associations[0]!, use_for_grading: false });
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).not.toBe("verified");
  });

  it("does not discard criterion inputs that cannot be normalized", () => {
    const readback = plan("canvas_create_single_rubric", {
      course_id: "42", rubric_title: "Requested rubric", rubric_criteria: { "0": "invalid criterion" },
    }, rubricResponse());
    expect(evaluateBrowserReadback(readback, { ok: true, data: savedRubric() }).status).toBe("unconfirmed");
  });

  it("uses rating-derived points, numeric strings and provider boolean rules", () => {
    const args = {
      course_id: "42", rubric_title: "Requested rubric",
      rubric_criteria: { "0": {
        description: "Criterion", points: 90, criterion_use_range: "1", generated: "true",
        ratings: { "0": { description: " Z ", points: "5" }, "1": { description: " A ", points: 5 }, "2": { description: "Missing" } },
      } },
    };
    const saved = {
      id: "77", title: "Requested rubric", data: [{
        id: "77_1", description: "Criterion", points: 5, criterion_use_range: false, generated: true,
        ratings: [{ id: "77_2", description: "A", points: 5 }, { id: "77_3", description: "Z", points: 5 }, { id: "77_4", description: "Missing", points: 0 }],
      }],
    };
    const readback = plan("canvas_create_single_rubric", args, { rubric: saved });
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
    const changed = structuredClone(saved);
    changed.data[0]!.ratings[0]!.description = "B";
    expect(evaluateBrowserReadback(plan("canvas_create_single_rubric", args, { rubric: changed }), { ok: true, data: changed }).status).toBe("mismatch");
  });

  it("checks a supplied join id and retains fields when its POST join is absent", () => {
    const args = { course_id: "42", rubric_title: "Requested rubric", rubric_association_id: "99", rubric_association_use_for_grading: true };
    const saved = savedRubric();
    const readback = plan("canvas_create_single_rubric", args, { rubric: saved });
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
    saved.associations[0]!.id = "100";
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
  });

  it.each(["title", "criterion description", "rating description"])("compares date-looking %s as literal text", (field) => {
    const args = structuredClone(rubricArguments);
    const saved = savedRubric();
    if (field === "title") { args.rubric_title = "2026-01-01"; saved.title = "2026-01-01T00:00:00Z"; }
    if (field === "criterion description") { args.rubric_criteria["2"].description = "2026-01-01"; saved.data[0]!.description = "2026-01-01T00:00:00Z"; }
    if (field === "rating description") { args.rubric_criteria["2"].ratings["1"].description = "2026-01-01"; saved.data[0]!.ratings[0]!.description = "2026-01-01T00:00:00Z"; }
    const readback = plan("canvas_create_single_rubric", args, rubricResponse(saved));
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
    if (field === "title") saved.title = "2026-01-01";
    if (field === "criterion description") saved.data[0]!.description = "2026-01-01";
    if (field === "rating description") saved.data[0]!.ratings[0]!.description = "2026-01-01";
    expect(evaluateBrowserReadback(plan("canvas_create_single_rubric", args, rubricResponse(saved)), { ok: true, data: saved }).status).toBe("verified");
  });
});

const schemeArguments = {
  course_id: "42", title: "Scheme", grading_scheme_entry_name: [" F ", " A "], grading_scheme_entry_value: [0, 90],
};

function savedScheme() {
  return { id: "77", title: "Scheme", grading_scheme: [{ name: "A", value: 0.9, calculated_value: 90 }, { name: "F", value: 0, calculated_value: 0 }] };
}

describe("grading standard creation readback", () => {
  it.each(["title", "name"])("compares date-looking %s as literal text", (field) => {
    const args = structuredClone(schemeArguments);
    const saved = savedScheme();
    if (field === "title") { args.title = "2026-01-01"; saved.title = "2026-01-01T00:00:00Z"; }
    if (field === "name") { args.grading_scheme_entry_name[1] = "2026-01-01"; saved.grading_scheme[0]!.name = "2026-01-01T00:00:00Z"; }
    const readback = plan("canvas_create_new_grading_standard_courses", args, saved);
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
    if (field === "title") saved.title = "2026-01-01";
    if (field === "name") saved.grading_scheme[0]!.name = "2026-01-01";
    expect(evaluateBrowserReadback(plan("canvas_create_new_grading_standard_courses", args, saved), { ok: true, data: saved }).status).toBe("verified");
  });

  it("checks the approved names and percentage thresholds after scaling, ordering and trimming", () => {
    const readback = plan("canvas_create_new_grading_standard_courses", schemeArguments, savedScheme());
    expect(evaluateBrowserReadback(readback, { ok: true, data: savedScheme() }).status).toBe("verified");
  });

  it.each(["threshold", "name", "title"])("refuses unexpected %s values even when POST and GET agree", (field) => {
    const saved = savedScheme();
    if (field === "threshold") saved.grading_scheme[0]!.value = 0.8;
    if (field === "name") saved.grading_scheme[0]!.name = "B";
    if (field === "title") saved.title = "Different scheme";
    const readback = plan("canvas_create_new_grading_standard_courses", schemeArguments, saved);
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
  });

  it("uses the approved points scale and the provider's four decimal precision", () => {
    const args = { ...schemeArguments, points_based: true, scaling_factor: 60, grading_scheme_entry_value: [0, 50] };
    const saved = { ...savedScheme(), points_based: true, scaling_factor: 60, grading_scheme: [{ name: "A", value: 0.8333 }, { name: "F", value: 0 }] };
    const readback = plan("canvas_create_new_grading_standard_courses", args, saved);
    expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
    const unexpected = { ...saved, grading_scheme: [{ name: "A", value: 0.8 }, { name: "F", value: 0 }] };
    expect(evaluateBrowserReadback(plan("canvas_create_new_grading_standard_courses", args, unexpected), { ok: true, data: unexpected }).status).toBe("mismatch");
  });

  it("does not silently truncate unequal approved name and threshold lists", () => {
    const args = { ...schemeArguments, grading_scheme_entry_value: [0] };
    const readback = plan("canvas_create_new_grading_standard_courses", args, savedScheme());
    expect(evaluateBrowserReadback(readback, { ok: true, data: savedScheme() }).status).toBe("unconfirmed");
  });

  it("handles one entry and the default points scale without losing the approved values", () => {
    for (const args of [
      { course_id: "42", title: "Scheme", grading_scheme_entry_name: [" F "], grading_scheme_entry_value: [0] },
      { ...schemeArguments, points_based: true, grading_scheme_entry_value: [0, 1] },
    ]) {
      const saved = { id: "77", title: "Scheme", ...("points_based" in args ? { points_based: true } : {}), grading_scheme: "points_based" in args ? [{ name: "A", value: 1 }, { name: "F", value: 0 }] : [{ name: "F", value: 0 }] };
      const readback = plan("canvas_create_new_grading_standard_courses", args, saved);
      expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
      saved.grading_scheme[0]!.name = "Changed";
      expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
    }
  });
});

it("retains instant equivalence for actual timestamp fields", () => {
  const readback = plan("canvas_edit_assignment", {
    course_id: "42", id: "88", assignment_due_at: "2026-01-01T00:00:00Z",
  }, { id: "88" });
  expect(evaluateBrowserReadback(readback, { ok: true, data: { id: "88", due_at: "2025-12-31T18:00:00-06:00" } }).status).toBe("verified");
});

it.each(["assignment_name", "assignment_description"])("compares generic %s as literal text", (inputName) => {
  const args = { course_id: "42", id: "88", [inputName]: "2026-01-01" };
  const field = inputName === "assignment_name" ? "name" : "description";
  const saved = { id: "88", [field]: "2026-01-01T00:00:00Z" };
  const readback = plan("canvas_edit_assignment", args, saved);
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
  saved[field] = "2026-01-01";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
});

it.each(["due_at", "lock_at", "unlock_at"])("retains instant equivalence for nested peer review %s", (field) => {
  const readback = plan("canvas_edit_assignment", {
    course_id: "42", id: "88", [`assignment_peer_review_${field}`]: "2026-01-01T00:00:00Z",
  }, { id: "88" });
  const saved = { id: "88", peer_review: { [field]: "2025-12-31T18:00:00-06:00" } };
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
  saved.peer_review[field] = "2026-01-01T01:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
});

it("compares nested override timestamps as instants and their titles as literal text", () => {
  const readback = plan("canvas_edit_assignment", {
    course_id: "42", id: "88", assignment_assignment_overrides: [{
      id: "99", title: "2026-01-01", due_at: "2026-01-01T00:00:00Z", lock_at: "2026-01-02T00:00:00Z", unlock_at: "2025-12-31T00:00:00Z",
    }],
  }, { id: "88" });
  const saved = { id: "88", assignment_overrides: [{
    id: "99", title: "2026-01-01", due_at: "2025-12-31T18:00:00-06:00", lock_at: "2026-01-01T18:00:00-06:00", unlock_at: "2025-12-30T18:00:00-06:00",
  }] };
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
  saved.assignment_overrides[0]!.title = "2026-01-01T00:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
  saved.assignment_overrides[0]!.title = "2026-01-01";
  saved.assignment_overrides[0]!.due_at = "2026-01-01T01:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
});

it("compares nested peer review override timestamps as instants and their titles as literal text", () => {
  const readback = plan("canvas_edit_assignment", {
    course_id: "42", id: "88", assignment_peer_review_peer_review_overrides: [{
      id: "99", title: "2026-01-01", due_at: "2026-01-01T00:00:00Z", lock_at: "2026-01-02T00:00:00Z", unlock_at: "2025-12-31T00:00:00Z",
    }],
  }, { id: "88" });
  const saved = { id: "88", peer_review: { peer_review_overrides: [{
    id: "99", title: "2026-01-01", due_at: "2025-12-31T18:00:00-06:00", lock_at: "2026-01-01T18:00:00-06:00", unlock_at: "2025-12-30T18:00:00-06:00",
  }] } };
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
  saved.peer_review.peer_review_overrides[0]!.title = "2026-01-01T00:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
  saved.peer_review.peer_review_overrides[0]!.title = "2026-01-01";
  saved.peer_review.peer_review_overrides[0]!.due_at = "2026-01-01T01:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
});

it.each(["peer_review", "peer_review_peer_review_overrides"])("retains nested date_details instant equivalence for %s", (inputName) => {
  const overrides = [{ id: "99", due_at: "2026-01-01T00:00:00Z", lock_at: "2026-01-02T00:00:00Z", unlock_at: "2025-12-31T00:00:00Z" }];
  const readback = plan("canvas_update_learning_object_s_date_information_assignments", {
    course_id: "42", assignment_id: "88", [inputName]: inputName === "peer_review"
      ? { due_at: "2026-01-01T00:00:00Z", peer_review_overrides: overrides }
      : overrides,
  }, { id: "88" });
  const saved = { peer_review: { due_at: "2025-12-31T18:00:00-06:00", peer_review_overrides: [{
    id: "99", due_at: "2025-12-31T18:00:00-06:00", lock_at: "2026-01-01T18:00:00-06:00", unlock_at: "2025-12-30T18:00:00-06:00",
  }] } };
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
  saved.peer_review.peer_review_overrides[0]!.due_at = "2026-01-01T01:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
});

it.each([
  "hide_item_response_correctness_at", "hide_item_responses_at", "show_item_response_correctness_at", "show_item_responses_at",
])("retains instant equivalence for nested New Quiz %s", (field) => {
  const readback = plan("canvas_update_single_quiz", {
    course_id: "42", assignment_id: "88", [`quiz_quiz_settings_result_view_settings_${field}`]: "2026-01-01T00:00:00Z",
  }, { id: "88" });
  const saved = { id: "88", quiz_settings: { result_view_settings: { [field]: "2025-12-31T18:00:00-06:00" } } };
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
  saved.quiz_settings.result_view_settings[field] = "2026-01-01T01:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
});

it.each(["start_date", "end_date"])("retains instant equivalence for grading period %s", (field) => {
  const readback = plan("canvas_update_single_grading_period", {
    course_id: "42", id: "88", [`grading_periods_${field}`]: ["2026-01-01T00:00:00Z"],
  }, { id: "88" });
  const saved = { id: "88", [field]: "2025-12-31T18:00:00-06:00" };
  expect(evaluateBrowserReadback(readback, { ok: true, data: { grading_periods: [saved] } }).status).toBe("verified");
  saved[field] = "2026-01-01T01:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: { grading_periods: [saved] } }).status).toBe("mismatch");
});

it.each(["start_date", "end_date"])("compares blackout %s as a calendar date", (field) => {
  const readback = plan("canvas_update_blackout_date_courses", {
    course_id: "42", id: "88", [field]: "2026-01-01",
  }, { id: "88" });
  const saved = { id: "88", [field]: "2026-01-01T00:00:00Z" };
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
  saved[field] = "2026-01-01";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
});

it.each(["canvas_create_module", "canvas_update_module"])("retains module unlock_at instant equivalence for %s", (toolName) => {
  const readback = plan(toolName, {
    course_id: "42", ...(toolName === "canvas_update_module" ? { id: "88" } : {}), module_name: "Module", module_unlock_at: "2026-01-01T00:00:00Z",
  }, { id: "88" });
  const saved = { id: "88", name: "Module", unlock_at: "2025-12-31T18:00:00-06:00" };
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("verified");
  saved.unlock_at = "2026-01-01T01:00:00Z";
  expect(evaluateBrowserReadback(readback, { ok: true, data: saved }).status).toBe("mismatch");
});
