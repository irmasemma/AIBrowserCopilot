# RCA — Allowlist leak + 6 install-dir copies + Linux test isolation

**Date:** 2026-06-23
**Severity:** Medium (developer-state contamination + Linux test failures, no customer impact)
**Status:** All fixes shipped on `multi-client-architecture` (commits `ec9f1fb`, `4c10e30`, `0aaece6`).

Two unrelated symptoms surfaced during a Linux soak-readiness review and turned
out to share a single root pattern: **state-related code was duplicated, drifted
between copies, and the test harness wasn't strong enough to keep development
state clean.** Documented together because the same cleanup retires all of them.

---

## Symptom 1 — live bridge silently rejected the developer's real extension

Side panel showed "Disconnected." A direct WS probe to the live bridge from the
real extension's origin returned **HTTP 401** before the WS handshake. Bridge
logs showed **19 rejections in the current generation, zero successful
real-browser connections in any of the 5 rotated log files** — only `helper-probe`
ever connected. Every other diagnostic was green.

### Root cause

`%LOCALAPPDATA%\agenthub\extension-ids.json` contained `["myext123"]`, a value
that only appears in **test code** (`packages/installer/src/ui/app.test.tsx`).
The bridge's allowlist logic treats a non-empty file as strict-mode: only IDs
in the file are accepted, everything else is 401-rejected. The real extension's
machine-derived ID (`godmaogbmafekfmonphpolmgkdhopcll`) was not in the file.

The test file's preamble (lines 19–23) literally warned about this:

> "MUST roll back so the suite never clobbers a developer's live
> `extension-ids.json` … a stale value silently 401-rejects the real extension.
> Snapshot before, restore after."

The snapshot/restore guard existed — but only via vitest's `afterAll`. Anything
that prevents `afterAll` from running (Ctrl-C, SIGTERM, uncaught exception,
process exit between snapshot and restore) leaves the placeholder in place.
Some past test run hit one of those termination paths and the placeholder sat
in the developer's live config for weeks before anyone tried to use the bridge
with the real extension.

### Fix (`ec9f1fb`)

1. **Crash-safe restore** — register `restoreAllowlist()` on `exit` +
   `SIGINT` + `SIGTERM` + `SIGHUP` + `SIGBREAK` + `uncaughtException` +
   `unhandledRejection`, with an idempotent guard so it runs exactly once
   regardless of which path fires.
2. **Defense-in-depth fixture rename** — replaced the `'myext123'` test fixture
   with `'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab'` (32-char `a..p`). If the guard
   ever fails again, the leaked value is obvious test garbage, not a
   realistic-looking 8-char string that silently became a strict allowlist.
3. **Cleanup of the user's contaminated file** — deleted, backed up to
   `extension-ids.json.contaminated-backup`. Real Edge extension reconnected
   within seconds (bridge fell back to "accept any extension-scheme origin"
   in back-compat mode).

### Customer impact

**None.** `myext123` only ever appears in test code. Real `npx agenthub-setup`
runs require `--extension-id <real-id>` (or auto-detect since v0.5.12);
neither path can produce `myext123`. This was contamination of one developer
machine via leaked test state.

---

## Symptom 2 — `chaos-connection` / `connection-resilience` failed 2/5 on Windows

Two of the five tests in `connection-resilience.spec.ts` either failed with
"lock file got clobbered" or timed out at 60 s with "bridge on `${port}` never
came up." Re-runs were inconsistent — looked like Windows-specific flakes.

### Root cause (it wasn't flakes — it was two real bugs stacked)

#### 2a — `LOCALAPPDATA` test isolation didn't work cross-platform

The tests redirect bridge state with `env: { LOCALAPPDATA: <tempdir>, ... }`,
expecting the bridge to write its lock file at `<tempdir>/agenthub/server.lock`.
That works on **Windows**. On **macOS** and **Linux** the bridge's
`defaultInstallDir()` switch ignored `LOCALAPPDATA`:

```ts
switch (platform()) {
  case 'win32':   return join(env.LOCALAPPDATA ?? ..., 'agenthub');
  case 'darwin':  return join(homedir(), 'Library/Application Support/agenthub');
  default:        return join(homedir(), '.local/share/agenthub');
}
```

