// Single source of truth for the native-host bridge version.
// Imported by index.ts (--version flag), service.ts (server_info + lock file).
export const VERSION = '0.5.10';

// Build identifier — surfaced via server_info so the extension diagnostics
// panel can show users exactly which build is running. Replaced at compile
// time by the release script; falls back to 'dev' for local builds.
export const BUILD_ID = process.env.BUILD_ID ?? 'dev';

