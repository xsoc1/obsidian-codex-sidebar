# Codex Sidebar development

## Objective and scope

- User requested a Windows desktop Obsidian plugin using real local Codex login and sessions, with the open/close control on Obsidian's left ribbon.
- Version 0.1.0 provides a right chat view, streaming responses, interruption, saved plugin sessions, selection prompts, and Markdown reading-context capture.
- Source lives here. Installed files belong to the vault's ignored `.obsidian/plugins/codex-sidebar` directory. Do not put generated files or private session data into the notes repository.
- Preserve unrelated vault changes. Do not modify notes or assignment answers when testing selection capture.
- Use the official Codex app-server JSONL protocol over an owned hidden child process. Never parse private credential files or attach to a private desktop socket. Reuse the current Windows user's Codex login.
- Questions use a read-only sandbox. Approval requests must be shown to the user; unsupported server requests must return an explicit error.
- Use tabs, standalone braces, snake_case for own multiword functions, PascalCase for own variables. Obsidian overrides retain API names.

## Commands

- `npm ci`
- `npm run build`
- `npm test`
- Install `manifest.json`, `main.js`, `main.js.map`, `styles.css` into the plugin directory, preserving `data.json`.
- Native CLI: `obsidian vault=<vault> plugin:reload id=codex-sidebar`; then `dev:errors` and native DOM/screenshot checks. Local executable paths and installation details are recorded in ignored `LOCAL_DEV.md` when present.

## Current state

- 2026-10-11: Version 0.1.0 is installed and enabled in the math vault. TypeScript and esbuild succeeded, and 8 protocol/prompt tests passed. Native checks covered left ribbon open/close, real ChatGPT-account Codex inference, Markdown math rendering, interruption, same-thread continuation after reload, source-editor selection, reading-mode source-block mapping, automatic selection capture, and visible viewport capture.
- PDF page extraction, screenshots/OCR, global desktop conversation browsing, direct source editing and mobile support are outside 0.1.0.
- Reading selection maps to whole Markdown source blocks when available, not an exact character range. A text-only fallback is explicitly labeled.
- Auto capture updates a context card. Explicit send or selection shortcuts submit the question; dragging a selection alone does not submit a turn.

## Decisions and record

- 2026-10-11: User chose real Codex and Windows desktop, then requested the first version with a left ribbon toggle. We chose a standalone light plugin for the initial scope. This is an implementation choice by the assistant, not a previously expressed preference to fork or avoid existing plugins.
- Local installed CLI protocol types were generated from `codex-cli 0.162.0-alpha.17.2`. The plugin uses initialize/account/read/thread/start/thread/resume/turn/start/turn/interrupt and handles streaming and approvals.
- Native acceptance used Obsidian 1.14.4 and CLI 0.162.0-alpha.17.2 with model gpt-6.1-sol inherited from the user's local Codex configuration. No authentication files were parsed. Actual server thread history confirmed the selection shortcut sent the original LaTeX and block-mapping label. An interrupted turn was read back as interrupted. Reload stopped the old owned process and retained the same thread.
- A native screenshot captured while the app was in the background was stale after a full reading rerender. Bringing the math vault window to the foreground and maximizing it refilled the live DOM. Future reading acceptance should compare fresh visible-window screenshots, source mapping and DOM, rather than accepting background paint alone.
- Plugin files and data are installed in the local math vault's `.obsidian/plugins/codex-sidebar`. Only research/user documentation is maintained in the separate notes repo. Machine-specific evidence paths and configuration backup locations are retained locally in ignored `LOCAL_DEV.md`.
- Remaining acceptance boundaries: approvals are implemented but no privileged execution approval was exercised; popout windows, multiple Markdown panes, embeds, cross-note selections and source edits during capture have not been exhaustively exercised. No claim of PDF/screenshot/OCR recognition or direct desktop-session takeover.

## Git and publication

- 2026-10-11: User explicitly requested Git management and a public GitHub repository. Repository preparation targets `xsoc1/obsidian-codex-sidebar`; creation and remote verification are pending at this preparation step.
- Track source, tests, package/lock files, manifest, styles, build configuration and documentation. Ignore built bundles, dependencies, local installations, environment files, chats and machine-specific records. Do not commit credentials or actual thread data.
- Use `codex/` for development branches. Keep public commit metadata under the GitHub account's noreply email without changing global Git identity.
- Reproduce checks with `npm ci`, `npm run build` and `npm test`. Before pushing, inspect `git diff --cached --check` and the staged file manifest. After publishing, read back visibility and verify the remote head matches local HEAD.