So on Linux the bridge wrote to `~/.local/share/agenthub/`, the test polled
`<tempdir>/agenthub/server.lock` forever, and timed out. Worse: tests on
Linux/macOS would have **polluted the developer's real install dir**.

On Windows the redirect did work — but the bug was masked by a separate
problem (next section): **6 different copies** of `getInstallDir()` had drifted
across the codebase, and some tests/code paths were getting their state from
different copies.

#### 2b — 6 separate `getInstallDir` implementations, with inconsistent logic

Audit of every place that resolved the install dir:

| File | What it controls | Pre-fix behavior |
|---|---|---|
| `native-host/src/service.ts:180` `defaultInstallDir()` | Allowlist read | win32-only LOCALAPPDATA |
| `native-host/src/service.ts:1340` `getInstallDir()` (duplicate in same file) | Bridge/extension log paths | win32-only LOCALAPPDATA |
| `native-host/src/lock-file-manager.ts:22` (inline) | server.lock write | win32-only LOCALAPPDATA |
| `native-host-helper/src/service-status.ts:67` | Helper reads lock file | win32-only LOCALAPPDATA |
| `native-host-helper/src/mcp-registrar.ts:41` | Native-host binary path | win32-only LOCALAPPDATA |
| `native-host-helper/src/logger.ts:35` | Helper log location | **DIFFERENT** — honors LOCALAPPDATA on ALL platforms; fallback `~/.agenthub` (every other module's fallback is `~/.local/share/agenthub`) |

So on Linux, `helper.log` ended up in `~/.agenthub/logs/` while
`bridge.log` ended up in `~/.local/share/agenthub/logs/`. They were physically
separated and nobody noticed because no log-grep tool spanned both.

#### 2c — random-port collisions

`freePort()` in both chaos and resilience specs picked a random number from a
20k-port range. On Windows, collisions with sockets in `TIME_WAIT` state happened
~once per 50 runs, surfacing as "bridge never came up" — easy to dismiss as flake.

### Fix (`4c10e30` + `0aaece6`)

1. **Single install-dir resolver** — new
   `packages/native-host/src/shared/install-dir.ts` and a paired copy at
   `packages/native-host-helper/src/install-dir.ts` (helper bundles
   independently; mirror unit tests in both packages assert identical
   input/output for every supported platform).

2. **Cross-platform `AGENTHUB_INSTALL_DIR` env var** — honored FIRST on every
   platform, then OS defaults. `LOCALAPPDATA` is still honored on Windows for
   backward compat, but is no longer the only way to redirect.

3. **Path joining is target-platform aware** — `resolveInstallDir({ platform: 'linux' })`
   returns forward-slash paths even when invoked from a Windows test runner.
   Uses `posix.join` / `win32.join` based on the *target* platform, not the host.

4. **Consolidated 6 call sites** — `service.ts` (×2), `lock-file-manager.ts`,
   `service-status.ts`, `mcp-registrar.ts`, `logger.ts` all delegate to the
   resolver. **Net: −16 lines** despite adding 2 new files + 2 test files.

5. **OS-claimed ephemeral ports** — replaced `Math.random()` port picking with
   `net.createServer().listen(0)` to ask the kernel for a free port. The
   close→reuse race is far smaller than random collision in a 20k pool.
   Result: **3/3 chaos + 2/2 resilience runs clean** (was 1 flake every ~2 runs).

6. **8 test files updated** — all bridge-spawning specs add
   `AGENTHUB_INSTALL_DIR` alongside the legacy `LOCALAPPDATA`. Now isolate
   cleanly on Linux, macOS, AND Windows.

7. **Pre-existing helper TSC errors cleaned up** — `mcp-registrar.test.ts`
   `?freshN` cache-bust query strings (TSC rejected as invalid module paths);
   `mcp-registrar.ts` unused `dirname`; `tool-scanner.test.ts` unused
   `ToolScanResult` type. Helper `npm run build` now passes (was failing
   pre-fix). Independent of the install-dir consolidation; bundled into the
   same followup because they were both blocking robust CI runs.

---

## Why both were missed before

- **Symptom 1:** The test harness already knew this could happen (warning in
  the test preamble) and had a guard — just not a crash-safe one. The leak was
  silent until someone actually used the bridge with their real extension.
- **Symptom 2 (Linux isolation):** No CI run on Linux. The repo's e2e tests
  ran on Windows where `LOCALAPPDATA` redirection happened to work. Linux
  portability of the test isolation was assumed, never tested.
- **Symptom 2 (6 copies):** Each copy was added in isolation by whoever needed
  one (helper team added theirs; bridge added two; lock-file-manager has its
  own). Comment on `service-status.ts:88` hints at the drift problem
  ("Mirror mcp-registrar.ts's resolution so the helper agrees with itself
  across modules") — but mirroring 6 places by convention is not sustainable.
- **Symptom 2 (random ports):** Flakes look like environmental issues
  (antivirus, slow disk). Without a clean reproducer, the fix is easy to defer.

---

## Coverage / regression guards added

| Failure mode | Lock-in |
|---|---|
| Test fixture leaks into developer's live allowlist | Crash-safe restore in `app.test.tsx` (process exit + 4 signals + 2 unhandled paths, idempotent) |
| Fixture pattern accidentally matches a real ID | Renamed to `'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab'` — visibly fake |
| Install-dir resolver drifts between copies | Paired mirror tests in both packages assert identical input/output for win32/darwin/linux/freebsd/openbsd/sunos/aix + 3 env-override modes |
| `AGENTHUB_INSTALL_DIR` empty / whitespace | Explicit unit test asserts fall-through to OS default |
| Target-platform path separators | Explicit unit test asserts `posix` paths for non-win32 target even when host is Windows |
| Random port collision | OS-claimed ephemeral port (no random); flake-check 3 consecutive runs all clean |
| Helper TSC build failures | `npm run build` now green; pre-existing dead-code errors removed |

---

## Verification

| Suite | Result |
|---|---|
| Bridge unit | 188/188 ✅ |
| Helper unit | 29/29 ✅ (was 21, +8 new resolver tests) |
| Extension unit | 269/269 ✅ |
| Installer unit | 318/318 ✅ |
| `connection-resilience.spec.ts` e2e | 5/5 ✅ (was 3/5 with 2 "flakes" pre-fix — the "flakes" were exactly these bugs) |
| `chaos-connection.spec.ts` e2e | 5/5 ✅ on 3 consecutive runs (was 1 flake per ~2 runs) |
| Helper `npm run build` (tsc) | 0 errors ✅ (was 10 errors) |
| Live bridge accepts real extension | Verified — Edge `chrome:7a722d3a-...` reconnected after fix |

---

## Customer impact

**None.** Every issue was contained to test infrastructure + developer-machine
state. Production installer paths, customer release artifacts, and shipped
binaries were unaffected. CI release workflow (`release.yml`) already builds
Linux/macOS/Windows binaries — the gap was purely on the test side, where
specs assumed Windows-only redirection.

---

## Followups left explicit (out of scope for these commits)

- **Pre-existing tests that throw `"not supported"`** in `tools.spec.ts` and
  `connection-e2e.spec.ts` (called out in `rca-2026-06-19-playwright-tool-path.md`)
  are still coverage mirages. Real coverage lives in `tool-path-real.spec.ts`
  and the new `threads-export-bundled.spec.ts`.
- **Linux-side end-to-end install verification.** The release workflow publishes
  `agenthub-linux-x64` and the installer's `getAssetName()` maps it, but no
  test exercises `npx agenthub-setup` on a fresh Linux box → install → real
  Chrome → connect. Could be the next "real e2e gate" piece.
- **State-machine consolidation of the connection layer** (named in
  `stability-assessment-2026-06-19.md`) is still the largest remaining
  architectural debt — not touched here.

---

## Related

- `docs/rca-2026-06-18-green-but-zero-tabs.md`
- `docs/rca-2026-06-19-playwright-tool-path.md`
- `docs/stability-assessment-2026-06-19.md`
- `docs/e2e-tests.md` (updated to reflect the new `AGENTHUB_INSTALL_DIR` env var)
