# Finding: `fill_form` type:file always ENOENTs on real local paths (playwright-crx virtual fs)

**Date found:** 2026-07-11, while having Claude upload demo videos to YouTube Studio via the MCP tools.
**Severity:** feature gap — file upload through `fill_form` is advertised in the tool schema but cannot work.
**Status:** open. Workaround in production use (see below). Proposed fix at the bottom.

## Symptom

Any `fill_form` call with `type: "file"` and a real, existing local path fails:

```
[{"field":"input[type=file]","success":false,
  "error":"ENOENT: no such file or directory, stat 'C:\\Users\\semma\\Downloads\\agenthub-upload.mp4'",
  "errorCode":"CLICK_NOT_ACTIONABLE"}]
```

Tried and ruled out: backslashes vs forward slashes, spaces in filename (space-free copy fails identically).
The file demonstrably exists and is readable by the user; the bridge (`agenthub-win-x64.exe --service`)
runs as the same user.

## Root cause

The MCP-level response is `isError: false` — the bridge forwards the request to the extension fine
(`bridge.tool_request.sent` → `bridge.tool_response.received` in bridge.log). The failure is per-field,
produced inside the **extension**:

- `packages/extension/src/background/tool-dispatcher.ts` (~line 288, `case 'file':`) calls
  `locator.setInputFiles(field.values ?? valueStr, FIELD_OPTS)`.
- That's playwright-crx. Given a **string path**, Playwright stats the file — and playwright-crx's `fs`
  is an in-memory virtual filesystem (memfs shim), not the OS disk. Every real path is absent there,
  so every call returns a Node-style `ENOENT ... stat '<path>'`.
- The extension has no OS filesystem access by design, so no string path can ever succeed. The schema's
  "file paths" wording (`packages/native-host/src/tools/fill-form.ts` lines 16–17) over-promises.

The `CLICK_NOT_ACTIONABLE` errorCode is a misclassification of the thrown ENOENT.

## Workaround (proven, used for 4 real YouTube uploads)

Drive the browser's **native Open dialog** with OS-level SendKeys, since the page's "Select files" button is
clickable via MCP:

1. Start a background PowerShell watcher: poll `FindWindow("#32770", "Open")` (up to ~90 s); when found,
   `SetForegroundWindow`, `SendKeys` the full path, then `{ENTER}`.
2. Click the page's "Select files" / "Upload file" button via `click_element` — Chrome opens the native
   dialog, the watcher fills it.
3. If the click leads somewhere unexpected (e.g. YouTube's thumbnail phone-verification dialog instead of
   a file picker), kill the watcher so it can't type into a future unrelated Open dialog.

Constraints: path must avoid SendKeys metacharacters `+ ^ % ~ ( ) { }` (spaces are fine, but a space-free
copy is safer); the dialog title match is `"Open"` (localized Windows would need the localized title).
Script pattern is preserved in the `agenthub-file-upload-workaround` user memory.

## Proposed fix

Read the file **bridge-side** (the native host has real fs access) and pass a Playwright file payload
instead of a path:

1. In the bridge, before forwarding a `fill_form` whose field is `type:file`: `fs.stat` + read the file,
   base64 it (size-capped; stream/chunk for large videos or reject over a limit with a clear error).
2. Send `{name, mimeType, buffer}` to the extension; `setInputFiles` accepts payload objects and never
   touches the virtual fs.
3. Until then: make the extension return a purposeful error ("file paths are not supported from the
   extension; upload via the native dialog") instead of a confusing ENOENT + `CLICK_NOT_ACTIONABLE`,
   and fix the schema wording in `fill-form.ts`.

Note the payload path bloats the WS message (~4/3 × file size) — for >10–20 MB consider a bridge-hosted
`http://127.0.0.1:<port>/file/<token>` handoff or CDP `DOM.setFileInputFiles` via the debugger attach,
which takes real OS paths and would be the cleanest fix.
