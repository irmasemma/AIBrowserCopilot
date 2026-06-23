# Installer EPERM-on-rename when Chrome/Edge is running

User-visible bug: `npx agenthub-setup@latest --update` fails with

```
✗ Installation failed
 Download failed after 3 attempt(s): EPERM: operation not permitted, rename
 'C:\Users\…\AppData\Local\agenthub\agenthub-win-x64.exe.tmp' ->
 'C:\Users\…\AppData\Local\agenthub\agenthub-win-x64.exe'.
```

Status: **known issue, not fully fixed.** This document captures the
structural race and the proposed real fix so we don't re-derive it
every time someone hits it.

---

## Reproduction

1. Chrome or Edge is open with the AgentHub extension loaded (the SW is alive).
2. A bridge process is running — either spawned by autostart at login, or
   freshly spawned by the helper in response to an extension `verify_connection`
   message, or running from a prior install.
3. User runs `npx agenthub-setup@latest --update`.
4. Installer reports `Browser bridge already installed` → enters the update path.
5. Download phase fails with EPERM during the final `rename(.tmp → .exe)`.

## Why it fails

Windows: the running `agenthub-win-x64.exe` holds an exclusive lock on its own
binary. `MoveFile` / `rename` over a locked .exe returns `EPERM` (or `EBUSY` /
`EACCES` depending on the layer reporting).

The installer's existing mitigation (commit `a6c678c fix(installer): kill all
bridge instances by image name on upgrade`) does call `killRunningNativeHost`
for both bridge **and** helper image names before downloading
(`packages/installer/src/installers/binary-installer.ts:128-130`). So why does
the rename still hit a locked file?

### The race window

```
[install start]
   │
   ▼
1. kill bridge + helper          ← file lock released, bridge process gone
   │
   ▼
2. download new .exe to .tmp     ← takes several seconds (network)
   │       │
   │       │  ← during this window, Chrome/Edge can re-spawn the chain:
   │       │     a. extension SW detects connection drop, fires
   │       │        chrome.runtime.sendNativeMessage('com.agenthub.…helper', …)
   │       │     b. Chrome's NM dispatcher reads the helper manifest from disk
   │       │     c. Chrome spawns a new helper.exe
   │       │     d. helper ensures the bridge is running → spawns a new bridge
   │       │     e. new bridge opens the (still-current) .exe with the loader's
   │       │        default share mode → file is locked again
   │       │  (a-e completes in low single-digit milliseconds)
   ▼       ▼
3. rename .tmp → .exe            ← ★ FAILS with EPERM: destination is locked
```

The installer's retry loop retries the **whole `downloadOnce(url, target, tmp,
…)` block** 3 times (`maxAttempts: 3, baseDelayMs: 1000`) but does **not**
re-run the killer between retries. Each retry hits the same alive-again bridge
and fails identically.

### Why test B (`install-and-connect`) doesn't catch this

`install-and-connect.spec.ts` Test B exists to verify the "old bridge running,
new install must overwrite" scenario, and it passes. The reason it passes and
real-world `--update` does not:

```ts
// Test B (paraphrased)
killAllChrome();          // ← kills Edge first
const before = snapshot();
const r = runInstall();   // → goes through install flow
```

With **no Chrome/Edge process at all**, the SW can't be alive, so the
respawn loop (steps a–d above) has nothing driving it. The kill in step 1
sticks. The test is a clean reinstall of a stale on-disk binary, not the
real-world "update while user is actively browsing" case.

In production, the user has Edge or Chrome open — that's the whole point of
the extension — so the race is live for them.

---

## Why simple fixes don't work

### "Kill again right before the rename" (the obvious fix)

Reduces the race window from "seconds of download" to "microseconds of kill
→ rename." Still not zero:

- `taskkill /F` returns when the kill *signal* is sent, not when the process
  has finished exiting and Windows has flushed file handles. A `rename`
  issued immediately after `taskkill` can hit EPERM if the handle isn't yet
  released (typically tens of ms after the signal).
- The respawn path is asynchronous and *fast*. Chrome's NM dispatcher +
  the extension's SW can re-spawn helper + bridge in a few ms. On a slow
  machine with a long-running SW, the rename can race the new spawn.

Empirically: this lowers failure rate from ~100% (Chrome open, bridge running)
to "sometimes flaky on slower machines." Not a fix.

### "Bigger retry loop" (50 retries instead of 3)

Same race, more chances. The respawn loop is reliable enough that more
retries just means more failures. Doesn't help.

### "Wait N seconds after kill before rename"

Doesn't prevent re-spawn — only makes the spawn-then-die-then-rename window
larger so the new process is killable. Still racey.

---

## The actual fix

Two patterns layered:

### 1. Move the NM manifests aside for the duration of the install

Chrome's NM dispatcher reads the helper manifest from disk **on every
connection establishment**. If the manifest is absent at that moment, the
`chrome.runtime.sendNativeMessage(...)` call fails — Chrome cannot spawn the
helper. No helper → no bridge respawn → file lock stays free.

```
1. rename com.agenthub.native_host.json        → com.agenthub.native_host.json.install
2. rename com.agenthub.native_host_helper.json → com.agenthub.native_host_helper.json.install
3. kill bridge + helper                  ← removes existing locks
4. download new .exe to .tmp             ← no respawn possible during this
5. rename .tmp → .exe                    ← happy path
6. (re)write fresh manifests pointing at new .exe
```

Closes the structural race. Both bridge and helper manifests must be moved
aside — moving only the helper still lets external MCP clients (Claude Code,
Cursor, VS Code) spawn the bridge directly via the bridge manifest.

### 2. Fallback: rename the running .exe out of the way

On modern Windows (Vista+), the loader opens `.exe` files with
`FILE_SHARE_DELETE`. That means you can rename the *path* of a running .exe
even though you can't `delete` or `overwrite-content` it. The running process
keeps executing from the renamed inode. This is exactly how `chrome.exe`,
`code.exe`, and Electron apps self-update.

```
if direct rename fails with EPERM/EBUSY:
   rename old.exe → old.exe.delete-me-<timestamp>
   rename tmp → old.exe                                    ← target slot free, succeeds
   schedule old.exe.delete-me-* for cleanup on next reboot
     (MoveFileEx with MOVEFILE_DELAY_UNTIL_REBOOT, or just
      try unlink on next install start)
