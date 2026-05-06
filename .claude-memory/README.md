# Claude Memory Sync

Claude Code memory files synced from `~/.claude/projects/c--Dev-1M/memory/` so other-machine sessions can read the same context.

## How to use on a fresh machine

After `git pull`, copy these into your local Claude memory dir:

```bash
# Windows PowerShell
Copy-Item -Recurse .claude-memory\*.md "$env:USERPROFILE\.claude\projects\c--Dev-1M\memory\"

# macOS / Linux
mkdir -p ~/.claude/projects/c--Dev-1M/memory
cp .claude-memory/*.md ~/.claude/projects/c--Dev-1M/memory/
```

`MEMORY.md` is the index; the rest are individual memory files referenced by it.

## Updating

If you edit memories in the live folder and want them mirrored back:

```bash
# Windows
Copy-Item -Recurse "$env:USERPROFILE\.claude\projects\c--Dev-1M\memory\*.md" .claude-memory\
```

Then `git add .claude-memory && git commit`.

## Note on memory staleness

Memories are point-in-time observations. Verify against current code/state before treating any claim as fact.
