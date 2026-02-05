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

// Semantic conflict detection tests
describe('detectConflicts - semantic analysis', () => {
  // WebSocket-style requirements for masking tests
  const maskingRequirements: Requirement[] = [
    {
      level: 'MUST',
      text: 'A client MUST mask all frames that it sends to the server.',
      section: '5.1',
      fullContext: 'A client MUST mask all frames that it sends to the server.',
      subject: 'client',
      action: 'mask all frames that it sends to the server',
    },
    {
      level: 'MUST NOT',
      text: 'A server MUST NOT mask any frames that it sends to the client.',
      section: '5.1',
      fullContext: 'A server MUST NOT mask any frames that it sends to the client.',
      subject: 'server',
      action: 'mask any frames that it sends to the client',
    },
  ];

  it('should detect conflict when statement contradicts MUST requirement (unmasked vs MUST mask)', () => {
    const statement = 'A WebSocket client sends unmasked frames to the server';
    const conflicts = detectConflicts(statement, maskingRequirements);

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].requirement.level).toBe('MUST');
    expect(conflicts[0].reason).toContain('contradicts');
  });

  it('should detect conflict when statement does what MUST NOT forbids (masks vs MUST NOT mask)', () => {
    const statement = 'The server masks all frames sent to the client';
    const conflicts = detectConflicts(statement, maskingRequirements);

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].requirement.level).toBe('MUST NOT');
    expect(conflicts[0].reason).toContain('forbids');
  });

  it('should not detect conflict for compliant statements', () => {
    // Client masks frames - compliant with MUST mask
    const statement1 = 'The client masks all frames before sending';
    const conflicts1 = detectConflicts(statement1, maskingRequirements);
    expect(conflicts1).toHaveLength(0);

    // Server does not mask frames - compliant with MUST NOT mask
    const statement2 = 'The server sends unmasked frames to the client';
    const conflicts2 = detectConflicts(statement2, maskingRequirements);
    expect(conflicts2).toHaveLength(0);
  });

  it('should detect conflict without explicit requirement level in statement', () => {
    // Statement has no MUST/SHOULD/MAY but contradicts a requirement
    const statement = 'The client sends frames without masking';
    const conflicts = detectConflicts(statement, maskingRequirements);

    // Should detect that this contradicts "client MUST mask"
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('should only detect conflicts for matching subjects', () => {
    // Statement about server should not conflict with client requirements
    const statement = 'The server sends unmasked data';
    const conflicts = detectConflicts(statement, maskingRequirements);

    // Server sending unmasked is NOT a conflict (MUST NOT mask applies to server)
    // Actually this is compliant since server MUST NOT mask
    expect(conflicts).toHaveLength(0);
  });
});

describe('detectConflicts - encryption negation patterns', () => {
  const encryptionRequirements: Requirement[] = [
    {
      level: 'MUST',
      text: 'The client MUST encrypt all data.',
      section: '3',
      subject: 'client',
      action: 'encrypt all data',
    },
    {
      level: 'MUST NOT',
      text: 'The server MUST NOT send unencrypted responses.',
      section: '4',
      subject: 'server',
      action: 'send unencrypted responses',
    },
  ];

  it('should detect conflict for unencrypted data vs MUST encrypt', () => {
    const statement = 'The client sends unencrypted data to the server';
    const conflicts = detectConflicts(statement, encryptionRequirements);

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].requirement.level).toBe('MUST');
  });
});

describe('matchStatement with semantic conflicts', () => {
  const requirements: Requirement[] = [
    {
      level: 'MUST',
      text: 'The client MUST validate all input.',
      section: '2',
      subject: 'client',
      action: 'validate all input',
    },
  ];

  it('should include semantic conflicts in matchStatement result', () => {
    const result = matchStatement('The client skips validation for performance', requirements);

    // Should have conflicts even without explicit requirement level
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('should return isValid-relevant info through conflicts', () => {
    const statement = 'The client does not validate user input';
    const result = matchStatement(statement, requirements);

    // Conflicts array indicates validity issues
    const hasConflict = result.conflicts.length > 0;
    expect(hasConflict).toBe(true);
  });
});
