/**
 * Requirement Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { extractRequirementsFromSections } from './requirement-extractor.js';
import type { Section } from '../types/index.js';

// テスト用セクションデータ
const testSections: Section[] = [
  {
    number: 'section-3',
    anchor: 'section-3',
    title: 'Main Section',
    content: [
      {
        type: 'text',
        content: 'The client MUST send data.',
        requirements: [{ level: 'MUST', position: 11 }],
        crossReferences: [],
      },
    ],
    subsections: [
      {
        number: 'section-3.5',
        anchor: 'section-3.5',
        title: 'Subsection 3.5',
        content: [
          {
            type: 'text',
            content: 'The server SHOULD respond.',
            requirements: [{ level: 'SHOULD', position: 11 }],
            crossReferences: [],
          },
        ],
        subsections: [
          {
            number: 'section-3.5.1',
            anchor: 'section-3.5.1',
            title: 'Sub-subsection',
            content: [
              {
                type: 'text',
                content: 'Implementations MAY cache.',
                requirements: [{ level: 'MAY', position: 16 }],
                crossReferences: [],
              },
            ],
            subsections: [],
          },
        ],
      },
    ],
  },
  {
    number: '5',
    title: 'Text Format Section',
    content: [
      {
        type: 'text',
        content: 'Endpoints MUST NOT close prematurely.',
        requirements: [{ level: 'MUST NOT', position: 10 }],
        crossReferences: [],
      },
    ],
    subsections: [
      {
        number: '5.5',
        title: 'Text Subsection',
        content: [
          {
            type: 'text',
            content: 'Clients SHALL validate input.',
            requirements: [{ level: 'SHALL', position: 8 }],
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ],
  },
];

describe('extractRequirementsFromSections', () => {
  it('should extract all requirements without filter', () => {
    const result = extractRequirementsFromSections(testSections);
    expect(result.length).toBe(5);
  });

  it('should filter by section with section- prefix format (including subsections)', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: 'section-3.5',
    });
    // section-3.5 と section-3.5.1 の2つ
    expect(result.length).toBe(2);
    expect(result.some((r) => r.level === 'SHOULD')).toBe(true);
    expect(result.some((r) => r.level === 'MAY')).toBe(true);
  });

  it('should filter by section with plain number format (including subsections)', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: '3.5',
    });
    // section-3.5 と section-3.5.1 の2つ
    expect(result.length).toBe(2);
    expect(result.some((r) => r.level === 'SHOULD')).toBe(true);
    expect(result.some((r) => r.level === 'MAY')).toBe(true);
  });

  it('should include subsections by default', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: 'section-3',
    });
    // section-3, section-3.5, section-3.5.1 の3つ
    expect(result.length).toBe(3);
  });

  it('should exclude subsections when includeSubsections is false', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: 'section-3',
      includeSubsections: false,
    });
    // section-3 のみ
    expect(result.length).toBe(1);
    expect(result[0].section).toBe('section-3');
  });

  it('should support multiple sections filter', () => {
    const result = extractRequirementsFromSections(testSections, {
      sections: ['section-3.5', '5.5'],
      includeSubsections: false,
    });
    expect(result.length).toBe(2);
    expect(result.some((r) => r.section === 'section-3.5')).toBe(true);
    expect(result.some((r) => r.section === '5.5')).toBe(true);
  });

  it('should filter by requirement level', () => {
    const result = extractRequirementsFromSections(testSections, {
      level: 'MUST',
    });
    expect(result.every((r) => r.level === 'MUST')).toBe(true);
  });

  it('should combine section and level filters', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: 'section-3',
      level: 'SHOULD',
    });
    expect(result.length).toBe(1);
    expect(result[0].level).toBe('SHOULD');
  });

  it('should handle text format section numbers (without section- prefix)', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: '5',
    });
    // section 5 and 5.5
    expect(result.length).toBe(2);
  });

  it('should normalize section- prefix in filter', () => {
    // Both formats should return same results
    const result1 = extractRequirementsFromSections(testSections, {
      section: 'section-3.5.1',
    });
    const result2 = extractRequirementsFromSections(testSections, {
      section: '3.5.1',
    });
    expect(result1.length).toBe(result2.length);
    expect(result1[0]?.level).toBe(result2[0]?.level);
  });
});
