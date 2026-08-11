# Agent Orchestration Studio

Agent Orchestration Studio is a local-first VS Code extension for discovering and visually managing the AI agents and skills checked into a repository.

Open the **Agent Orchestration** activity-bar view, then choose **Open Agent Graph**. Agents become draggable cards; delegation becomes an editable graph; selecting a card exposes its native prompt, model, tools, permissions, invocation policy, color, and assigned skills.

## What works

- Discovers Claude Code agents from `.claude/agents/**/*.md`.
- Discovers GitHub Copilot agents from `.github/agents/**/*.md` and `*.agent.md`.
- Discovers OpenAI Codex agents from `.codex/agents/**/*.toml`.
- Discovers `SKILL.md` workflows under `.agents/skills`, `.claude/skills`, `.github/skills`, and `.codex/skills`.
- Creates native agent and skill files from the graph toolbar.
- Edits prompts, descriptions, model selection, tool allowlists, permission/sandbox modes, invocation policy, and skill assignments.
- Draws, labels, restyles, and removes delegation edges.
- Saves visual-only metadata to `.agent-graph.json`.
- Synchronizes every outgoing edge into an idempotent managed block in the source agent prompt.
- Includes automatic DAG layout and a repository explorer tree.

## Native format behavior

| Capability | Claude Code | GitHub Copilot | OpenAI Codex |
|---|---|---|---|
| Agent source | Markdown + YAML | Markdown + YAML | TOML |
| Tools | Native `tools` allowlist | Native `tools` allowlist | Recorded as requested capabilities; runtime config still governs access |
| Permissions | Native `permissionMode` | Host-controlled | Native `sandbox_mode` |
| Invocation | Claude can infer or users can mention agents | Native `user-invocable` and `disable-model-invocation` | Displayed as graph policy; Codex agents remain spawnable by name |
| Skills | Native `skills` | Written as agent metadata | Native `[[skills.config]]` paths |
| Color | Native `color` plus graph metadata | Graph metadata | Graph metadata |

Visual positions and cross-vendor edges are deliberately stored in `.agent-graph.json`, because no common native schema exists for those properties. Prompts remain authoritative: graph edges are mirrored into a clearly marked `Visual orchestration` section that can be reviewed in Git.

The adapters follow the current vendor formats documented by [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [GitHub Copilot custom agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration), and [OpenAI Codex subagents and skills](https://learn.chatgpt.com/docs/agent-configuration/subagents).

## Development

```bash
npm install
npm run check
npm test
npm run build
```

Press `F5` in VS Code to open the included demo repository in an Extension Development Host. To build an installable package:

```bash
npm run package
```

## Current scope

This first release manages repository-scoped agents and skills. MCP server configuration, hooks, user-global agent libraries, live runtime execution traces, and graph-to-runtime monitoring are natural follow-on capabilities, but they are not silently approximated in this version.

## License

MIT
