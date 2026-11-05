/**
 * Elevate — reading and editing the text of Gradle build scripts.
 *
 * A build script is a program, so Elevate does not parse it; it looks for the
 * text that carries a version and changes exactly that text (specs/23). Both
 * DSLs are read by the same literal rules: outside comments, every string
 * literal is a candidate (single, double and triple quotes). The text around a
 * literal is never changed, so layout, quotes, comments, tabs, line endings and
 * a byte order mark survive an update.
 */

import { StaleEditError } from '../shared/xml.js';

export type GradleDsl = 'groovy' | 'kotlin';

/** A string literal. `start` and `end` delimit the text between the quotes (end exclusive). */
export interface StringLiteral {
  value: string;
  start: number;
  end: number;
  /** The quote that opens the literal: `'`, `"`, `'''` or `"""`. */
  quote: string;
}

export interface ScannedSource {
  /** The source with every comment replaced by spaces (line breaks stay), so offsets are the same. */
  masked: string;
  literals: StringLiteral[];
}

/** Whether `dsl` is the Kotlin one for a file name. */
export function dslOf(file: string): GradleDsl {
  return file.endsWith('.kts') ? 'kotlin' : 'groovy';
}

/**
 * Walks the source once and returns the string literals outside comments and
 * the source with its comments blanked out. A `//` or `/*` inside a string is
 * not a comment; a quote inside a comment does not open a string.
 */
export function scanSource(source: string, _dsl: GradleDsl): ScannedSource {
  const literals: StringLiteral[] = [];
  const chars = source.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      blank(i, end);
      i = end;
    } else if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
    } else if (ch === "'" || ch === '"') {
      const triple = source.startsWith(ch.repeat(3), i);
      const quote = triple ? ch.repeat(3) : ch;
      const start = i + quote.length;
      const end = findStringEnd(source, start, ch, triple);
      literals.push({ value: source.slice(start, end), start, end, quote });
      i = Math.min(end + quote.length, source.length);
    } else {
      i++;
    }
  }

  return { masked: chars.join(''), literals };
}

/** The offset of the quote that closes the string whose text starts at `start`. */
function findStringEnd(source: string, start: number, quote: string, triple: boolean): number {
  let depth = 0; // inside ${ ... } of a double-quoted string
  let i = start;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\' && !triple) {
      i += 2;
      continue;
    }
    if (quote === '"' && ch === '$' && source[i + 1] === '{') {
      depth++;
      i += 2;
      continue;
    }
    if (depth > 0) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
      continue;
    }
    if (triple) {
      if (source.startsWith(quote.repeat(3), i)) return i;
    } else if (ch === quote) {
      return i;
    } else if (ch === '\n') {
      return i; // an unterminated string ends at the line break
    }
    i++;
  }
  return source.length;
}

/** The string literals of a script outside comments. */
export function findStringLiterals(source: string, dsl: GradleDsl): StringLiteral[] {
  return scanSource(source, dsl).literals;
}

/** Offset ranges of the `{ … }` blocks that follow `keyword` (e.g. `constraints`), in a masked source. */
export function findBlocks(masked: string, keyword: string): { start: number; end: number }[] {
  const blocks: { start: number; end: number }[] = [];
  const opener = new RegExp(`\\b${keyword}\\s*\\{`, 'g');
  for (const match of masked.matchAll(opener)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < masked.length; i++) {
      if (masked[i] === '{') depth++;
      else if (masked[i] === '}' && --depth === 0) {
        blocks.push({ start: open, end: i });
        break;
      }
    }
  }
  return blocks;
}

/** One replacement of text a scan found. */
export interface GradleTextEdit {
  start: number;
  end: number;
  /** The text that must be there; anything else means the file changed since it was scanned. */
  expected: string;
  replacement: string;
  /** The character directly before and after the text at scan time (`''` at the edges of the file). */
  before?: string;
  after?: string;
}

/**
 * Applies replacements to the original source. Every edit verifies that the
 * text it replaces is still the one that was scanned, so an edit computed from
 * an outdated scan fails loudly instead of overwriting a change made in the
 * meantime. Edits on the same range are allowed when they agree.
 *
 * @throws StaleEditError
 */
export function applyGradleEdits(source: string, edits: readonly GradleTextEdit[]): string {
  const unique = new Map<string, GradleTextEdit>();
  for (const edit of edits) {
    const key = `${edit.start}:${edit.end}`;
    const known = unique.get(key);
    if (known && known.replacement !== edit.replacement) {
      throw new StaleEditError(`Conflicting edits of the same text at offset ${edit.start}.`);
    }
    unique.set(key, edit);
  }

  const sorted = [...unique.values()].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const edit = sorted[i]!;
    const found = source.slice(edit.start, edit.end);
    const before = source.slice(Math.max(0, edit.start - 1), edit.start);
    const after = source.slice(edit.end, edit.end + 1);
    if (
      found !== edit.expected ||
      (edit.before !== undefined && before !== edit.before) ||
      (edit.after !== undefined && after !== edit.after)
    ) {
      // Show the whole value that is there now, not just the part that still matches.
      let end = edit.end;
      if (edit.after !== undefined && after !== edit.after) {
        while (end < source.length && end - edit.end < 40 && !/[\s'"),;}]/.test(source[end]!)) end++;
      }
      const shown = `${edit.before !== undefined && before !== edit.before ? before : ''}${source.slice(edit.start, end)}`;
      throw new StaleEditError(`'${shown}' found where '${edit.expected}' was expected. The file changed since it was scanned.`);
    }
    if (i > 0 && edit.start < sorted[i - 1]!.end) {
      throw new StaleEditError('Overlapping edits on the same text.');
    }
  }

  let result = source;
  for (const edit of [...sorted].reverse()) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}
