/**
 * Statement Matcher Tests
 */

import { describe, it, expect } from 'vitest';
import {
  extractKeywords,
  extractRequirementLevel,
  extractSubject,
  scoreRequirementMatch,
  detectConflicts,
  matchStatement,
} from './statement-matcher.js';
import type { Requirement } from '../types/index.js';

// Sample requirements for testing
const sampleRequirements: Requirement[] = [
  {
    level: 'MUST',
    text: 'The client MUST send a request.',
    section: '1',
    fullContext: 'In all cases, the client MUST send a request to the server.',
    subject: 'client',
    components: { subject: 'client', verb: 'send', object: 'request' },
  },
  {
    level: 'SHOULD',
    text: 'The server SHOULD respond within 5 seconds.',
    section: '2',
    fullContext: 'For optimal performance, the server SHOULD respond within 5 seconds.',
    subject: 'server',
    components: { subject: 'server', verb: 'respond', object: undefined },
  },
  {
    level: 'MAY',
    text: 'The client MAY cache the response.',
    section: '3',
    fullContext: 'To improve performance, the client MAY cache the response.',
    subject: 'client',
    components: { subject: 'client', verb: 'cache', object: 'response' },
  },
  {
    level: 'MUST NOT',
    text: 'The server MUST NOT close the connection prematurely.',
    section: '4',
    fullContext: 'The server MUST NOT close the connection before sending a response.',
    subject: 'server',
    components: { subject: 'server', verb: 'close', object: 'connection' },
  },
];

describe('extractKeywords', () => {
  it('should extract keywords with weights', () => {
    const keywords = extractKeywords('The client sends a request to the server');

    expect(keywords.get('client')).toBe(3); // Subject term
    expect(keywords.get('server')).toBe(3); // Subject term
    expect(keywords.get('request')).toBe(2); // Technical term
    expect(keywords.get('sends')).toBe(1); // Regular word
    expect(keywords.has('the')).toBe(false); // Stop word
  });

  it('should handle empty text', () => {
    const keywords = extractKeywords('');
    expect(keywords.size).toBe(0);
  });

  it('should ignore short words', () => {
    const keywords = extractKeywords('a is to of in');
    expect(keywords.size).toBe(0);
  });

  it('should clean punctuation', () => {
    const keywords = extractKeywords('client, server. request!');
    expect(keywords.has('client')).toBe(true);
    expect(keywords.has('server')).toBe(true);
    expect(keywords.has('request')).toBe(true);
  });

  it('should accumulate weights for repeated terms', () => {
    const keywords = extractKeywords('client client client');
    expect(keywords.get('client')).toBe(9); // 3 * 3 (subject term weight)
  });
});

describe('extractRequirementLevel', () => {
  it('should extract MUST', () => {
    expect(extractRequirementLevel('The client MUST send a request')).toBe('MUST');
  });

  it('should extract MUST NOT before MUST', () => {
    expect(extractRequirementLevel('The client MUST NOT send a request')).toBe('MUST NOT');
  });

  it('should extract SHOULD', () => {
    expect(extractRequirementLevel('The server SHOULD respond quickly')).toBe('SHOULD');
  });

  it('should extract MAY', () => {
    expect(extractRequirementLevel('The client MAY cache responses')).toBe('MAY');
  });

  it('should return null when no level found', () => {
    expect(extractRequirementLevel('The client sends a request')).toBe(null);
  });

  it('should be case insensitive', () => {
    expect(extractRequirementLevel('the client must send')).toBe('MUST');
  });
});

describe('extractSubject', () => {
  it('should extract client', () => {
    expect(extractSubject('The client sends a request')).toBe('client');
  });

  it('should extract server', () => {
    expect(extractSubject('The server responds to requests')).toBe('server');
  });

  it('should extract implementation', () => {
    expect(extractSubject('An implementation should validate input')).toBe('implementation');
  });

  it('should return null when no subject found', () => {
    expect(extractSubject('This is a test')).toBe(null);
  });

  it('should return first subject found', () => {
    expect(extractSubject('The client sends to the server')).toBe('client');
  });
});

