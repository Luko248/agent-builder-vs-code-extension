import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCodexAgent,
  parseFrontmatter,
  parseMarkdownAgent,
  serializeCodexAgent,
  serializeMarkdownAgent,
  withManagedBlock,
} from "../core";

describe("agent format adapters", () => {
  it("parses and preserves Claude agent capabilities", () => {
    const source = `---
name: security-reviewer
description: Review security-sensitive changes
tools: Read, Grep, Bash
skills:
  - threat-model
permissionMode: plan
color: orange
custom-field: preserved
---

Inspect evidence before reporting findings.
`;
    const agent = parseMarkdownAgent("claude", ".claude/agents/security-reviewer.md", source);
    assert.deepEqual(agent.tools, ["Read", "Grep", "Bash"]);
    assert.deepEqual(agent.skills, ["threat-model"]);
    assert.equal(agent.permissionMode, "plan");
    const serialized = serializeMarkdownAgent({ ...agent, description: "Updated" }, source, agent.prompt);
    const parsed = parseFrontmatter(serialized);
    assert.equal(parsed.attributes["custom-field"], "preserved");
    assert.equal(parsed.attributes.description, "Updated");
  });

  it("maps GitHub invocation controls", () => {
    const source = `---
name: docs-agent
description: Writes documentation
tools: [read, edit]
user-invocable: false
disable-model-invocation: true
---
Write concise docs.
`;
    const agent = parseMarkdownAgent("github", ".github/agents/docs-agent.agent.md", source);
    assert.equal(agent.userInvokable, false);
    assert.equal(agent.autoInvokable, false);
    assert.deepEqual(agent.tools, ["read", "edit"]);
  });

  it("round-trips Codex TOML agents and skill paths", () => {
    const source = `name = "reviewer"
description = "Reviews pull requests"
sandbox_mode = "read-only"
developer_instructions = "Find real defects."

[[skills.config]]
path = ".agents/skills/security/SKILL.md"
enabled = true
`;
    const agent = parseCodexAgent(".codex/agents/reviewer.toml", source);
    assert.equal(agent.permissionMode, "read-only");
    assert.deepEqual(agent.skills, ["security"]);
    const serialized = serializeCodexAgent(agent, source, agent.prompt, [{ id: "skill:x", name: "security", description: "", file: ".agents/skills/security/SKILL.md", provider: "shared" }]);
    assert.equal(parseCodexAgent(".codex/agents/reviewer.toml", serialized).name, "reviewer");
  });

  it("writes one idempotent managed orchestration block", () => {
    const agent = parseMarkdownAgent("claude", ".claude/agents/lead.md", "---\nname: lead\ndescription: Leads\n---\nLead the work.");
    const once = withManagedBlock(agent.prompt, agent, [{ targetName: "tester", label: "verification is needed" }]);
    const twice = withManagedBlock(once, agent, [{ targetName: "tester", label: "verification is needed" }]);
    assert.equal(once, twice);
    assert.equal((twice.match(/agent-orchestration:managed:start/g) ?? []).length, 1);
    assert.match(twice, /Delegate to `tester`/);
  });
});
