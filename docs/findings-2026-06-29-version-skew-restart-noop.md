# Findings & fixes — silent version skew + "Restart bridge" no-op (2026-06-29)

Status: **implemented, two independent `full-stack-engineer` reviews agree (no
must-fix), source committed.** A recompiled-binary release is still required for
users to receive the helper/bridge fixes (see §6).

This follows the 2026-06-28 relay-storm recurrence
(`rca-2026-06-28-relay-storm-recurrence-version-skew.md`), where a loaded
extension on v0.5.16 ran against an autostarted bridge stuck on a stale v0.5.14 —
"Connected" while every tool call failed. While verifying the new version-skew UI
on the live machine, two deeper defects surfaced that made the skew
*unrecoverable from the UI*. This documents both, the evidence, and the fixes.

---

## 1. Symptom

After running `npx agenthub-setup@latest --update --extension-id <id>`, the side
panel's new callout still showed:

> Versions don't match — browser 0.5.16, bridge 0.5.14, helper 0.5.10.

Pressing **Restart bridge** did nothing — the bridge stayed pid 73124 / v0.5.14.
The callout was telling the truth; the update and the restart genuinely had not
changed the running versions.

---

## 2. Root causes (both verified on the live machine)

### Bug A — helper version was a hardcoded constant that drifted

`packages/native-host-helper/src/version.ts` hardcoded `HELPER_VERSION =
'0.5.10'` while `package.json` was `0.5.16`. The bridge had the **same**
hand-maintained pattern (`packages/native-host/src/version.ts`,
`VERSION = '0.5.16'`) — someone remembered to bump the bridge but not the helper.
Both files were git-tracked and edited by hand, so the helper silently lagged
six patch versions. Reinstalling could never fix it: the released helper binary
*is* 0.5.10 because its source says so.

Evidence: `package.json` = 0.5.16; `version.ts` = 0.5.10; the on-disk
`agenthub-helper-win-x64.exe` reports `helperVersion:"0.5.10"` on every invoke in
`helper.log`.

### Bug B — "Restart bridge" never killed the incumbent

The restart chain — side panel `restart_service` →
`discovery.restartNativeHost()` → helper native message `restart_native_host` →
`startNativeHost({ skipAlreadyRunningCheck: true })` — had **no kill step
anywhere**. The helper just spawned a second bridge, which immediately lost the
bind race for port 7483 to the still-running old bridge and exited. The old
v0.5.14 process survived forever. The extension cannot use the bridge's graceful
`POST /api/restart` (that endpoint is CORS-restricted to the diag UI), so the
kill has to live in the helper.

Evidence: three "Restart bridge" presses produced helper
`restart_native_host → ok, spawnedPid 80304 / 1748 / 75948`; all three pids were
**dead** seconds later, while pid 73124 (StartTime unchanged) kept port 7483 and
the lock. New bridge binary (0.5.16) was already on disk, unused, because nothing
restarted onto it.

---

## 3. Code changes

### Fix A — version derives from `package.json` (nothing hardcoded)

`version.ts` is now a **generated** file in both packages, sourced from that
package's `package.json` `version`, and **git-ignored** so a stale value can
never be committed again.

- New `scripts/gen-version.mjs` in `packages/native-host-helper` and
  `packages/native-host`. Reads `package.json` `version`, writes `src/version.ts`
  with a "GENERATED — DO NOT EDIT" header. The bridge variant preserves the
  existing `BUILD_ID = process.env.BUILD_ID ?? 'dev'` line verbatim.
- Wired into npm lifecycle hooks so it regenerates before every consumer:
  `prebuild`, `prebundle`, `pretest` (bridge also `pretypecheck`). `compile:*`
  runs `npm run bundle` → fires `prebundle`, so released binaries always stamp the
  current version. CI (`release.yml`) invokes `npm run <compile-script> -w <pkg>`,
  which fires the hook — verified.
- `git rm --cached` both `version.ts`; added to root `.gitignore` (lines 27–28).
- `src/version.test.ts` in both packages asserts `VERSION/HELPER_VERSION ===
  package.json version` — a permanent drift detector that fails the build if the
  two ever disagree again.

### Fix B — `restart_native_host` kills the incumbent before spawning