describe('scoreRequirementMatch', () => {
  it('should score higher for more keyword matches', () => {
    const keywords = extractKeywords('client request');
    const result = scoreRequirementMatch(sampleRequirements[0], keywords, null, null);

    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedKeywords).toContain('client');
    expect(result.matchedKeywords).toContain('request');
  });

  it('should add bonus for subject match', () => {
    const keywords = extractKeywords('client request');
    const withSubject = scoreRequirementMatch(sampleRequirements[0], keywords, 'client', null);
    const withoutSubject = scoreRequirementMatch(sampleRequirements[0], keywords, 'server', null);

    expect(withSubject.score).toBeGreaterThan(withoutSubject.score);
    expect(withSubject.subjectMatch).toBe(true);
    expect(withoutSubject.subjectMatch).toBe(false);
  });

  it('should add bonus for level match', () => {
    const keywords = extractKeywords('client request');
    const withLevel = scoreRequirementMatch(sampleRequirements[0], keywords, null, 'MUST');
    const withoutLevel = scoreRequirementMatch(sampleRequirements[0], keywords, null, 'SHOULD');

    expect(withLevel.score).toBeGreaterThan(withoutLevel.score);
    expect(withLevel.levelMatch).toBe(true);
    expect(withoutLevel.levelMatch).toBe(false);
  });

  it('should return zero score when no keywords match', () => {
    const keywords = extractKeywords('something completely different');
    const result = scoreRequirementMatch(sampleRequirements[0], keywords, null, null);

    expect(result.score).toBe(0);
    expect(result.matchedKeywords).toHaveLength(0);
  });
});

describe('detectConflicts', () => {
  it('should detect conflict when MAY contradicts MUST', () => {
    const statement = 'The client MAY not send a request';
    const conflicts = detectConflicts(statement, sampleRequirements);

    // Should detect conflict with MUST requirement for client
    const clientConflict = conflicts.find((c) => c.requirement.subject === 'client');
    expect(clientConflict).toBeDefined();
  });

  it('should not detect conflict for matching levels', () => {
    const statement = 'The client MUST send a message';
    const conflicts = detectConflicts(statement, sampleRequirements);

    // MUST vs MUST should not conflict
    expect(conflicts.length).toBe(0);
  });

  it('should return empty array when no level detected', () => {
    const statement = 'The client sends a request';
    const conflicts = detectConflicts(statement, sampleRequirements);

    expect(conflicts).toHaveLength(0);
  });

  it('should return empty array when no subject detected', () => {
    const statement = 'Something MUST happen';
    const conflicts = detectConflicts(statement, sampleRequirements);

    expect(conflicts).toHaveLength(0);
  });
});

describe('matchStatement', () => {
  it('should return matches sorted by score', () => {
    const result = matchStatement('The client sends a request', sampleRequirements);

    expect(result.matches.length).toBeGreaterThan(0);
    // Should be sorted by score descending
    for (let i = 1; i < result.matches.length; i++) {
      expect(result.matches[i - 1].score).toBeGreaterThanOrEqual(result.matches[i].score);
    }
  });

  it('should extract statement level and subject', () => {
    const result = matchStatement('The client MUST send data', sampleRequirements);

    expect(result.statementLevel).toBe('MUST');
    expect(result.statementSubject).toBe('client');
  });

  it('should limit results to maxResults', () => {
    const result = matchStatement('client server request response', sampleRequirements, {
      maxResults: 2,
    });

    expect(result.matches.length).toBeLessThanOrEqual(2);
  });

  it('should return empty matches for unrelated statement', () => {
    const result = matchStatement('something completely unrelated xyz abc', sampleRequirements);

    expect(result.matches).toHaveLength(0);
  });

  it('should include conflicts in result', () => {
    const result = matchStatement('The client MAY refuse to send', sampleRequirements);

    // May include conflicts if detected
    expect(Array.isArray(result.conflicts)).toBe(true);
  });
});
