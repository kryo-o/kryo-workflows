# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Location is now fully configurable: cities use `"City, ST"` format and the search query no longer hardcodes the state.
- README and package description are location-generic so the project can be reused for any metro area.
- Deploy workflow runs on `main`, uses the lockfile-pinned CLI, and upgrades to `actions/checkout@v5` / `actions/setup-node@v5`.

### Security
- Upgraded `@trigger.dev/sdk` and `trigger.dev` 4.4.0 → 4.7.3 (pinned exactly).
- npm `overrides` force patched `ws`, `tar` and `deepmerge-ts` in the CLI's dependency tree.
- Deploy workflow restricted to `permissions: contents: read`.
- Runtime dependencies: 0 known vulnerabilities. Remaining advisories (`braces`, `esbuild`) are in the dev-only CLI and have no compatible fix yet.

## [1.0.0] - 2026-10-13

### Added
- `find-tampa-leads` scheduled task: runs every Monday at 8am America/New_York.
- Google Places (New) Text Search across 13 business categories and 10 Tampa Bay cities, rotating weekly.
- Lead filters: operational, has website and phone, 10–300 Google reviews.
- ClickUp task per lead with category, city, phone, website, address, rating and Google Maps link.
- Duplicate protection by Google Place ID, phone number and website domain: pre-run check, in-run tracking, and a post-run audit that removes duplicates created by the run.
- Single-run concurrency limit and automatic retries (3 attempts).
- GitHub Actions workflow that deploys to Trigger.dev on push to `main`.

[Unreleased]: https://github.com/kryo-o/kryo-workflows/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kryo-o/kryo-workflows/releases/tag/v1.0.0
