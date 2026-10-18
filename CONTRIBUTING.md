# Contributing

Thanks for your interest in Image Rows and Wraps.

Bug reports, ideas and pull requests are welcome. For anything larger than a
small or obvious fix, please open an issue first so we can discuss the problem
and agree on the approach.

## Getting started

Requirements:

- Node.js 24, starting at 24.19.0 (`>=24.19.0 <25`), for development, builds
  and tests. The minimum comes from the native `getTestContext()` API used by
  the test collector. Plugin users do not need to install Node.js; they need
  only the Obsidian version in `manifest.json`.
- npm

Fork the repository, create a branch for your change, then install the
dependencies:

```sh
npm ci
```

`npm test` and the browser tests need Playwright's Chromium. Install it once,
after `npm ci` and again whenever the Playwright version in the lockfile
changes:

```sh
npx playwright install --with-deps chromium
```

`npx` uses the Playwright version installed from the lockfile, so the browser
matches it; `--with-deps` also installs the system libraries Chromium needs on
Linux, which may ask for administrator rights.

Useful checks:

```sh
npm run build
npm run check:latest
npm run lint
npm run lint:css
npm test
```

- `npm run build` type-checks against the project's pinned Obsidian API
  baseline, currently 1.13.0, a subset of the API of the minimum supported
  Obsidian version (`minAppVersion` in `manifest.json`, currently 1.13.4): a
  conservative compatibility check. Then it builds `main.js`.
- `npm run check:latest` type-checks against the project's pinned latest-API
  compatibility dependency. `npm ci` installs the version in the lockfile.
- `npm run lint` runs the Obsidian-specific lint checks.
- `npm run lint:css` checks `styles.css` with Obsidian's official Stylelint
  configuration (`stylelint-config-obsidianmd`, in `.stylelintrc.json`), with
  its browser target set to the Electron version of the minimum supported
  Obsidian version (Electron 43 for 1.13.4). Errors fail the check; warnings
  do not, but they are problems to read, not a clean result. Rules are not
  disabled and problems are not hidden with `stylelint-disable` comments.
- `npm test` type-checks the tests (`tsc -p tsconfig.tests.json`), then runs
  the Node test suite; if the type check fails, the suite does not start.
  One regression of the console collector drives a real Chromium page:
  without the browser installed it fails, it is not skipped.
  Warnings and errors the code under test writes to the console are kept in
  the local registry; they do not change the outcome. Test APIs remain native,
  including subtests, hooks and callback tests. On Node 24.19 or later, the
  collector reads `getTestContext()` and its abort signal, without subscribing
  to tracing or adapting test functions. On the verified runtime 24.21.0,
  subtests and late calls after timeout/cancellation retain their own context.
  Availability after completion is not guaranteed for every resource/runtime.
  Root hooks, a user test named `<root>`, and unusable contexts mark
  attribution as unavailable. An absent context never borrows
  another running test; no running-test list is inferred. Names are not unique
  identifiers.
  Native declaration coordinates are preserved; bundled test events may still
  point at the temporary bundle because Node does not necessarily map them.
  Console source locations come from mapped stack frames in `src/` and
  `tests/`, including when the suite runs as a temporary bundle. Collection
  internals are excluded; insufficient evidence keeps the source uncertain.
  The native console alone inspects the original objects; journal text uses
  placeholders for objects/functions with `representation: "prudent"`, so it
  can differ from terminal output without invoking custom inspection, coercion
  or serialization again. Primitive bigints are also represented prudently
  as strings with an `n` suffix, avoiding a custom prototype toJSON via `%j`.
  Collection stays active through final native hooks,
  then closes after the reporter stream. Early exits cannot attest coverage.
  `closed`, `transferComplete` and `coverageComplete` are distinct; known
  wrapper gaps remain incomplete even after restoration. Identity checks at
  calls, every 50 ms and at shutdown do not prove continuity between samples.
  Standalone collection without a reporter in the same process retains an
  incomplete journal. Incomplete finalization revokes its own prior cleanup markers; foreign markers
  are retained and prevent completion. Cleanup also requires
  the same run’s terminal to attest both transfer and coverage. An unremovable
  marker does not authorize deleting incomplete input.
  Native runtime diagnostics retain their message and payload, including late
  asynchronous failure reasons; test/location fields are used only when
  supplied structurally, never guessed from prose. They are not test results
  or console warnings. Console calls are transferred incrementally; interrupted runs retain their
  available journal and run identity beside the registry. Recovery is explicit:
  `IW_REGISTRO=<original registry> node tests/registro-console-node.mjs <console.jsonl>` after owner and writers stop.
  Recovery validates journal, sidecar and the original registry binding; uncertain
  or legacy unbound material is retained. A per-journal lock refuses concurrent
  recovery and reclaims stale ownership only when its local PID is absent, never
  on age alone. Replay and restart transfer only missing sequences. Cleanup uses
  the same lock and verifies marker identity, journal bytes and native collection
  attestations; foreign files and stale lock residues prevent deletion.
  Partial input and failed transfers remain marked incomplete. SIGKILL and
  system shutdown cannot guarantee persistence or cleanup. Native nested outcomes
  retain hierarchy, reasons and declaration coordinates; suites are recorded
  separately from tests. Totals retain Node's distinction between tests, suites,
  failures, cancellations, skip and todo. Test APIs and exit codes stay native.

