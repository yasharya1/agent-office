---
name: agent-office-scout
description: Draft standing orders for the Agent Office scout from the user's own CLAUDE.md, task lists and project notes, so the scout pitches work that fits their setup. Use when the user says "set up the scout", "write my scout's orders", "configure Agent Office scout", or has just installed Agent Office and wants the scout. Writes a draft file and shows it. Never starts the scout, the server or any agent.
---

# Agent Office: draft the scout's standing orders

The scout is a Claude Code session that reads the user's notes, pitches small tasks, and starts a builder pane for each pitch the user assigns on the Agent Office page. Its standing orders are a Markdown file. This skill writes a draft of that file from the user's own context.

## Rules

- **Draft only.** Write one draft file and config suggestions. Never run `scout/start.sh`, `server.py`, `hc run` or any agent.
- **Ask before you change `config.json`.** Show the exact edit first.
- **Never copy secrets.** Do not put tokens, keys, passwords, customer names or private URLs into the orders. Name files, not their contents.
- **Keep the safe defaults.** Do not turn on `scout.enabled`, `scout.skip_permissions` or `builder.skip_permissions` for the user. If they ask, quote the risk text from `config.example.json` first.

## Steps

1. **Find the Agent Office folder.** It holds `server.py`, `office_config.py` and `scout/SCOUT.template.md`. If the current folder is not it, ask the user for the path.
2. **Read the settings.** Read `config.json` (or `config.example.json` if there is none). Note `workspace`, `scout.name`, `scout.hours`, `scout.sources` and `builder.disallowed_tools`.
3. **Read the user's context**, inside `workspace` only:
   - `CLAUDE.md` and any `AGENTS.md`: who the user is, how they work, rules, things marked "do not", owners and blockers.
   - Task lists: `TODO.md`, `TASKS.md`, issue lists, or whatever the CLAUDE.md names as the source of truth.
   - Project notes: README files, `CONTEXT.md` or `NOTES.md` per project, status sections.
   Read in chunks if a file is large. Read nothing outside `workspace`.
4. **Work out these answers.** Ask the user one short question for any you cannot find:
   - **Owner:** the name the scout pitches to.
   - **Sources:** the files where work and status live, as paths or globs relative to `workspace`.
   - **Hours and time zone:** when the scout may run a pass.
   - **Skip rules:** extra reasons to skip a candidate, taken from the user's own rules. Examples: "It is under 'Ruled out' in CLAUDE.md." "The project's 'Blocked by' column names someone else." "It touches the billing folder."
   - **Live writes:** the systems the user's agents can change outside the repo (chat, email, CRM, tickets, deploys, databases). These become the "never" list in the orders.
   - **Blocked tools:** MCP servers or tools from this session that can send or change data. Suggest adding them to `builder.disallowed_tools`.
5. **Propose the config edit.** Show the `config.json` changes for `scout.sources`, `scout.hours`, `scout.display` and `builder.disallowed_tools` as a diff. Apply it only after the user says yes.
6. **Write the draft.** Put the skip rules in a temporary file, one rule per line, then run from the Agent Office folder:
   ```sh
   python3 setup.py --render-orders --owner "<owner>" --skip-rules <rules file> \
     --live-writes "<verb phrase, e.g. send chat or email messages, write to the CRM, or deploy>" \
     --out scout/SCOUT.draft.md
   ```
   The command fills `scout/SCOUT.template.md` from `config.json`. Add `--force` to replace an earlier draft.
7. **Show it.** Print the draft's hard rules, its sources list and its skip rules. Point at anything you guessed.
8. **Hand over.** Tell the user the next steps, in order:
   1. Read `scout/SCOUT.draft.md` and edit it.
   2. Rename it to the `scout.orders` path in `config.json` (default `scout/SCOUT.md`).
   3. Read the README's "Scout safety" section, then set `scout.enabled` to `true`.
   4. From a Herdr pane, run `scout/start.sh`.
