import { runStub, STUB_VERSION } from './stub-impl.js';

if (process.argv.includes('--version')) {
  process.stdout.write(`${STUB_VERSION}\n`);
  process.exit(0);
}

runStub().catch((err: unknown) => {
  process.stderr.write(`[stub] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
