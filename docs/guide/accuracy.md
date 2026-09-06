# Accuracy and limits

What each tool can and cannot report, and why. Everything here is taken from the development notes (`CLAUDE.md`) of v0.6.53.

## What the text fallback loses

RFCs numbered below 8650 have no official RFCXML. For those — and for RFC 8650 and later when the XML cannot be fetched for a reason other than 404 (5xx, timeout) — the server parses the plain text instead. Responses carry `_source` and `_sourceNote`.

Features that depend on XML structure lose precision on the text path:

| Tool                   | XML        | Text                                            | API supplement                             | Notes                                                                                                                                                                                                                                                  |
| ---------------------- | :--------: | :---------------------------------------------: | :----------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_rfc_structure`    | ✅ full    | ⚠️ hierarchy less precise                       | ✅ metadata                                | The API supplies abstract / authors. `category` / `stream` are present only when the API returned them (otherwise noted in `_sourceNote`). The publication date is taken from the document body.                                                       |
| `get_requirements`     | ✅ full    | ⚠️ extraction less precise                      | ❌ none                                    | Paragraph-based inference                                                                                                                                                                                                                              |
| `get_definitions`      | ✅ full    | ⚠️ extraction less precise                      | ❌ none                                    | No `<dl>`; inferred from `X: Y` and hanging-indent forms                                                                                                                                                                                               |
| `get_rfc_dependencies` | ✅ full    | ✅ good                                         | ✅ Datatracker `relateddocument`           | Read from the References section by the text parser when present, from the API otherwise                                                                                                                                                              |
| `get_related_sections` | ✅ full    | ⚠️ from `Section N` mentions in the body        | ❌ none                                    | Section-level cross references exist only in the body; the API does not have them                                                                                                                                                                      |
| `generate_checklist`   | ✅ full    | ⚠️ extraction less precise                      | ❌ none                                    | Goes through `get_requirements`, so the same limits apply                                                                                                                                                                                              |
| `validate_statement`   | ✅ full    | ⚠️ extraction less precise                      | ❌ none                                    | Same as above                                                                                                                                                                                                                                          |

::: info Legend
✅ full / ⚠️ limited (less precise) / ❌ not obtainable
:::

`_referencesSource` (only on `get_rfc_dependencies`):

- `'xml'` — extracted from the RFCXML `<references>`. Full anchor and title.
- `'text'` — extracted from the References section of the text body. Titles come from that section, so they are not placeholders. An RFC with a single references section (RFC 2616) puts everything under `informative`; only then is `_sourceNote` attached.
- `'api'` — from the Datatracker `relateddocument` API. Title and anchor are placeholders (`title: "RFC N"`, `anchor: "RFCN"`). Used when the body has no References section.

::: warning An empty result does not mean "no such requirement"
An empty result means "the RFC text did not yield a match in the requested scope", not "no such requirement exists". Requirement extraction is keyword based (RFC 2119 / RFC 8174): a requirement written without those keywords is not reported.
:::

## `validate_statement` is not a judge

`isValid` is three-valued:

| `isValid` | Meaning                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| `null`    | No requirement matched strongly enough to judge                                                 |
| `false`   | A contradiction was detected                                                                    |
| `true`    | No contradiction was detected among the matched requirements. Not a statement of compliance.    |

::: danger Do not treat `true` as proof of compliance
`true` means only that no contradiction was found among the matched requirements. Matching is an English-keyword approximation, and some forms — passive-voice prohibitions and paraphrased qualifiers, described below — cannot be detected as contradictions.
:::

Details of how the value is decided:

- The top match must reach both a minimum score and at least 2 content keywords (words other than the subject); otherwise `null`. A subject-only match reaches the score threshold but says nothing about what is being discussed, so it is not judged.
- Evidence for `false` may also come from the conflicting requirement: if a requirement listed in `conflicts` reaches the same thresholds, the result is `false` even when the top match alone would not. When `conflicts` is non-empty but no conflict reaches the thresholds, the result stays `null` and the note says that a contradiction exists but is below the threshold.
- The BCP 14 level of the statement is read only from upper-case keywords (RFC 8174). A lower-case "optional" gives `detectedLevel: null`.
- Contradiction detection looks only at the required action (the part after the keyword), not at the whole requirement sentence, so a negation in a condition clause is not mistaken for the required action.
- Contradiction requires that the statement's main verb is the prohibited act. "The server removes masking …" has the main verb *removes*, not *mask*.
- `VERB_SYNONYMS` is not exhaustive. For a verb not in the table no contradiction is detected, which is consistent with what `true` means (no contradiction found) and is not a claim of compliance.

::: details Prohibitions written in the passive voice (`MUST NOT be <past participle>`)
In `A reference identity of type CN-ID MUST NOT be used by clients.` the prohibited act is `be used by clients`; the body does not name who performs it. Contradiction detection asks whether the statement's subject performs that verb, so a statement that does perform it yields an empty `conflicts`. Returning `true` on that would answer "no contradiction" to a violating statement. Instead, a match of the form `MUST NOT be <past participle>` sets `isValid` to `null` and lists the requirement id in `suggestions`. A statement that is itself negative (`not` / `never` / `no` / `cannot`) states compliance and is not withdrawn. Measured on 40 machine-generated passive violations: `true` went from 13 to 4; among 179 sentences that follow the requirement, 4 were withdrawn.
:::

::: details Paraphrased qualifiers (`without` → `has no` / `lacks`)
RFC 9110 §6.6.1 has `An origin server with a clock MUST generate …` and `An origin server without a clock MUST NOT generate …`. What distinguishes the two is `with` / `without`, so the same-act check requires the same word in the statement. `… even though it has no clock.` does not contain `without`, so no contradiction was found and the result used to be `isValid: true`. Now, when ignoring the qualifier would produce a contradiction and the statement expresses the same negation (`no clock` / `does not have a clock` / `lacks a clock`), the result is `null`. The other branch (`with a clock`) is not withdrawn — that statement complies. Only `without` is handled; other qualifiers have no fixed paraphrase form. Of 1,668 prohibitions, 51 contain `without`.
:::

## The publication date comes from the body

::: info
Datatracker `document.time` is the time the record was last updated, not the publication date (RFC 9293 returns 2026-05-20; it was published 2022-08).
:::

The publication date is taken from `front/date` in RFCXML, and from the header lines on the text path. The Datatracker value is kept internally as `RFCMetadata.datatrackerUpdated` but is not returned by any tool.

## A table row is one requirement

When a keyword appears in a row of a figure or table, only **that one row** becomes the requirement. Table 3 of RFC 2131 §4.3.1 spans two pages; returning the whole paragraph put a 2,000-character "requirement" into `generate_checklist` four times, once per level.

::: details How `<table>` is handled on the XML path
The XML path applies the same rule to `<table>`: each body row (cells joined with `" | "`) becomes one requirement. Header rows are ignored (RFC 9293 §3.11 lists MUST / SHOULD / MAY in a header). A row whose keyword is followed only by `-\d` (a requirement-id label such as `MUST-14`) is not a requirement: RFC 9293 Appendix B has 110 rows like `Treat as unsigned number | MUST-1 | X | | | |`, and the label's level can differ from the marked column (`MUST-60` is marked in the MUST NOT column); the requirement itself comes from §3.1 and other body sections. `fullContext` is the header row plus that row; subject, condition and action are not attached. Among the 32 XML documents in the audit corpus none has a `<table>` with a keyword in a body row, so this path is verified by unit tests only.

Fields of ASN.1 type definitions (`keyIdentifier [0] KeyIdentifier OPTIONAL,`) are not prose and are not requirements.
:::

## What is checked before a release

Between v0.6.0 and v0.6.13, 13 defects were all found by trying the published package. None of them needed publishing; the same operation locally would have shown the same output. The following is run, in order, before every publish. Counts are as of v0.6.53 and go stale as tests are added; the source of truth is each file and the `npm test` output.

| Step                     | What it looks at                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `npm test`               | Written conditions that stopped holding (622 unit tests)                                      |
| `npm run test:e2e`       | Behaviour as seen from an MCP client (76 checks)                                              |
| `npm run audit`          | Places that break on unexpected formatting (171 RFCs × 51 invariants)                         |
| `npm run crosscheck`     | Disagreement between outputs of different tools (171 RFCs × 14 checks, X1–X14)                |
| `npm run snapshot`       | Visible breakage that cannot be expressed as a condition (38 recorded outputs)                |
| Trial via `rfcxml-mcp-dev` | What only real use shows                                                                   |

CI runs only part of this. `ci.yml` runs `lint` → `format:check` → `npm test` → `build` → `npm run test:e2e` on every push and pull request. `publish.yml` runs `npm test` → `npm run build` → `npm run test:e2e` before publishing. `audit.yml` runs `audit` → `crosscheck` → `snapshot` weekly (Monday 00:00 UTC) and on `workflow_dispatch`, with `tests/audit/.cache` kept in `actions/cache`. It exists because between 0.6.41 and 0.6.45 the audit had silently stopped running locally. A weekly pass does not replace running it locally before a publish.

The recorded outputs of `npm run snapshot` are the ones shown on [Output examples](/reference/examples).
