# Changelog

All notable changes to this project will be documented in this file.

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