`main.js` is generated by the build and must not be committed.

## Testing

Run the tests that are relevant to your change.

```sh
npm test
npm run test:browser
npm run test:rows
npm run test:obsidian
```

Use:

- **Node tests** for Markdown parsing, edits, commands, settings and other logic
  that does not need the real editor UI.
- **Browser tests** for CodeMirror, Live Preview, DOM behaviour, drag and other
  interactions.
- **Row tests** for image-row geometry and related layout behaviour.
- **Obsidian tests** for changes that depend on the real desktop application,
  especially changes under `src/rendering/`.

Changes to rendering should pass the real Obsidian test suite whenever
possible.

The Node and browser tests need Playwright's Chromium, installed as described
in the setup above:

```sh
npx playwright install --with-deps chromium
```

### Real Obsidian test suite

`npm run test:obsidian` runs locally against the real Obsidian application.
The automated bench currently supports Linux. Download an official Linux
distribution of Obsidian and extract it so that its executable is at:

```text
.obsidian-test/obsidian-<version>/obsidian
```

The directory name must contain only numeric version components, for example
`obsidian-1.14.4`. When several versions are installed, the suite selects the
newest by version number. To select one explicitly, for example the minimum
supported version (`minAppVersion`), run:

```sh
IW_OBSIDIAN_VERSIONE=1.13.4 npm run test:obsidian
```

The command stops if the requested version is not installed. This suite does
not run in the public CI; contributors without the Linux bench can still test
the production build manually in a test vault as described below.

Before the suite, `tests/banco-errori.mjs` checks the bench itself: it provokes
errors on purpose, in the main window and in a separate one, and verifies that
every observation reaches the bench through its channel. Thrown Error objects,
strings, objects and primitive values, reportError(), and repeated exceptions
with the same message are included. No occurrence is merged by message or
excluded because it carries a thrown value: one exception may produce both a
pageerror and a window-error record, identified by channel and by the window's
number. In every window of the app, the main one and any other, the bench
collects console errors and warnings and uncaught exceptions (`pageerror`); in
the main window and in the separate windows of the workspace it also listens to
the `error` and `unhandledrejection` events: some errors, such as a
ResizeObserver loop, reach only the `error` event. The original console message,
including all lines provided by Playwright, is kept in `text`;
`attributionStack` contains the separate evidence used to classify its source.
The collector does not shorten the message; it cannot recover text omitted
by the runtime before the console event reaches it. Console messages and
rejected promises in a separate window, windows opened during the check, a
reload of the main window and the removal of the listeners are part of the
check.

