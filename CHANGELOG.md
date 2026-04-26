# Changelog

All notable changes to this project will be documented in this file.

## [0.5.2] - 2026-04-27

v0.5.1 のテキストフォールバック時のラベル不整合バグを修正し、Issue #5 と
合わせてテキストフォールバック時の機能制約を明文化。

### Fixed

- **`_referencesSource` のラベル不整合 (`get_rfc_dependencies`)**:
  - v0.5.1 ではテキストパーサが参照を抽出していても `_referencesSource: 'xml'` と返してしまっていた。
  - また `_sourceNote` が「Reference information is not available」と誤主張するケースがあった。
  - 修正後は `'xml' | 'text' | 'api'` の三値で実際の取得元を正確に表す。
  - `_sourceNote` は本当に refs が空のときと、テキスト由来でプレースホルダ titles/anchors のときだけ出すように整理。

### Changed

- **`DependencyResult._referencesSource` 型拡張**: `'xml' | 'api'` → `'xml' | 'text' | 'api'`。
  既存コードで `=== 'api'` だけを判定していた呼び出し元は影響なし。`=== 'xml'` を否定形で扱っていた箇所はレビュー推奨。
- **依存解決の優先順位**:
  1. body (xml/text) で refs があれば本文由来を優先（titles/anchors の質が高い）
  2. body の refs が空のときだけ Datatracker API を呼ぶ
  - v0.5.1 では body=text のとき常に API も呼んでいたが、上書きはせず無駄なリクエストを発生させていた挙動を整理。

### Added

- **テキストフォールバック時の機能制約マトリクス** (`CLAUDE.md`):
  - 各ツールが XML / text / API でどこまで動くかを表で明文化。
  - Issue #5 (`get_related_sections` の text 形式制約) を known limitation として記載。

## [0.5.1] - 2026-04-27

discussion #6 を踏まえた IETF Datatracker API のカバレッジ強化と、
オフライン運用向けのディスクキャッシュ層追加。Phase 1 から Phase 3 まで順に実装。

### Added — Phase 3: disk cache + prefetch CLI

The MCP runtime can now read from and write to a persistent on-disk RFCXML cache, enabling offline / CI-pinned operation. The cache is opt-in via the `RFCXML_CACHE_DIR` environment variable.

- **`utils/disk-cache.ts`** — `DiskCache` class. File layout: `<RFCXML_CACHE_DIR>/xml/rfc{N}.xml`. Errors on read/write are logged but never thrown (best-effort layer).
- **`fetchRFCXML` cache hierarchy:**
  1. in-memory LRU (`xmlCache`) — unchanged
  2. on-disk cache (`DiskCache`) — new, opt-in via env var
  3. parallel network fetch — unchanged
  - Fresh network results are written back to both layers.
  - New `forceFresh` option to bypass both caches (used by the prefetch CLI).
- **`bin/rfcxml-prefetch` CLI** (`src/cli/prefetch.ts`):
  - `--range A-B` / `--rfc N` (repeatable) for selecting RFCs.
  - `--cache-dir DIR` (default `$RFCXML_CACHE_DIR` or `~/.cache/rfcxml-mcp`).
  - `--concurrency N` (default 3 — be polite to RFC Editor).
  - `--force` to redownload existing entries.
  - Uses the same `fetchRFCXML` pipeline as the runtime, so source-priority and validation match exactly.
  - Added to `package.json` `bin` so `npx @shuji-bonji/rfcxml-mcp` users get `rfcxml-prefetch` automatically. Also exposed as `npm run prefetch`.

### Added — Phase 2: API metadata wiring

`fetchRFCMetadata` was previously dead code. Phase 2 wires it into `handleGetRFCStructure` so the metadata block returned by `get_rfc_structure` is now enriched with Datatracker-derived `category` / `stream` / `date` / `abstract`, and optionally `authors`.

- **`get_rfc_structure` tool input:**
  - New `includeAuthors?: boolean` (default false). When true, resolves authors via the documentauthor + person APIs.
- **`handleGetRFCStructure`:**
  - Now fetches RFC body and Datatracker metadata in parallel (`Promise.all`).
  - Merges: XML body wins for `title` / `docName` / `number`; API wins for everything else.
  - On API failure, falls back gracefully to the minimal metadata shape that `fetchRFCMetadata` already provides.

### Added — Phase 1: IETF Datatracker API coverage

