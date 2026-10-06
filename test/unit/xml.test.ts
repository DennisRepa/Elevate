import { describe, expect, it } from 'vitest';
import { StaleEditError, applyTextEdits, childAt, children, parseXml, XmlParseError } from '../../src/adapters/shared/xml.js';

const SOURCE = `<?xml version="1.0"?>
<project>
  <!-- <version>9.9.9</version> must never be matched -->
  <version>
    1.0.0
  </version>
  <dependencies>
    <dependency><artifactId>a</artifactId><version>2.0</version></dependency>
    <dependency><artifactId>b</artifactId><version >3.0</version ></dependency>
  </dependencies>
</project>
`;

describe('parseXml', () => {
  it('builds the element tree and ignores commented-out markup', () => {
    const root = parseXml(SOURCE);
    expect(root.name).toBe('project');
    expect(childAt(root, 'version')?.text.trim()).toBe('1.0.0');
    expect(children(childAt(root, 'dependencies'), 'dependency')).toHaveLength(2);
  });

  it('strips namespace prefixes from element names', () => {
    const root = parseXml('<p:project xmlns:p="urn:x"><p:a>1</p:a></p:project>');
    expect(root.name).toBe('project');
    expect(childAt(root, 'a')?.text).toBe('1');
  });

  it('reports malformed documents', () => {
    expect(() => parseXml('<project><a></project>', 'pom.xml')).toThrow(XmlParseError);
  });
});

describe('applyTextEdits', () => {
  it('replaces only the trimmed value and keeps all surrounding text', () => {
    const root = parseXml(SOURCE);
    const version = childAt(root, 'version')!;
    const result = applyTextEdits(SOURCE, [{ element: version, expected: '1.0.0', replacement: '1.1.0' }]);
    expect(result).toBe(SOURCE.replace('    1.0.0\n', '    1.1.0\n'));
    expect(result).toContain('<!-- <version>9.9.9</version> must never be matched -->');
  });

  it('handles closing tags with whitespace and several edits in one file', () => {
    const root = parseXml(SOURCE);
    const [a, b] = children(childAt(root, 'dependencies'), 'dependency').map((d) => childAt(d, 'version')!);
    const result = applyTextEdits(SOURCE, [
      { element: a!, expected: '2.0', replacement: '2.1' },
      { element: b!, expected: '3.0', replacement: '3.10.4' },
    ]);
    expect(result).toContain('<version>2.1</version>');
    expect(result).toContain('<version >3.10.4</version >');
  });

  it('refuses an edit whose expected value no longer matches', () => {
    const root = parseXml(SOURCE);
    const version = childAt(root, 'version')!;
    expect(() => applyTextEdits(SOURCE, [{ element: version, expected: '0.9.0', replacement: '1.1.0' }])).toThrow(
      StaleEditError,
    );
  });
});
