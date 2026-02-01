# Changelog

All notable changes to this project will be documented in this file.

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