```

This handles the case where the manifest-aside trick still races (e.g.,
non-NM-spawned bridge, user manually launched from CLI, autostart firing
during the install window).

### Combined flow

```
1. Move both NM manifests aside        ← block Chrome NM respawn path
2. Kill bridge + helper                ← remove existing locks
3. Download .tmp                       ← network
4. Try direct rename .tmp → .exe       ← happy path (most installs)
5. On EPERM: rename-aside fallback     ← stubborn lock case
6. Write fresh manifests at original paths
7. If still failing after backoff:     ← genuine non-race errors
   surface clear actionable message — see "User-facing error" below
```

---

## What this fix does **not** solve

"Always works" is a guarantee no installer on Windows can honestly make.
The remaining failure modes after the fix above:

| Cause | Frequency | Mitigation |
|---|---|---|
| Antivirus (Defender / corp AV) locks the just-downloaded `.tmp` for scanning | Common, especially on managed laptops | Outer retry loop with exponential backoff over ~30 s; clear error message pointing to AV |
| ACL / permission weirdness on `%LOCALAPPDATA%` (corp policy, OneDrive folder sync) | Rare but real in enterprise | Detect and surface in error; user must contact IT |
| Concurrent installer runs (two `npx ... --update` shells at once) | Vanishingly rare | Best-effort lockfile in installdir |
| User has the .exe open in another tool (hex editor, file manager preview) | Theoretical | Same as AV — backoff + clear error |
| Disk full / disk error mid-rename | Filesystem-level | Surface raw error |

For all of these, the right behavior is: **fail fast with an actionable
error message**, not silent retries.

### User-facing error message (when fix above isn't enough)

```
✗ Could not replace agenthub-win-x64.exe.

  The file is locked by another process. Try this in order:

    1. Close every Chrome and Edge window (including any background
       processes — check Task Manager). Then re-run:
       npx agenthub-setup@latest --update

    2. If you still hit this error, your antivirus may be scanning the
       new binary. Pause real-time protection for 60 seconds and retry,
       or whitelist this folder:
       C:\Users\<you>\AppData\Local\agenthub

    3. If neither works, file an issue with the full output:
       https://github.com/irmasemma/AIBrowserCopilot/issues
```

---

## Test coverage for the fix

`install-and-connect.spec.ts` Test B already covers the "kill running bridge,
overwrite binary" path **with no Chrome open**. The fix above needs a new
test that exercises the harder case:

**Test G — `--update` while Chrome is actively driving the bridge**

```
1. Install + launch Chrome with the extension loaded.
2. Wait for the side panel to reach Connected (real bridge running, SW alive).
3. From a separate process, run `npx agenthub-setup --update` (or the
   --from-local equivalent — installer-cli helper).
4. Assert: the installer exits 0 (success).
5. Assert: %LOCALAPPDATA%\agenthub\agenthub-win-x64.exe is the new version
   (check timestamp or run --version).
6. Assert: the side panel re-establishes Connected without manual reload
   (the SW + helper + new bridge auto-reconnect chain works).
```

This is essentially the "Test B with Chrome left open" scenario. Without the
fix above, this test fails with EPERM. With the fix, it passes.

Add this to `install-and-connect.spec.ts` once the fix is implemented.

---

## Workaround for users hitting this today

Until the fix lands:

```
1. Close every Chrome and Edge window.
2. Verify in Task Manager: no msedge.exe, no chrome.exe.
3. Run: npx agenthub-setup@latest --update --extension-id <YOUR_ID>
4. Reopen Chrome/Edge.
```

This is exactly what `install-and-connect` Test B does — and it works
reliably both there and in real-world usage. The fix is about removing this
"close the browser first" requirement so users don't have to do it.

---

## File pointers

| File | Relevance |
|---|---|
| `packages/installer/src/installers/binary-installer.ts` | Owns the download + rename flow (lines 89–130). The fix lands here. |
| `packages/installer/src/installers/process-killer.ts` | Existing `killRunningNativeHost` — called once at install start. Will be called again from inside the rename retry loop. |
| `packages/installer/src/installers/host-registrar.ts` | Owns the NM manifest write path. Manifest-aside logic touches this. |
| `packages/installer/src/installers/browser-registrar.ts` | Per-browser manifest paths — Chrome vs Edge vs Brave etc. Manifest-aside needs to iterate these. |
| `tests/e2e/install-and-connect.spec.ts` | Test B passes today by killing Chrome first. Test G (above) is the regression for the fix. |
