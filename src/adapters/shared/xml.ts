/**
 * Elevate — position-aware XML reader for manifest files.
 *
 * Builds a lightweight element tree on top of the `saxes` streaming parser and
 * records, for every element, the exact source range of its text content. The
 * ranges make it possible to rewrite a single value (e.g. a `<version>`) by
 * splicing the original string, which preserves formatting, comments and
 * line endings byte for byte — something a parse/serialize round trip cannot.
 *
 * Commented-out markup is never part of the tree, so it can never be matched
 * or edited by accident.
 */

import { SaxesParser } from 'saxes';

/** An XML element with its children and the source range of its text. */
export interface XmlElement {
  /** Local element name without namespace prefix. */
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Concatenated, entity-decoded character data directly inside this element. */
  text: string;
  /**
   * Source range `[start, end)` between the end of the opening tag and the
   * start of the closing tag. Undefined for self-closing elements.
   */
  contentRange?: { start: number; end: number };
}

/** Thrown when a manifest cannot be parsed as well-formed XML. */
export class XmlParseError extends Error {
  constructor(message: string, readonly file?: string) {
    super(file ? `${file}: ${message}` : message);
    this.name = 'XmlParseError';
  }
}

/**
 * Parses an XML document and returns its root element.
 *
 * @param source the complete document text
 * @param file optional file name used in error messages
 */
export function parseXml(source: string, file?: string): XmlElement {
  const parser = new SaxesParser({ position: true });
  const stack: XmlElement[] = [];
  const openEnds: number[] = [];
  let root: XmlElement | undefined;
  let failure: Error | undefined;

  parser.on('error', (err) => {
    failure ??= err;
  });

  parser.on('opentag', (tag) => {
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(tag.attributes)) {
      attributes[key] = typeof value === 'string' ? value : value.value;
    }
    const element: XmlElement = {
      name: localName(tag.name),
      attributes,
      children: [],
      text: '',
    };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else root ??= element;

    stack.push(element);
    // `position` points just past the `>` of the opening tag.
    openEnds.push(parser.position);
  });

  parser.on('closetag', (tag) => {
    const element = stack.pop();
    const openEnd = openEnds.pop();
    if (!element || openEnd === undefined || tag.isSelfClosing) return;

    // `position` points just past the `>` of the closing tag. A closing tag is
    // `</name>` unless it contains whitespace before `>`, which we detect by
    // searching backwards for its `</` instead of assuming its length.
    const closeEnd = parser.position;
    const closeStart = source.lastIndexOf('</', closeEnd - 1);
    if (closeStart >= openEnd) {
      element.contentRange = { start: openEnd, end: closeStart };
    }
  });

  parser.on('text', (text) => {
    const current = stack[stack.length - 1];
    if (current) current.text += text;
  });

  parser.on('cdata', (data) => {
    const current = stack[stack.length - 1];
    if (current) current.text += data;
  });

  try {
    parser.write(source).close();
  } catch (err) {
    failure ??= err as Error;
  }

  if (failure) throw new XmlParseError(failure.message, file);
  if (!root) throw new XmlParseError('document has no root element', file);
  return root;
}

/** Returns the first direct child with the given name. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find((c) => c.name === name);
}

/** Returns all direct children with the given name. */
export function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return element ? element.children.filter((c) => c.name === name) : [];
}

/** Follows a path of direct child names, e.g. `childAt(project, 'parent', 'version')`. */
export function childAt(element: XmlElement | undefined, ...path: string[]): XmlElement | undefined {
  let current = element;
  for (const name of path) current = child(current, name);
  return current;
}

/** Returns the trimmed text of a direct child, or undefined when absent or empty. */
export function childText(element: XmlElement | undefined, name: string): string | undefined {
  const value = child(element, name)?.text.trim();
  return value ? value : undefined;
}

/** A replacement of an element's text content. */
export interface TextEdit {
  element: XmlElement;
  /** The value the element is expected to contain; guards against stale edits. */
  expected: string;
  replacement: string;
}

/** Thrown when an edit no longer matches the file it is applied to. */
export class StaleEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleEditError';
  }
}

/**
 * Applies text replacements to the original source.
 *
 * Only the trimmed value inside each element is replaced; surrounding
 * whitespace stays untouched. Every edit verifies that the element still holds
 * the expected value, so an edit computed from an outdated scan fails loudly
 * instead of overwriting a change made in the meantime.
 */
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const splices = edits.map((edit) => {
    const range = edit.element.contentRange;
    if (!range) {
      throw new StaleEditError(`<${edit.element.name}> has no editable text content.`);
    }
    const raw = source.slice(range.start, range.end);
    const leading = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (value !== edit.expected) {
      throw new StaleEditError(
        `<${edit.element.name}> contains '${value}', expected '${edit.expected}'. The file changed since it was scanned.`,
      );
    }
    const start = range.start + leading;
    return { start, end: start + value.length, replacement: edit.replacement };
  });

  // Apply from the end of the document so earlier offsets stay valid.
  splices.sort((a, b) => b.start - a.start);
  for (let i = 1; i < splices.length; i++) {
    if (splices[i]!.end > splices[i - 1]!.start) {
      throw new StaleEditError('Overlapping edits on the same element.');
    }
  }

  let result = source;
  for (const splice of splices) {
    result = result.slice(0, splice.start) + splice.replacement + result.slice(splice.end);
  }
  return result;
}

/** Escapes text for use as XML character data. */
export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Serialises an element subtree. Intended for generating throw-away documents
 * (e.g. probe POMs); it does not preserve the original formatting.
 */
export function serializeXml(element: XmlElement, indent = ''): string {
  const attrs = Object.entries(element.attributes)
    .map(([key, value]) => ` ${key}="${escapeXml(value).replace(/"/g, '&quot;')}"`)
    .join('');
  if (element.children.length === 0) {
    return `${indent}<${element.name}${attrs}>${escapeXml(element.text.trim())}</${element.name}>`;
  }
  const inner = element.children.map((c) => serializeXml(c, `${indent}  `)).join('\n');
  return `${indent}<${element.name}${attrs}>\n${inner}\n${indent}</${element.name}>`;
}

function localName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon >= 0 ? qualified.slice(colon + 1) : qualified;
}
