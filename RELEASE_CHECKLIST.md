# Release Checklist

Use this checklist before publishing a new version of the extension.

## 1) Versioning and Notes

- [ ] Bump version in package.json.
- [ ] Add release notes in CHANGELOG.md.
- [ ] Confirm preview flag in package.json is correct for the target release type.

## 2) Manual Smoke Tests

- [ ] Open the extension in VS Code and verify all views load:
    - Connections
    - Installed Tools
    - Marketplace
- [ ] Add a connection and verify validation and save behavior.
- [ ] Connect and disconnect from a Dataverse environment.
- [ ] Test connection and confirm status bar reflects active state.
- [ ] Export connections and import them back.
- [ ] Browse marketplace tools and install one.
- [ ] Launch an installed tool.
- [ ] Uninstall an installed tool.
- [ ] Trigger an expected error path and verify "Report a Bug" action appears.
- [ ] Verify support commands from Command Palette:
    - PPTB: Report a Bug
    - PPTB: Request a Feature
    - PPTB: Open Issue Tracker
    - PPTB: Join PPTB Discord

## 3) Build and Package

- [ ] Run npm run compile.
- [ ] Run npm run vsix:preview and confirm it succeeds.
- [ ] Verify VSIX content does not include source maps.

## 4) Marketplace Readiness

- [ ] README reflects current capabilities.
- [ ] Screenshot assets are updated per docs/screenshots/README.md.
- [ ] Issue templates are available in .github/ISSUE_TEMPLATE.
- [ ] License and repository links are valid.

## 5) Publish

- [ ] Publish preview: npm run publish:preview
- [ ] Validate listing in VS Code Marketplace.
- [ ] Install from Marketplace in a clean VS Code profile and smoke test again.
