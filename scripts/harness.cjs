// Shared helpers for the verification harnesses.
//
// The harnesses drive the real app, which means they write to the real
// settings file. That is not acceptable: a harness that toggles a setting
// must not change the user's actual configuration, and a harness that picks
// a test city must not leave "Testville" in the saved places list.
//
// So every harness launches the app with its own `--user-data-dir`, and
// that directory is wiped first so each run starts from a known state.
const path = require('node:path');
const fs = require('node:fs');

const APP_DIR = path.resolve(__dirname, '..');

/** A scratch user-data directory, unique per harness name. */
function harnessUserData(name) {
  return path.join(APP_DIR, '.harness-userdata', name);
}

/**
 * Prepares an isolated user-data directory and returns the launch arguments.
 * The directory is cleared so the run always starts from the same state.
 *
 * Pass `keep: true` to leave an existing directory alone. The persistence
 * harness needs that: it launches the app several times and expects the
 * settings to survive between launches.
 */
function isolatedArgs(name, options = {}) {
  const dir = harnessUserData(name);
  if (!options.keep) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return [APP_DIR, '--no-sandbox', `--user-data-dir=${dir}`];
}

/** Removes every harness scratch directory. */
function cleanHarnessDirs() {
  fs.rmSync(path.join(APP_DIR, '.harness-userdata'), { recursive: true, force: true });
}

module.exports = { APP_DIR, harnessUserData, isolatedArgs, cleanHarnessDirs };
