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
  identifiersOf,
  matchStatement,
  requiredActionOf,
  isSubjectTerm,
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
    // 理由文は「主張側のどの否定表現が、要求側のどの動詞に反するか」を名指しする
    expect(conflicts[0].reason).toContain('unmask');
    expect(conflicts[0].reason).toContain('requires "mask"');
  });

  it('should not flag a conflict from an incidental negation inside the requirement text', () => {
    // RFC 6455 §4.2.1 の形。条件節に "did not send" があるが、要求アクションは
    // "stop processing ..." であって「送る」ことではない。
    // 以前は req.text 全体を見ていたため、"sends" を含む主張と誤って矛盾した。
    const requirements: Requirement[] = [
      {
        level: 'MUST',
        text: 'If the server finds that the client did not send a handshake that matches the description below, the server MUST stop processing the handshake and return an HTTP response with an appropriate error code.',
        section: '4.2.1',
        fullContext: '',
        subject: 'server',
        action:
          'stop processing the handshake and return an HTTP response with an appropriate error code',
      },
    ];

    const conflicts = detectConflicts(
      'The server sends unmasked frames to the client',
      requirements
    );

    expect(conflicts).toHaveLength(0);
  });

  it('should not flag a conflict when the requirement has no parsed action', () => {
    // action を解析できなかった要件は、否定表現の実一致を判定できないので対象外
    const requirements: Requirement[] = [
      {
        level: 'MUST',
        text: 'If the server finds that the client did not send a handshake, processing stops.',
        section: '4.2.1',
        fullContext: '',
        subject: 'server',
      },
    ];

    const conflicts = detectConflicts(
      'The server sends unmasked frames to the client',
      requirements
    );

    expect(conflicts).toHaveLength(0);
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

describe('一般的な動詞での誤検出', () => {
  it('動詞が send で一致しただけの矛盾を報告しない', () => {
    // RFC 6455 §4 の形。禁止されているのは「Sec-WebSocket-Protocol ヘッダを送り返す」
    // ことであって、フレームを送ること一般ではない。
    const requirements: Requirement[] = [
      {
        level: 'MUST NOT',
        text: 'The server MUST NOT send back a |Sec-WebSocket-Protocol| header field in its response.',
        section: '4',
        fullContext: '',
        subject: 'server',
        action: 'send back a |Sec-WebSocket-Protocol| header field in its response',
      },
    ];

    const conflicts = detectConflicts(
      'The server sends unmasked frames to the client',
      requirements
    );

    expect(conflicts).toHaveLength(0);
  });

  it('動詞が具体的なら目的語が共通していなくても矛盾を報告する', () => {
    // "validate" は動詞自体が具体的なので、目的語の共通は求めない
    const requirements: Requirement[] = [
      {
        level: 'MUST',
        text: 'The client MUST validate all input.',
        section: '2',
        fullContext: '',
        subject: 'client',
        action: 'validate all input',
      },
    ];

    const conflicts = detectConflicts('The client skips validation for performance', requirements);

    expect(conflicts.length).toBeGreaterThan(0);
  });
});

describe('requiredActionOf', () => {
  it('action が無いときはキーワード直後を切り出す', () => {
    const requirement: Requirement = {
      level: 'MUST',
      // RFC 本文は折り返されるため action の解析が失敗しやすい
      text: 'discussed in Section 10.3, a client MUST mask all frames that it\n   sends to the server.',
      section: '5.1',
      fullContext: '',
    };

    expect(requiredActionOf(requirement)).toBe('mask all frames that it\n   sends to the server.');
  });

  it('MUST は MUST NOT の一部を指さない', () => {
    const requirement: Requirement = {
      level: 'MUST',
      text: 'A server MUST NOT mask frames, and a client MUST mask them.',
      section: '5.1',
      fullContext: '',
    };

    expect(requiredActionOf(requirement)).toBe('mask them.');
  });

  it('キーワードが見つからなければ null', () => {
    const requirement: Requirement = {
      level: 'MUST',
      text: 'This sentence has no keyword.',
      section: '1',
      fullContext: '',
    };

    expect(requiredActionOf(requirement)).toBeNull();
  });
});

describe('機能語の除外', () => {
  it('3 文字以上の機能語をキーワードに数えない', () => {
    const keywords = extractKeywords('The server sends data and closes the connection');

    expect([...keywords.keys()]).not.toContain('and');
    expect([...keywords.keys()]).not.toContain('the');
    expect([...keywords.keys()]).toContain('server');
    expect([...keywords.keys()]).toContain('sends');
  });

  it('BCP 14 キーワードを内容語として数えない', () => {
    // ほぼ全ての要件文に現れるため、内容の一致の証拠にならない。
    // レベルの一致は LEVEL_MATCH_BONUS が別に見ている。
    const keywords = extractKeywords('The client MUST NOT send unmasked frames');

    expect([...keywords.keys()]).not.toContain('must');
    expect([...keywords.keys()]).not.toContain('not');
    expect([...keywords.keys()]).toContain('unmasked');
  });

  it('主語語かどうかを判定できる', () => {
    expect(isSubjectTerm('client')).toBe(true);
    expect(isSubjectTerm('Server')).toBe(true);
    expect(isSubjectTerm('frames')).toBe(false);
  });
});

describe('主語の単複', () => {
  // RFC 9114 §6.2.3。主語が複数形で書かれている。
  const reservedStreams: Requirement[] = [
    {
      id: 'R-6.2.3-154',
      level: 'MUST NOT',
      text: 'Endpoints MUST NOT consider these streams to have any meaning upon receipt.',
      section: '6.2.3',
      sectionTitle: 'Reserved Stream Types',
      fullContext: 'Endpoints MUST NOT consider these streams to have any meaning upon receipt.',
      subject: 'endpoints',
      action: 'consider these streams to have any meaning upon receipt',
    },
  ];

  it('複数形の主語を単数形の主張と突き合わせる', () => {
    const result = scoreRequirementMatch(
      reservedStreams[0],
      extractKeywords('An endpoint treats a reserved stream type as having a defined meaning.'),
      'endpoint',
      null
    );

    expect(result.subjectMatch).toBe(true);
  });

  it('複数形で書かれた主張からも主語を取る', () => {
    expect(extractSubject('Endpoints treat reserved streams as meaningful.')).toBe('endpoint');
  });

  it('単数形の主語語を、複数形の別の語より先に採る', () => {
    // RFC 6455 §5.1。"proxies" を先に単数形化すると、この要件の主語が
    // client ではなく proxy になり、主語で照合する矛盾検出から外れる。
    const text =
      'To avoid confusing network intermediaries (such as intercepting proxies), a client MUST mask all frames that it sends to the server.';

    expect(extractSubject(text)).toBe('client');
  });
});

describe('禁じられた行為を述べている主張', () => {
  const reservedStreams: Requirement[] = [
    {
      id: 'R-6.2.3-154',
      level: 'MUST NOT',
      text: 'Endpoints MUST NOT consider these streams to have any meaning upon receipt.',
      section: '6.2.3',
      sectionTitle: 'Reserved Stream Types',
      fullContext: 'Endpoints MUST NOT consider these streams to have any meaning upon receipt.',
      subject: 'endpoints',
      action: 'consider these streams to have any meaning upon receipt',
    },
  ];

  it('動詞が入れ替わっていても矛盾として挙げる', () => {
    // consider → treat。NEGATION_PAIRS には無い組み合わせ。
    const conflicts = detectConflicts(
      'An endpoint treats a reserved stream type as having a defined meaning upon receipt.',
      reservedStreams
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].requirement.id).toBe('R-6.2.3-154');
    expect(conflicts[0].reason).toContain('forbids');
  });

  it('禁止に従っている主張は挙げない', () => {
    const conflicts = detectConflicts(
      'An endpoint ignores reserved stream types upon receipt.',
      reservedStreams
    );

    expect(conflicts).toHaveLength(0);
  });

  it('否定を含む主張は挙げない', () => {
    const conflicts = detectConflicts(
      'An endpoint does not treat a reserved stream type as having any meaning upon receipt.',
      reservedStreams
    );

    expect(conflicts).toHaveLength(0);
  });

  it('禁じられた動詞が主張に無ければ挙げない', () => {
    // "The server sends frames to the client." は frames / sends / client が
    // 重なるが、禁じられているのは mask することである。
    const forbidMasking: Requirement[] = [
      {
        id: 'R-5.1-82',
        level: 'MUST NOT',
        text: 'A server MUST NOT mask any frames that it sends to the client.',
        section: '5.1',
        sectionTitle: 'Overview',
        fullContext: 'A server MUST NOT mask any frames that it sends to the client.',
        subject: 'a server',
        action: 'mask any frames that it sends to the client',
      },
    ];

    const conflicts = detectConflicts('The server sends frames to the client.', forbidMasking);

    expect(conflicts).toHaveLength(0);
  });
});

describe('要求アクションの主動詞', () => {
  it('目的語の中の動詞を要求アクションと取り違えない', () => {
    // RFC 6455 §6.2。求めているのは masking を remove することであって、
    // mask することではない。"sends unmasked frames" と矛盾しない。
    const removeMasking: Requirement[] = [
      {
        id: 'R-6.2-146',
        level: 'MUST',
        text: 'A server MUST remove masking for data frames received from a client as described in Section 5.3.',
        section: '6.2',
        sectionTitle: 'Receiving Data',
        fullContext:
          'A server MUST remove masking for data frames received from a client as described in Section 5.3.',
        subject: 'a server',
        action: 'remove masking for data frames received from a client as described in Section 5.3',
      },
    ];

    const conflicts = detectConflicts(
      'The server sends unmasked frames to the client.',
      removeMasking
    );

    expect(conflicts).toHaveLength(0);
  });
});

describe('同じ事柄についての矛盾か', () => {
  it('要件に固有の名前があれば、主張にもあることを求める', () => {
    // "send a MAX_PUSH_ID frame" と「GOAWAY フレームを送る」は、
    // send と frame が重なるだけで別の行為である。
    const maxPushId: Requirement[] = [
      {
        id: 'R-7.2.7-215',
        level: 'MUST NOT',
        text: 'A server MUST NOT send a MAX_PUSH_ID frame.',
        section: '7.2.7',
        sectionTitle: 'MAX_PUSH_ID',
        fullContext: 'A server MUST NOT send a MAX_PUSH_ID frame.',
        subject: 'a server',
        action: 'send a MAX_PUSH_ID frame',
      },
    ];

    expect(
      detectConflicts('A server sends a GOAWAY frame to initiate a graceful shutdown.', maxPushId)
    ).toHaveLength(0);

    expect(
      detectConflicts('A server sends a MAX_PUSH_ID frame on its control stream.', maxPushId)
    ).toHaveLength(1);
  });

  it('限定付きの禁止は、限定語が主張にあるときだけ挙げる', () => {
    // 禁じているのは「理由なく閉じること」であって、閉じること自体ではない。
    const arbitrary: Requirement[] = [
      {
        id: 'R-7.3-171',
        level: 'SHOULD NOT',
        text: 'Clients SHOULD NOT close the WebSocket connection arbitrarily.',
        section: '7.3',
        sectionTitle: 'Normal Closure of Connections',
        fullContext: 'Clients SHOULD NOT close the WebSocket connection arbitrarily.',
        subject: 'clients',
        action: 'close the WebSocket connection arbitrarily',
      },
    ];

    expect(
      detectConflicts('The client closes the connection when it detects a masked frame.', arbitrary)
    ).toHaveLength(0);

    expect(
      detectConflicts('The client closes the WebSocket connection arbitrarily.', arbitrary)
    ).toHaveLength(1);
  });

  it('条件が食い違う要件は挙げない', () => {
    // 接続を確立する手順の要件と、マスク検出時に閉じる記述は場面が違う。
    const establish: Requirement[] = [
      {
        id: 'R-4.1-20',
        level: 'MUST',
        text: "When the client is to establish a WebSocket connection, it MUST open a connection, send an opening handshake, and read the server's handshake in response.",
        section: '4.1',
        sectionTitle: 'Client Requirements',
        fullContext: '',
        subject: 'client',
        condition: 'the client is to establish a WebSocket connection',
        action:
          "open a connection, send an opening handshake, and read the server's handshake in response",
      },
    ];

    expect(
      detectConflicts('The client closes the connection when it detects a masked frame.', establish)
    ).toHaveLength(0);
  });

  it('主張の主動詞がその行為であることを求める', () => {
    // "removes masking" の主動詞は removes であって mask ではない。
    const forbidMasking: Requirement[] = [
      {
        id: 'R-5.1-82',
        level: 'MUST NOT',
        text: 'A server MUST NOT mask any frames that it sends to the client.',
        section: '5.1',
        sectionTitle: 'Overview',
        fullContext: 'A server MUST NOT mask any frames that it sends to the client.',
        subject: 'a server',
        action: 'mask any frames that it sends to the client',
      },
    ];

    expect(
      detectConflicts(
        'The server removes masking for data frames received from a client.',
        forbidMasking
      )
    ).toHaveLength(0);

    expect(
      detectConflicts('The server masks the frames that it sends to the client.', forbidMasking)
    ).toHaveLength(1);
  });
});

describe('identifiersOf', () => {
  it('フレーム名やメソッド名を固有の名前として取る', () => {
    expect(identifiersOf('send a MAX_PUSH_ID frame')).toEqual(['MAX_PUSH_ID']);
    expect(identifiersOf('send content in a TRACE request')).toEqual(['TRACE']);
  });

  it('一般的な略語と角括弧の引用は取らない', () => {
    expect(identifiersOf('run through the encrypted tunnel [RFC5246]')).toEqual([]);
    expect(identifiersOf('parse an HTTP message over TCP')).toEqual([]);
  });
});

describe('固有の名前の形', () => {
  it('ハイフンでつないだフィールド名を取る', () => {
    expect(identifiersOf('send a Content-Length header field in any response')).toContain(
      'Content-Length'
    );
    expect(identifiersOf('send back a Sec-WebSocket-Protocol header field')).toContain(
      'Sec-WebSocket-Protocol'
    );
  });

  it('フィールドを名指しする頭大文字の語を取る', () => {
    expect(identifiersOf('generate a Date header field')).toContain('Date');
    expect(identifiersOf('generate a Server header field containing detail')).toContain('Server');
  });

  it('状態符号を取る', () => {
    expect(identifiersOf('send a 1xx response to an HTTP/1.0 client')).toContain('1xx');
    expect(identifiersOf('send a Close frame with status code 1002')).toContain('1002');
  });

  it('語の内側のアンダースコアだけを名前とみなす', () => {
    // RFC 6455 は本文で定義語を `_Establish a WebSocket Connection_` と囲む。
    expect(identifiersOf('open a connection to _Establish a WebSocket Connection_')).toEqual([]);
    expect(identifiersOf('send a MAX_PUSH_ID frame')).toEqual(['MAX_PUSH_ID']);
  });
});

describe('名前と限定は要件文全体から取る', () => {
  it('主語句に置かれた限定を見る', () => {
    // 禁じられているのは「時計を持たない」オリジンサーバの場合だけである。
    const withoutClock: Requirement[] = [
      {
        id: 'R-6.6.1-87',
        level: 'MUST NOT',
        text: 'An origin server without a clock MUST NOT generate a Date header field.',
        section: '6.6.1',
        sectionTitle: 'Date',
        fullContext: 'An origin server without a clock MUST NOT generate a Date header field.',
        action: 'generate a Date header field',
      },
    ];

    expect(
      detectConflicts(
        'An origin server generates a Date header field in its responses.',
        withoutClock
      )
    ).toHaveLength(0);
  });

  it('限定語が主張にもあれば挙げる', () => {
    const needlessDetail: Requirement[] = [
      {
        id: 'R-10.2.4-258',
        level: 'SHOULD NOT',
        text: 'An origin server SHOULD NOT generate a Server header field containing needlessly fine-grained detail.',
        section: '10.2.4',
        sectionTitle: 'Server',
        fullContext: '',
        subject: 'server',
        action: 'generate a Server header field containing needlessly fine-grained detail',
      },
    ];

    expect(
      detectConflicts('An origin server generates a Server header field.', needlessDetail)
    ).toHaveLength(0);

    expect(
      detectConflicts(
        'An origin server generates a Server header field containing needlessly fine-grained detail.',
        needlessDetail
      )
    ).toHaveLength(1);
  });

  it('キーワードより前に置かれた適用対象の名前を見る', () => {
    const headOnly: Requirement[] = [
      {
        id: 'R-9.3.2-188',
        level: 'MUST NOT',
        text: 'The HEAD method is identical to GET except that the server MUST NOT send content in the response.',
        section: '9.3.2',
        sectionTitle: 'HEAD',
        fullContext: '',
        subject: 'server',
        action: 'send content in the response',
      },
    ];

    expect(
      detectConflicts('A server sends a 100 Continue response before the final response.', headOnly)
    ).toHaveLength(0);
  });
});

describe('否定の言い回しは動詞ごとに揃える', () => {
  const closureAlert: Requirement[] = [
    {
      id: 'R-2.2.1-17',
      level: 'MUST',
      text: 'Clients MUST send a closure alert before closing the connection.',
      section: '2.2.1',
      sectionTitle: 'Client Behavior',
      fullContext: 'Clients MUST send a closure alert before closing the connection.',
      subject: 'clients',
      action: 'send a closure alert before closing the connection',
    },
  ];

  it('"without ..." の形を矛盾として挙げる', () => {
    // negative の手書きが動詞ごとに揃っておらず、mask には "without mask" が
    // あるのに send には無かった。
    const conflicts = detectConflicts(
      'The client closes the connection without sending a close_notify alert.',
      closureAlert
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].requirement.id).toBe('R-2.2.1-17');
  });

  it('要求どおりの記述は挙げない', () => {
    const conflicts = detectConflicts(
      'The client sends a closure alert before closing the connection.',
      closureAlert
    );

    expect(conflicts).toHaveLength(0);
  });
});

