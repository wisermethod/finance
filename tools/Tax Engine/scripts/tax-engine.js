#!/usr/bin/env node
/**
 * Tax Engine. Computation only: it does not give tax advice, it does not fill
 * or produce a form, and it does not replace a licensed CPA, enrolled agent,
 * or other tax professional.
 *
 * Commands:
 *   node scripts/tax-engine.js help
 *   node scripts/tax-engine.js --help
 *   node scripts/tax-engine.js compute --facts <absolute path> [--install]
 *   node scripts/tax-engine.js check [--install]
 *
 * Flags:
 *   --facts <absolute path>   the JSON facts file compute reads
 *   --install                 authorise the dependency install and finish the run
 *   --help                    print usage
 *
 * The fact vocabulary, the refusals, and what check reports are in the help text.
 * Help defines each fact. spouseItemizes is required only when filing status is mfs.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { main } from './tax-engine-core.js';

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

function finish(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (invokedDirectly()) {
  main(process.argv.slice(2), { fromFile: fileURLToPath(import.meta.url) }).then(finish).catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    const body = {
      refused: false,
      code: 'ENGINE_FAULT',
      message: `Tax Engine failed: ${message}. Fix: run "node scripts/tax-engine.js help" and retry the command.`
    };
    process.stderr.write(`${JSON.stringify(body)}\n`);
    process.exit(1);
  });
}

export { main };
