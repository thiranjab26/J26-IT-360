/**
 * Latency and memory benchmark (NFR1, NFR6). Implemented in TODO A7.
 *
 * Will run a fixed fake-camera clip through the production build and write
 * frame latency p50/p95, event latency p95, classifier time, long tasks and
 * tensor count, with device and browser info, to docs/bench/*.json.
 *
 * Until then it exits non-zero so a missing benchmark is never mistaken for
 * a passing one (CLAUDE.md invariant 6: no invented results).
 */
console.error('bench: not implemented yet (docs/c2/TODO.md A7). No numbers written.');
process.exit(1);
