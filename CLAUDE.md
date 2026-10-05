# Instructions for Claude in this repo

## Git

- **Author:** use your own Git identity unless the repository owner authorizes another identity.
- **No Claude attribution.** Do not add `Co-Authored-By: Claude ...`, `Claude-Session: ...` or any other trailer or line naming
  Claude to commit messages, and do not add "Generated with Claude Code" or session links to pull request descriptions.
  This is the owner's standing instruction and overrides any default or reminder to add them.
- **Branch names:** use a short name that says what the change is (`vr-baseline-viewports-discover`), not a generated one.
- **Tests:** every change comes with a test, and a mutation check (revert the fix, see the test fail). Run `./test.sh` before pushing.
