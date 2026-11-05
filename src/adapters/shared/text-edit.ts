/**
 * Elevate — range based text edits.
 *
 * Replaces exact character ranges of a source text, so everything around them
 * (comments, quotes, indentation, line endings) stays byte-identical. Every
 * edit states the text it expects to replace; a mismatch means the file
 * changed since it was scanned.
 */

import { StaleEditError } from './xml.js';

export interface RangeEdit {
  start: number;
  end: number;
  /** The text currently at `start..end`. */
  expected: string;
  replacement: string;
}

export function applyRangeEdits(source: string, edits: readonly RangeEdit[]): string {
  for (const edit of edits) {
    const found = source.slice(edit.start, edit.end);
    if (found !== edit.expected) {
      throw new StaleEditError(`Found '${found}', expected '${edit.expected}'. The file changed since it was scanned.`);
    }
  }
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.end > ordered[i - 1]!.start) throw new StaleEditError('Overlapping edits on the same text.');
  }
  let result = source;
  for (const edit of ordered) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return result;
}
