# Contributing to DevPresence

## Ways to contribute

- Bug reports
- Feature suggestions
- Code contributions
- Documentation improvements

## Getting started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/DevPresence`
3. Create a branch: `git checkout -b feat/your-feature` or `fix/your-bug`
4. Make your changes
5. Push and open a pull request against `main`

## Local setup

**API:**
```bash
cd dev-presence-api
npm ci
cp .env.example .env   # fill in DEV_PRESENCE_SECRET
npm run dev
```

**Extension (VS Code / Cursor):**
```bash
cd dev-presence-extension
npm ci
# Press F5 in VS Code to launch Extension Development Host
```

## Branch naming

| Type | Pattern |
|---|---|
| Feature | `feat/short-description` |
| Bug fix | `fix/short-description` |
| Docs | `docs/short-description` |
| Chore | `chore/short-description` |

## Commit style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add GitHub activity integration
fix: prevent stale presence after reconnect
docs: add Zed setup instructions
```

## Pull requests

- Keep PRs focused — one concern per PR
- Update relevant docs if behaviour changes
- Add a short description of what and why, not just what

## Reporting bugs

Open a [GitHub Issue](https://github.com/Subham12R/DevPresence/issues/new?template=bug_report.md) with:
- OS and editor version
- Steps to reproduce
- Expected vs actual behaviour
- Logs if available (`dev-presence-api` stdout)

## Code style

- TypeScript strict mode throughout
- No unused imports or variables
- Keep API surface minimal — don't add options that aren't needed yet
