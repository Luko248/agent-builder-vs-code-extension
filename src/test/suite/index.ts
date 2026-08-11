import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("lukas-chylik.agent-orchestration-studio");
  assert.ok(extension, "The development extension should be installed in the Extension Host");
  const api = await extension.activate() as {
    getSnapshot: () => { agents: Array<{ id: string }>; skills: unknown[] } | undefined;
    isPanelReady: () => boolean;
    createAgent: (provider: "github", name: string, description: string) => Promise<{ agents: Array<{ id: string }> }>;
    createSkill: (provider: "shared", name: string, description: string) => Promise<{ skills: unknown[] }>;
    addEdge: (edge: { id: string; source: string; target: string; label: string; style: "solid" }) => Promise<unknown>;
  };
  assert.equal(extension.isActive, true, "The extension should activate");
  assert.equal(api.getSnapshot()?.agents.length, 4, "All Claude, GitHub, and Codex fixture agents should be discovered");
  assert.equal(api.getSnapshot()?.skills.length, 1, "The shared fixture skill should be discovered");

  const created = await api.createAgent("github", "integration-agent", "Created by the Extension Host test");
  assert.equal(created.agents.length, 5, "Creating an agent should write and discover its native source file");
  const createdSkill = await api.createSkill("shared", "integration-skill", "Created by the Extension Host test");
  assert.equal(createdSkill.skills.length, 2, "Creating a skill should write and discover SKILL.md");
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(workspace);
  const createdAgentSource = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(workspace, ".github/agents/integration-agent.agent.md")));
  assert.match(createdAgentSource, /name: integration-agent/);

  await api.addEdge({
    id: "integration-edge",
    source: "claude:.claude/agents/orchestrator.md",
    target: "github:.github/agents/integration-agent.agent.md",
    label: "the integration scenario needs a generated agent",
    style: "solid",
  });
  const orchestratorSource = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(workspace, ".claude/agents/orchestrator.md")));
  assert.match(orchestratorSource, /agent-orchestration:managed:start/);
  assert.match(orchestratorSource, /Delegate to `integration-agent`/);

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "agentOrchestration.openGraph",
    "agentOrchestration.refresh",
    "agentOrchestration.createAgent",
    "agentOrchestration.createSkill",
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }

  await vscode.commands.executeCommand("agentOrchestration.refresh");
  await vscode.commands.executeCommand("agentOrchestration.openGraph", "claude:.claude/agents/orchestrator.md");
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.ok(vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.label === "Agent Orchestration")), "The graph webview should open as an editor tab");
  assert.equal(api.isPanelReady(), true, "The graph webview script should load and complete its ready handshake");
}
