#!/usr/bin/env node

/**
 * Elevate — changelog tooling for releases.
 *
 *   node scripts/changelog.mjs check             Unreleased has entries (npm `preversion`)
 *   node scripts/changelog.mjs release           Unreleased becomes the new version (npm `version`)
 *   node scripts/changelog.mjs notes <version>   prints the release notes of a version
 *
 * CHANGELOG.md is the single source of the release notes: changes are written
 * under "## Unreleased", releasing renames that section to
 * "## <version> (<date>)", and the GitHub release shows exactly that section.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Thrown when the changelog cannot be used for the requested step. */
export class ChangelogError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChangelogError';
  }
}

const H2 = /^## (.+?)\s*$/;
const ENTRY = /^\s*[*-]\s+\S/m;

/** Line ending of a file: Windows when it contains one, otherwise Unix. */
function lineEnding(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Finds the section whose heading is `title` or `title (date)`. The section
 * runs up to the next second-level heading.
 */
function findSection(lines, title) {
  const start = lines.findIndex((line) => {
    const text = H2.exec(line)?.[1];
    return text === title || text?.startsWith(`${title} (`);
  });
  if (start === -1) return undefined;
  let end = lines.findIndex((line, index) => index > start && H2.test(line));
  if (end === -1) end = lines.length;
  return { start, end, body: lines.slice(start + 1, end).join('\n') };
}

/** Whether a section body has at least one list item. */
export function hasEntries(body) {
  return ENTRY.test(body);
}

/** Throws unless "## Unreleased" exists and has entries. */
export function checkUnreleased(source) {
  const section = findSection(source.split(/\r?\n/), 'Unreleased');
  if (!section) throw new ChangelogError('CHANGELOG.md has no "## Unreleased" section.');
  if (!hasEntries(section.body)) {
    throw new ChangelogError(
      'CHANGELOG.md has no entries under "Unreleased". Describe the changes of this release there before releasing.',
    );
  }
}

/** Turns "## Unreleased" into "## <version> (<date>)" and opens a new, empty Unreleased section. */
export function release(source, version, date) {
  checkUnreleased(source);
  const lines = source.split(/\r?\n/);
  if (findSection(lines, version)) {
    throw new ChangelogError(`CHANGELOG.md already has a section for ${version}.`);
  }
  const { start } = findSection(lines, 'Unreleased');
  lines.splice(start + 1, 0, '', `## ${version} (${date})`);
  return lines.join(lineEnding(source));
}

/** The release notes of a version: its section without the heading. */
export function notes(source, version) {
  const section = findSection(source.split(/\r?\n/), version);
  if (!section) throw new ChangelogError(`CHANGELOG.md has no section for ${version}.`);
  if (!hasEntries(section.body)) {
    throw new ChangelogError(`The CHANGELOG.md section for ${version} has no entries.`);
  }
  return `${section.body.trim()}\n`;
}

function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function main(argv) {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');
  const [command, argument] = argv;
  const source = readFileSync(file, 'utf8');

  try {
    switch (command) {
      case 'check':
        checkUnreleased(source);
        return;
      case 'release': {
        // npm sets the new version while its `version` script runs.
        const version = process.env.npm_package_version ?? argument;
        if (!version) throw new ChangelogError('No version given.');
        writeFileSync(file, release(source, version, today()), 'utf8');
        return;
      }
      case 'notes':
        if (!argument) throw new ChangelogError('Usage: changelog.mjs notes <version>');
        process.stdout.write(notes(source, argument));
        return;
      default:
        throw new ChangelogError('Usage: changelog.mjs check | release | notes <version>');
    }
  } catch (err) {
    if (!(err instanceof ChangelogError)) throw err;
    process.stderr.write(`❌ ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