Background: discussion #6 pointed out that IETF officially provides three retrieval layers (REST API / bulk download / rsync) but this MCP only exercised a thin slice of the API layer. Phase 1 thickens the API layer; bulk DL is now handled by the Phase 3 prefetch CLI; rsync remains intentionally out of scope.

- **`fetchReferences(rfcNumber)`** in `rfc-fetcher.ts`
  - Fetches the RFCs that this RFC references (normative + informative) via Datatracker `relateddocument?source__name=rfcN`.
  - Sister of the existing `fetchReferencedBy`. Filters out BCP/STD aliases — only real RFC targets are returned.
  - Why: gives `get_rfc_dependencies` a structured fallback for old RFCs (< 8650) where no XML body exists. Previously these returned empty references with a "not available" note.
- **`fetchAuthors(rfcNumber)`** in `rfc-fetcher.ts`
  - Resolves authors via `documentauthor` API and joins to the `person` endpoint for fullnames.
  - Per-process `personCache` (LRU 500) so the same author across multiple RFCs is fetched once.
- **`fetchDocEvents(rfcNumber, limit?)`** in `rfc-fetcher.ts`
  - Fetches recent document events (publication, sync, errata-tagging, etc.) via `docevent` API.
- **`fetchRFCMetadata` options:**
  - New `includeAuthors` flag — when true, fetches the documentauthor list in parallel with the document core call. Default false to keep the base call cheap.
- **New `DATATRACKER_API` endpoints in `config.ts`:**
  - `documentAuthor`, `docEvent`, `references` (sister of `referencedBy`).

### Changed

- **`get_rfc_dependencies` result shape:**
  - Added `_referencesSource: 'xml' | 'api'`.
  - When XML provides references, `_referencesSource = 'xml'` (unchanged behavior).
  - When XML body is text-only **or** XML extraction yielded no references, the handler now falls back to `fetchReferences` and returns API-derived entries with `_referencesSource = 'api'`.
  - The "References not available" warning is replaced with a more accurate note when API fallback is used.
- **Pruned deprecated XML/text source URLs** in `RFC_XML_SOURCES` / `RFC_TEXT_SOURCES`:
  - Removed `xml2rfc.ietf.org/public/rfc/...` (storage was consolidated into RFC Editor).
  - Removed `tools.ietf.org/rfc/rfcN.txt` (retired in 2021, only 301-redirects to rfc-editor.org).
  - Net effect: the parallel race no longer duplicates requests against the same backend.

### Fixed

- **`mapCategory` / `mapStream` URI normalization in `rfc-fetcher.ts`:**
  - Datatracker returns `std_level` and `stream` as URIs (e.g., `/api/v1/name/stdlevelname/std/`). The previous string-comparison logic silently fell through to `'info'` / `'IETF'` for **every RFC**. Now a trailing-slug extractor handles both URI form and the legacy human-readable form.

## [0.5.0] - 2026-04-23

### Added

- **`includeReferencedBy` implementation** in `get_rfc_dependencies`
  - Fetches RFCs that reference the given RFC via IETF Datatracker `RelatedDocument` API
  - Filters to published RFCs only (excludes drafts)
  - Returns normative (`refnorm`) and informative (`refinfo`) relationship types
  - New `fetchReferencedBy()` function in `rfc-fetcher.ts`
  - New `ReferencedByEntry` type in `types/index.ts`
  - New `DATATRACKER_API.referencedBy` endpoint in `config.ts`
  - Graceful fallback: returns empty array on API failure

### Changed

- **`@modelcontextprotocol/sdk` updated**: 1.26.0 → 1.29.0
- **Test scripts reorganized** in `package.json`
  - `npm test` now runs single-pass (`vitest --run`) instead of watch mode
  - Added `npm run test:watch` for development watch mode
  - Added `npm run test:coverage` for coverage reporting
- **CI improvements** (`.github/workflows/ci.yml`)
  - Added Node.js 20 + 22 matrix for test and build jobs
  - Lint runs on Node.js 22 only
- **Trusted Publisher support** (`.github/workflows/publish.yml`)
  - Added `permissions.id-token: write` for OIDC-based npm provenance
  - Added `environment: npm` for GitHub Environment protection
  - Added `--provenance` flag to `npm publish`
  - Added Node.js 20 + 22 matrix for test job
  - Consolidated redundant build job into publish job

## [0.4.7] - 2026-04-15

