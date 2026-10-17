# Changelog

All notable changes to this project are documented in this file.

## 1.1.0

### Minor Changes

- 9c42dc2: added approval before release
- a91288b: Added impersonation at tool launch

### Patch Changes

- c063821: Add development-branch CI and automated Changesets-based releases.
- 334534c: Add per-tool Dataverse user impersonation for primary and secondary connections.

## 0.1.0-preview.1 - 2026-07-24

### Added

- Preview extension manifest metadata for VS Code Marketplace preview distribution.
- In-product support commands:
    - Report a Bug
    - Request a Feature
    - Open Issue Tracker
    - Join PPTB Discord
- GitHub issue forms for bug reports and feature requests.
- README documentation for preview status, support paths, and in-editor feedback.
- Release readiness checklist and screenshot capture guidance.

### Changed

- Error notifications now provide a direct "Report Bug" action.
- Pre-release packaging script for preview VSIX publishing.
- Production packaging now disables source map generation to reduce VSIX footprint.

### Notes

- This is a preview release. Behavior and command surface may change based on user feedback.
