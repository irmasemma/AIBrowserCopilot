---
name: Always reuse existing solutions — trusted libs only
description: Never reinvent — check existing deps and trusted libraries before writing custom, but only use well-maintained, reputable packages
type: feedback
originSessionId: 4c469309-d041-4225-b603-ef4a14352676
---
Always use existing solutions and code rather than reinventing. Only use trusted, well-maintained libraries.

**Why:** Custom scroll/nav content scripts (200+ lines) were replaced by ~90 lines of playwright-crx calls that handle more edge cases. Building custom wastes time and produces worse results than battle-tested libraries. But untrusted deps introduce supply chain risk — this is a security-focused product.

**How to apply:**
1. Before implementing ANY feature, check what's already in the project's dependencies (package.json, node_modules)
2. Check if the project already has a utility, bridge, or abstraction that handles part of the problem (e.g., `withPlaywrightPage`)
3. Search for well-maintained open-source solutions before writing custom code
4. Only use trusted libraries: known maintainers, active development, significant adoption (npm weekly downloads, GitHub stars), no known vulnerabilities
5. Avoid random/obscure packages — if the lib isn't well-known and well-maintained, write it custom instead
6. If a trusted dependency already solves 80% of the problem, use it and adapt — don't build from scratch