### Documentation

- **README.md / README.ja.md**: Corrected Claude Code MCP configuration paths
  - Removed incorrect `.claude/settings.json` and `claude settings` references
  - Added correct locations: `.mcp.json` (project scope), `~/.claude.json` (user scope), and `claude mcp add` CLI command
- **README.md / README.ja.md**: Split bash and JSON code blocks in the global install example for cleaner copy-paste
- **README.md**: Synchronized `_sourceNote` sample string with the actual implementation (`Warning: Parsed from text format. Accuracy may be limited.`)
- **README.md / README.ja.md**: Updated `src/` directory tree to include `rfc-service.ts`, `logger.ts`, `statement-matcher.ts`, and `requirement-extractor.ts`
- **README.md / README.ja.md**: Clarified test commands — distinguished watch mode (`npm test`) from single-run (`npm test -- --run`) and added `npm run test:e2e`
- **CLAUDE.md**: Slimmed down from ~490 lines to 275 lines by extracting cross-MCP common patterns to a dedicated skill and removing duplicated history already tracked in CHANGELOG

### Internal

- Added `.claude/` to `.gitignore` (Claude Code local settings are user-specific)

No code changes in this release — source artifacts identical to 0.4.6.

## [0.4.6] - 2026-02-16

### Changed

- Version bump to 0.4.6

## [0.4.5] - 2026-02-05

### Fixed

- **Critical: `<bcp14>` tag processing bug** in `get_requirements` and `generate_checklist`
  - BCP 14 keywords (MUST, SHOULD, MAY, etc.) wrapped in `<bcp14>` tags were being dropped from extracted text
  - Example: "A TCP implementation `<bcp14>`MUST`</bcp14>` support..." was extracted as "A TCP implementation support..."
  - Added `normalizeBcp14Tags()` preprocessing step to convert `<bcp14>MUST</bcp14>` to `MUST` before XML parsing
  - Keywords now appear in correct position within extracted requirement text

- **Critical: `validate_statement` semantic verification** - conflict detection now works
  - Previously returned `isValid: true` even for obvious RFC violations
  - Added semantic negation pattern detection (mask/unmasked, encrypt/unencrypted, validate/skip validation)
  - New helper functions: `hasPositiveAction()`, `hasNegativeAction()`, `actionsContradict()`
  - Example: "client sends unmasked frames" now correctly conflicts with "client MUST mask"
  - Example: "server masks frames" now correctly conflicts with "server MUST NOT mask"
  - Fixed false positive detection for incidental verb mentions (e.g., "sends" in "MUST NOT mask...sends")

### Added

- **New tests**: 24 additional tests
  - 3 tests for `<bcp14>` tag normalization in `rfcxml-parser.test.ts`
  - 8 tests for semantic conflict detection in `statement-matcher.test.ts`
  - 3 tests for `<xref>` extraction in `rfcxml-parser.test.ts`
  - 10 tests for requirement filtering in `requirement-extractor.test.ts`
  - Total test count: 150 tests (up from 126)

### Changed

- **Negation pattern expansion**: Added more negative patterns for better detection
  - `validate`: added "skips validation", "no validation"
  - `encrypt`: added "without encryption"
  - `authenticate`: added "skip authentication"
  - `mask`: added "without masking"

- **`get_related_sections` now returns cross-references**
  - Added `<xref>` tag extraction from RFCXML
  - Extracts both section references (`<xref target="section-3.5"/>`) and RFC references (`<xref target="RFC2119"/>`)
  - Combined with existing text pattern detection ("Section X.Y")

- **`generate_checklist` improvements**
  - Now supports multiple sections in `sections` array (previously only first was used)
  - Added `includeSubsections` option (default: true) to include subsections when filtering
  - Section filter now supports both formats: `section-3.5` (XML) and `3.5` (plain)

- **Text fallback improvements**
  - Added RFC reference extraction from text (detected as informative references)
  - Improved section header detection heuristics to reduce false positives
  - Status codes (1000, 1001) and numbered list items no longer detected as sections
  - Validates section titles against common RFC section keywords

- **Section number format normalization**
  - `get_requirements` now accepts both `section-3.5` and `3.5` formats
  - Automatic `section-` prefix stripping for consistent filtering

## [0.4.4] - 2026-02-05

### Added