describe('限定句を挟んだ主張', () => {
  const requirement = {
    id: 'R-6.6.1-76',
    level: 'MUST NOT' as const,
    section: '6.6.1',
    sectionTitle: 'Date',
    text: 'An origin server without a clock MUST NOT generate a Date header field.',
    fullContext: '',
    subject: 'origin server',
    action: 'generate a Date header field',
  };

  it('要件の条件を書き写した主張を違反として挙げる', () => {
    // 主語と動詞のあいだに "without a clock" が入る。文全体で否定を探すと、
    // この "without" を行為の否定と取って違反を見逃していた。
    const result = matchStatement(
      'An origin server without a clock generates a Date header field.',
      [requirement]
    );

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].requirement.id).toBe('R-6.6.1-76');
  });

  it('条件が違う主張は違反にしない', () => {
    const result = matchStatement('An origin server with a clock generates a Date header field.', [
      requirement,
    ]);

    expect(result.conflicts).toEqual([]);
  });

  it('目的語の中の語を動詞と取り違えない', () => {
    // "The server removes masking …" の "masking" を動詞と取ると、
    // 「サーバはマスクしてはならない」に違反していると誤って報告する。
    const masking = {
      id: 'R-5.1-69',
      level: 'MUST NOT' as const,
      section: '5.1',
      sectionTitle: 'Overview',
      text: 'A server MUST NOT mask any frames that it sends to the client.',
      fullContext: '',
      subject: 'server',
      action: 'mask any frames that it sends to the client',
    };
    const result = matchStatement(
      'The server removes masking for data frames received from a client.',
      [masking]
    );

    expect(result.conflicts).toEqual([]);
  });
});