- New `packages/native-host-helper/src/bridge-killer.ts`:
  `killIncumbentBridge(seams)` — reads the lock file → kills the incumbent pid
  (Windows `taskkill /F /T /PID`, POSIX `SIGKILL`; ESRCH/"not found" treated as
  already-dead) → polls `probePort` up to 3 s for the port to free → if still
  bound, **escalates** to an image-name kill (`taskkill /F /IM <basename>` /
  `pkill -f <basename>`) to reap bind-race zombies (the documented
  kill-by-port-leaves-siblings lesson) → waits again. A safety guard skips
  escalation if the resolved image name contains `-helper-`, so a future
  `getBinaryPath()` regression can never make the helper kill itself. All external
  I/O is injectable via `KillSeams` for deterministic tests.
- `src/index.ts` `restart_native_host` now `await killIncumbentBridge()` (wrapped
  in try/catch so a killer bug never blocks the spawn) before
  `startNativeHost(...)`. The response shape to the extension is unchanged.
- `src/bridge-killer.test.ts` — covers all inverse cases: incumbent alive→killed;
  no lock→cold spawn; pid already dead; port-busy→escalation; the helper image is
  never targeted (with a real, non-mocked `getBinaryPath()` assertion); kill
  failures non-fatal.

---

## 4. UI changes (shipped earlier this session — recap)

In `packages/extension/src/sidepanel/`:

- **Always-visible update command** (`diagnostics-panel.tsx`): the
  `npx agenthub-setup@latest --update --extension-id <id>` command with its copy
  button now renders in **every** state (connected, broken, unknown), not only on
  a failing step — unobtrusive when healthy, loud on skew. The single command
  block replaced the per-step fail-gated command.
- **Loud version-mismatch callout** (`diagnostics-panel.tsx` +
  `connection-verdict.ts`): a shared `detectVersionSkew({extension, bridge,
  helper})` flags a mismatch only when ≥2 *known* versions differ (unknowns
  ignored → no false positives). On skew, an accessible amber callout (icon ⚠ +
  text, polite live region, never color-alone) lists the three actual versions,
  using the design §4 copy. `buildUpdateCommand()` centralizes the command
  string. Tests in `connection-verdict.test.ts`.

Now that all four version sources derive from `package.json` and bump together on
release, the callout's three-way equality is correct rather than perpetually
tripping on a forgotten constant.

---

## 5. Verification

- `native-host-helper`: build clean, **46/46 tests pass** (incl. all six
  restart-kill inverse cases + version-drift detector).
- `native-host`: build + typecheck clean, **204/204 pass**; `node dist/index.js
  --version` → `0.5.16`; `BUILD_ID` env override still works.
- `extension`: **320/320 pass** (UI change intact).
- Regeneration proven: deleting both `version.ts` and rebuilding regenerates them
  at `0.5.16`.
- Two independent `full-stack-engineer` reviews: implementer + adversarial
  reviewer. Verdict: **AGREE, no must-fix**. Three non-blocking comment-clarity
  items (BUILD_ID-resolved-at-process-start wording; why POSIX uses `pkill -f`;
  the concurrent double-restart edge case) were applied.

---

## 6. Not covered / required follow-up

- **A recompiled-binary release is still required.** These are source-only
  changes. The live `agenthub-helper-win-x64.exe` / `agenthub-win-x64.exe` come
  from the last GitHub release; neither fix reaches users until `compile:*` is run
  and the new binaries are published to `irmasemma/agenthub-releases` and pulled
  by the installer. Per `CLAUDE.md`, native-host changes require a new release —
  **not done here** (not requested; outward-facing).
- **Immediate local unstick** (no release): `taskkill /F /PID <lock pid>` →
  autostart respawns the 0.5.16 binary already on disk → bridge → 0.5.16.
- **No E2E for the restart round-trip.** Unit tests cover the kill logic in
  isolation; the full kill→spawn→new-bridge-healthy path is not automated.
  `tests/e2e/chaos-connection.spec.ts` / `tests/smoke/smoke.mjs` should be
  extended to exercise `restart_native_host`.
- **Pre-existing gaps (not introduced here):** `startNativeHost` returns
  `{ ok: true }` even when the spawned bridge loses the bind race (caller can't
  tell); `BUILD_ID` is never inlined at compile time so released binaries report
  `buildId: 'dev'`. Both noted for a future pass.
- **Concurrent double-restart** (sub-second double-click + sub-3 s rebind) can
  briefly image-name-kill a freshly-spawned good bridge; self-heals on the next
  spawn. Documented in `bridge-killer.ts`, not guarded (a cross-process lock isn't
  worth it).
