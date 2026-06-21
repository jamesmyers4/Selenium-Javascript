# CLAUDE.md — ESAMS Reference Scrub

## Task

Remove all references to "ESAMS" and my former employer from the test files in this repository. This is a public showcase repo and must not expose any proprietary system names, company names, or internal URLs.

## Replacements to Make

| Find               | Replace With                               | Case Rule                                 |
| ------------------ | ------------------------------------------ | ----------------------------------------- |
| `ESAMS`            | `SafetyOps`                                | uppercase match → title case replacement  |
| `esams`            | `safetyops`                                | lowercase match → lowercase replacement   |
| `Esams`            | `SafetyOps`                                | title case match → title case replacement |
| `HGW`              | `[REDACTED]` or remove entirely            | company name                              |
| `HGW & Associates` | remove or replace with "previous employer" |                                           |

## Scope

- Search ALL files: `.js`, `.json`, `.md`, `.txt`, `.env.example`, `.yml`, `.yaml`, config files
- Do NOT touch: `node_modules/`, `.git/`
- Pay special attention to:
  - URL strings (e.g. `/esams/login`, `https://esams...`)
  - Variable names (e.g. `esamsBaseUrl`, `ESAMS_URL`)
  - Comments referencing the system name
  - String literals in test descriptions (`describe('ESAMS login')`)
  - README content
  - Any `package.json` name or description fields

## URL Handling

If any URLs contain the string `esams` (e.g. `https://esams.example.com/...`), replace the domain portion with a placeholder like `https://safetyops-demo.example.com` or simply `https://safetyops.example.com`. Do NOT leave real internal URLs exposed.

## What NOT to Change

- Do not alter test logic, selectors, or functionality
- Do not rename methods or page object structure unless the name itself contains "esams"
- Preserve all existing code style and formatting

## After Changes

- List every file modified and what was changed
- Flag anything ambiguous for my review before committing
- Do NOT commit or push — I will review and commit manually