- **Weighted matching for `validate_statement`**: Improved matching accuracy
  - New `src/utils/statement-matcher.ts` module with keyword weighting system
  - Technical terms (client, server, etc.) get higher weight than regular words
  - Subject detection (client/server/sender/receiver) with match bonus
  - Requirement level detection and conflict detection
  - `MATCHING_WEIGHTS` and `MATCHING_LIMITS` constants for tuning

- **Test coverage expansion**: 75 new tests
  - `src/utils/cache.test.ts` - 16 tests for LRUCache
  - `src/utils/validation.test.ts` - 30 tests for RFC number validation
  - `src/utils/statement-matcher.test.ts` - 29 tests for weighted matching
  - Total test count: 126 tests (up from 51)

### Changed

- **`_sourceNote` pattern simplification**: Reduced code duplication
  - New `getSourceNoteIfText()` helper in `rfc-service.ts`
  - 7 repetitive patterns in `handlers.ts` consolidated to single function call

- **TypeScript type safety improvements**: Eliminated `any` type warnings
  - Added `XmlNode` type alias and `RfcXml` interface in `rfcxml-parser.ts`
  - Reduced eslint-disable comments to minimum required (2 necessary cases)

- **Constants extraction**: Magic numbers replaced with named constants
  - `METADATA_EXTRACTION` and `DEFINITION_EXTRACTION` in `rfc-text-parser.ts`
  - `MATCHING_WEIGHTS` and `MATCHING_LIMITS` in `statement-matcher.ts`

### Fixed

- **Error logging in `fetchRFCMetadata`**: Added `logger.warn` call in catch block
  - Previously failed silently, now logs warning with error details

## [0.4.3] - 2026-02-03

### Changed

- **Service layer refactoring**: Improved separation of concerns
  - Extracted RFC parsing logic to `src/services/rfc-service.ts`
  - `getParsedRFC()`, `clearParseCache()`, and `getTextSourceNote()` moved from handlers
  - Handlers now only handle request/response transformation

- **Logger abstraction**: Centralized logging for future extensibility
  - New `src/utils/logger.ts` module
  - Replaced direct `console.error` calls with `logger.info/warn/error`
  - Supports DEBUG environment variable for verbose output

- **Constants consolidation**: Magic numbers extracted to named constants
  - Added `RFC_NUMBER_LIMITS.MIN/MAX` to `src/constants.ts`
  - Updated `validation.ts` to use centralized limits

### Added

- **Test coverage reporting**: Added `@vitest/coverage-v8` dependency
  - Run `npm test -- --coverage` to generate coverage report
  - Current coverage: 64.74% overall, 97%+ on core handlers

### Internal

- `ParsedRFCWithSource` and `SourceNoteContext` types exported from `rfc-service.ts`
- `getParseCacheSize()` function for monitoring cache state

## [0.4.2] - 2026-02-03

### Fixed

- **Version re-release**: v0.4.1 was published before main branch CI completed. This release is functionally identical to v0.4.1.

## [0.4.1] - 2026-02-03

### Changed

- **Code refactoring**: Improved code organization and maintainability
  - Extracted shared requirement extraction logic to `src/utils/requirement-extractor.ts`
  - Extracted checklist generation to `src/services/checklist-generator.ts`
  - Extracted section utilities to `src/utils/section.ts`
  - Reduced `handlers.ts` from 510 lines to ~400 lines (~22% reduction)

### Added

- **New utility modules**:
  - `src/utils/requirement-extractor.ts` - Shared requirement extraction for XML/text parsers
  - `src/utils/section.ts` - Section search and cross-reference collection utilities
  - `src/services/checklist-generator.ts` - Dedicated checklist generation service

### Performance

- **List extraction optimization**: Fixed duplicate `extractText()` calls in `rfcxml-parser.ts`
  - List item content is now extracted once and reused for requirement marker extraction

### Internal

- Centralized `ParsedRFC` interface in `types/index.ts`
- Extracted `SECTION_HEADER_PATTERN` to `constants.ts`
- Both XML and text parsers now use shared `extractRequirementsFromSections()` function

## [0.4.0] - 2026-02-01

### Changed

- **Internationalization (i18n)**: All user-facing messages are now in English
  - Tool descriptions in `definitions.ts` (23 locations)
  - `_sourceNote` warnings and error messages in `handlers.ts`
  - Generated checklist output (Markdown headers and labels)
  - RFCXMLNotAvailableError messages in `rfc-fetcher.ts`
  - Resource descriptions in `index.ts`

