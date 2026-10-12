# Morrow

You should not have to wait for your institution to buy and roll out a separate course assistant.

Morrow connects the AI assistant you already use to your Canvas and Moodle courses, so you can build and review real course work: plan courses and create approved lessons, activities, discussions, assignments, and modules; build, review, and improve New Quizzes and Item Banks down to each question and setting; check course items for accessibility problems and fix them, map curriculum, and prepare accreditation evidence. After each approved change, Morrow checks what your course site saved.

Selected Canvas tasks have been checked on live test courses. Moodle is an early development version and needs live testing. Blackboard is not shipped. Working with several connected courses at once has not been tested on live courses yet.

Morrow is and always will be free and open source.

## The products

This is a monorepo. Each product lives in its own directory, ships on its own version line, and has its own local check suite.

| Product | Directory | What it is |
|---|---|---|
| Morrow Bridge for Mac and Windows | `desktop/` | The app, plus the Bridge browser extension. Chrome shows the extension as Morrow Bridge Extension. Download it for a Mac with Apple silicon and macOS 13 or later, or for Windows 10 or Windows 11, connect the ChatGPT desktop app, Claude Desktop, Claude Code, or Gemini CLI, and work with the courses your account can open. So far, only OpenAI's Codex CLI, which uses Morrow's ChatGPT setup, has been checked on a live Canvas test course. The ChatGPT desktop app, Claude Desktop, Claude Code, and Gemini CLI setups have passed Morrow's own tests only. Start at [`desktop/README.md`](desktop/README.md). |
| Morrow for Muse | `morrow-for-muse/` | The connector that runs on your Muse computer. Canvas uses the educator's browser sign-in and governed action catalog. Moodle runs through installed Chromium with pinned adapters, but native first-use, production admission, and live provider proof remain required. See [`morrow-for-muse/SCOPE.md`](morrow-for-muse/SCOPE.md). Start at [`morrow-for-muse/SKILL.md`](morrow-for-muse/SKILL.md). |

## How Morrow works, in every product

**Pair once. Ask. Review.** Pair each Canvas or Moodle account once in Morrow Bridge. Choose Selected courses for an explicit course scope, or Account access to work across available courses without selecting each course in the Bridge browser extension. Neither mode limits the number of courses. Give your assistant course names, course IDs, or course links, ask for the work, and review the result. Morrow checks each approved change against the course and tells you when something still needs attention.

**Plan first.** Morrow starts each course in Plan, so you review proposed changes before they are saved. Edit lets your assistant save changes without asking each time: in Morrow Bridge you grant it per course and per type of change, and in Morrow for Muse you turn it on for your account or for one conversation. After each approved change, Morrow checks what the LMS saved, and your assistant tells you what happened.

**Your sign-in stays yours.** Morrow does not store your school password, and your assistant never receives your password, cookies, or other sign-in details. In Morrow Bridge, your Canvas or Moodle sign-in stays in Chrome, and the Bridge browser extension uses it there. Moodle is an early development version and needs live testing. Blackboard is not shipped. In Morrow for Muse, Canvas sign-in stays in a private browser on your Muse computer. Moodle authentication stays in the VM's installed Chromium; native first-use and provider qualification remain required before release.

**Student privacy is built into each connection.** Morrow Bridge and the Canvas lane for Muse replace known student identifiers with course-specific labels before course records reach the assistant. Muse's Moodle analytics use approved course-level aggregates instead of individual student records. Each product documents the limits of its privacy protections: see the [Morrow Bridge limits](desktop/LIMITATIONS.md#learner-privacy) and the [Morrow for Muse privacy limits](morrow-for-muse/privacy/FERPA_POLICY.md#known-limitations-honest-scope).

**Start with the course access you already have.** Morrow gives educators direct tools for the courses they already manage. It never gives anyone new access.

## Repository layout

- `desktop/`: Morrow Bridge for Mac and Windows. The app, the Bridge browser extension, the MCP server, the installer, and product docs.
- `morrow-for-muse/`: Morrow for Muse. The connector, Morrow Direct, the dispatch engine, the privacy boundary, and the proof battery.
- `docs/`: family-level docs, the [product overview](docs/products.md) and [versioning](docs/versioning.md).
- `desktop/.githooks/`: local commit checks. GitHub Actions run repository and product checks on pull requests and `main`. The native installer QA workflow checks exact Mac and Windows packages. The pre-commit hook runs repository text gates and the affected product's local checks for staged changes.

Install the pre-commit hook once from the repository root: `git config core.hooksPath desktop/.githooks`. A change to `desktop/` runs `pnpm check`; a change to `morrow-for-muse/` runs its Python tests, development suites, and carved-package install suites. The hook runs both product suites for shared files that both products use. Release and versioning details are in [`docs/versioning.md`](docs/versioning.md).

## Versioning

Each product versions and tags independently:

- `desktop/vX.Y.Z` for Morrow Bridge for Mac and Windows
- `muse/vX.Y.Z` for Morrow for Muse

See [`docs/versioning.md`](docs/versioning.md).

## Security

To report a security problem, use GitHub private vulnerability reporting. Open the Security tab, then select Report a vulnerability. You can also email [info@morrowproject.org](mailto:info@morrowproject.org). Do not open a public issue for it. See [`SECURITY.md`](SECURITY.md).

## License

MIT. See [`LICENSE`](LICENSE).