The check is started by `node tests/banco-errori-avvio.mjs`, which sets its
environment before it starts and ends with its exit code or signal: if the
check fails or is interrupted, the suite does not start. It has an
environment of its own under `.obsidian-test/banco-errori/`, so the provoked
errors never mix with those of the plugin's scenarios:

- `ambiente/`: its own vault, Obsidian profile and source map, recreated when
  the check starts and kept until its next run;
- `registro/`: its own registry, where every run keeps its results and end;
- `fallimenti/`: a screenshot of each failed test, never overwritten.

Only the Obsidian builds in `.obsidian-test/` are shared with the suite, and
only read. Started on its own, or pointed at the project's registry, the
check stops before opening Obsidian or writing anything. To read its results:

```sh
IW_REGISTRO=.obsidian-test/banco-errori/registro npm run registro
```

### Diagnostic report

Build, compatibility checks, lint and the test suites write diagnostic
information to a local registry under `.obsidian-test/`, which is ignored by
Git.

To inspect the current state:

```sh
npm run registro
```

For additional history:

```sh
npm run registro -- --storia
```

You can also narrow the report to a test:

```sh
npm run registro -- --test "test name"
npm run registro -- --test "test name" --storia
```

`--test` filters only what the report displays. It does not run tests and does
not change the scope of any recorded run.

A filtered test run only verifies the tests that actually ran. It does not
count as a complete run of the whole suite.

Likewise, a run that was interrupted or did not finish is never considered a
successful complete verification.

New console errors must be investigated. New warnings should also be examined
rather than simply filtered out.

## Testing in Obsidian

To try a production build manually, copy:

- `main.js`
- `manifest.json`
- `styles.css`

into:

```text
<vault>/.obsidian/plugins/image-rows-and-wraps/
```

Then reload Obsidian and enable the plugin.

Use a test vault rather than a vault containing notes you care about.

## Code structure

The main public source areas are:

- `src/main.ts` — plugin lifecycle
- `src/markdown/` — Markdown parsing and editing logic
- `src/rendering/` — Live Preview, Reading view and PDF rendering
- `src/ui/` — settings, menus and dialogs
- `src/i18n/` — Italian and English interface strings
- `styles.css` — plugin styles

Keep changes focused and avoid unrelated refactoring in the same pull request.

### Conventions

- Code and comments are written in English.
- User-facing text must be added to both `src/i18n/it.ts` and
  `src/i18n/en.ts`, using the same keys.
- Read translated text through `t()` when it is displayed, not at module
  import time.
- The plugin ID and command IDs are stable and must not be renamed.
- Notes must be edited through the editor using one transaction per user
  action, so one Undo reverts the action.
- Use public Obsidian APIs.
- Resources that require cleanup must be registered with the plugin using the
  appropriate Obsidian lifecycle helpers.
- Do not add generated files, local test data, editor settings, temporary
  files or credentials.

## Pull requests

Before opening a pull request:

1. keep the change focused on one problem or feature;
2. run the relevant tests;
3. run `npm run build`, `npm run check:latest`, `npm run lint` and `npm run lint:css`;
4. make sure no generated or unrelated files are included;
5. describe what changed and how it was tested.

In the pull request, please include:

- the problem being solved;
- a short description of the solution;
- how the change can be verified;
- the tests you ran;
- the related issue, if there is one.

The public CI runs the build, the compatibility check, lint, the CSS check,
Node tests (after installing Chromium), and the browser and row tests
according to its current matrix. The real
`test:obsidian` suite remains an additional local check. Some additional
integration checks may also be performed before a contribution is accepted.

Accepted pull requests are integrated through the maintainer's development
workflow and then squash-merged, so the commits may not be preserved exactly
as they were submitted. Your credit is always preserved. When the final
solution needs a substantial rewrite, the pull request may instead be closed
without merging, with an explanation and a link to the change that includes
your contribution, credited to you as co-author.

For changes that substantially affect behaviour, architecture, dependencies,
build configuration or repository-wide tooling, please open an issue before
starting the implementation.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