### Fixed

- **Version synchronization bug**: Server now dynamically reads version from `package.json`
  - Previously hardcoded `0.1.0` in `index.ts` and `0.1.2` in `config.ts`
  - Now uses `createRequire` to load version at runtime

- **REQUIREMENT_REGEX lastIndex issue**: Added `createRequirementRegex()` factory function
  - Global regex with `/g` flag can cause issues when reused in exec() loops
  - Factory function creates fresh regex instance for each use

- **fetchRFCMetadata timeout**: Added 30-second timeout using AbortController
  - Previously had no timeout, could hang indefinitely

### Added

- **RFC number validation**: All tool handlers now validate RFC number input
  - New `src/utils/validation.ts` module
  - Validates positive integer between 1 and 99999

- **Type safety improvements** in `handlers.ts`
  - Added `SimplifiedSection` interface
  - Added `DependencyResult` interface
  - Re-exported `Section` type from `rfcxml-parser.ts`

- **Helper function for source notes**: `getTextSourceNote()` consolidates 7 duplicate patterns

## [0.3.0] - 2026-01-24

### Added

- **GitHub Actions CI/CD**
  - `ci.yml` - Automated lint, test, and build on push/PR to main
  - `publish.yml` - Automated npm publish on version tags (v*)
  - Version verification ensures package.json matches git tag

- **README badges** (shields.io)
  - npm version, CI status, License, Node.js version, Claude Code compatible

### Changed

- **Code refactoring**: Switch statement replaced with Map-based lookup
  - `src/tools/handlers.ts` - Added `toolHandlers` export for cleaner dispatch
  - `src/index.ts` - Simplified tool handler dispatch (60 lines → 18 lines)

### Performance

- **`extractText` optimization** in `src/services/rfcxml-parser.ts`
  - Reduced string concatenation by using array accumulator
  - Improved performance for large RFC documents

## [0.2.0] - 2026-01-19

### Changed

#### Architecture Refactoring

- **Duplicate code reduction**: Extracted shared code into reusable modules
  - `src/constants.ts` - BCP 14 / RFC 2119 keywords (MUST/SHOULD/MAY)
  - `src/utils/text.ts` - Text utilities (`extractSentence`, `extractCrossReferences`, `toArray`)

- **LRU cache implementation**: Replaced simple Map-based cache with size-limited LRU cache
  - `src/utils/cache.ts` - Generic LRU cache with configurable max size
  - XML cache: 20 entries, Text cache: 20 entries, Metadata: 100 entries, Parsed: 50 entries

- **Configuration externalization**: Centralized all settings in a single module
  - `src/config.ts` - HTTP settings, cache settings, RFC sources, API endpoints

- **Parallel fetch with AbortController**: Improved RFC fetch performance
  - `src/utils/fetch.ts` - Parallel fetch from multiple sources (RFC Editor, IETF Tools, Datatracker)
  - Uses `Promise.any` to return first successful response
  - Automatically cancels pending requests after first success
  - Includes timeout handling per request

### Performance

- RFC fetch latency reduced by fetching from 3 sources in parallel
- Memory usage bounded by LRU cache eviction

## [0.1.2] - 2026-01-18

### Added

- `README.ja.md` - Japanese documentation
- Output samples in documentation (both EN/JA)
- ESLint configuration (`eslint.config.js`)
- Prettier configuration (`.prettierrc`)
- Vitest test suite (51 tests)

### Changed

- `README.md` translated to English

## [0.1.1] - 2026-01-18

### Added

- `CHANGELOG.md` for version tracking

### Fixed

- `get_related_sections` - Section number normalization (`section-3.5` vs `3.5`)
- `get_rfc_dependencies` - Nested XML references structure handling

### Changed

- All responses now include `_source` field (`xml` | `text`)
- Text fallback responses include `_sourceNote` warning

## [0.1.0] - 2026-01-18

### Added

- Initial release
- `get_rfc_structure` - Section hierarchy and metadata
- `get_requirements` - Normative requirements extraction (MUST/SHOULD/MAY)
- `get_definitions` - Term definitions
- `get_rfc_dependencies` - RFC references (normative/informative)
- `get_related_sections` - Related sections within RFC
- `generate_checklist` - Implementation checklist generation
- `validate_statement` - Statement validation against RFC
- Automatic text fallback for RFCs before 8650
