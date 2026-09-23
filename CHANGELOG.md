# Changelog

## [0.2.0] - 2026-09-23

### Added

- Search 2.0: highlighted result snippets, fuzzy title matching, phrases, tag/path/link/date filters and relevance/recent/title sorting.
- Wiki-link completion and missing-note creation, contextual backlinks, broken-link checks, aliases, text extraction into linked notes and inbound Wiki-link updates on rename or move.
- Recoverable Trash for deleted notes and folders, with conflict-safe restore and configurable 7/30/90-day automatic expiry (30 days by default).

### Notes

- Expired Trash entries are removed at startup, when Trash opens, and hourly while Lattice runs; there is no cleanup daemon while Lattice is closed.
- The website's interactive browser demo covers the core editing workflow and does not include every CLI feature.

### Validation

- 169 tests passed across 31 test files.
- Type checking, CLI build, website build, browser demo smoke check, and npm package dry run passed.

## [0.1.5] - 2026-09-18

### Fixed

- Keep the Vault file tree visible in the website demo while editing.
- Match the product's three-pane editing layout with the Vault, editor, and live preview shown together.

### Validation

- 157 tests passed across 28 test files.
- Type checking, CLI build, and website build passed.

## [0.1.4] - 2026-09-18

### Changed

- Remove the selected-row arrow from the CLI Vault tree; selection uses the row background.
- Remove bold styling from tree icons and selected filenames for more consistent weight.
- Use paired Nerd Font Codicons chevrons for folder expansion and collapse.
- Keep disclosure, icon, and filename spacing stable at each tree depth.
- Include the new disclosure glyphs in the website demo's bundled font.

### Validation

- 157 tests passed across 28 test files.
- Type checking, CLI build, and website build passed.

[0.2.0]: https://github.com/wenwenba/Lattice/releases/tag/v0.2.0
[0.1.5]: https://github.com/wenwenba/Lattice/releases/tag/v0.1.5
[0.1.4]: https://github.com/wenwenba/Lattice/releases/tag/v0.1.4
