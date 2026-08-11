import * as vscode from "vscode";
import { GraphPanel } from "./graphPanel";
import { AgentRepository } from "./repository";
import { AgentTreeProvider } from "./treeProvider";
import type { AgentProvider, GraphEdge, GraphSnapshot } from "./types";

export interface AgentOrchestrationApi {
  getSnapshot: () => GraphSnapshot | undefined;
  isPanelReady: () => boolean;
  createAgent: (provider: AgentProvider, name: string, description: string) => Promise<GraphSnapshot>;
  createSkill: (provider: AgentProvider | "shared", name: string, description: string) => Promise<GraphSnapshot>;
  addEdge: (edge: GraphEdge) => Promise<GraphSnapshot>;
}

export async function activate(context: vscode.ExtensionContext): Promise<AgentOrchestrationApi> {
  const repository = new AgentRepository();
  const tree = new AgentTreeProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider("agentOrchestration.explorer", tree));

  const update = (snapshot: GraphSnapshot): void => tree.update(snapshot);
  const refresh = async (): Promise<void> => {
    try {
      update(await repository.scan());
      if (GraphPanel.current) await GraphPanel.current.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (vscode.workspace.workspaceFolders?.length) void vscode.window.showErrorMessage(`Agent Orchestration: ${message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("agentOrchestration.openGraph", (selectId?: string) => GraphPanel.show(context, repository, update, selectId)),
    vscode.commands.registerCommand("agentOrchestration.refresh", refresh),
    vscode.commands.registerCommand("agentOrchestration.createAgent", async () => {
      const provider = await vscode.window.showQuickPick([
        { label: "Claude Code", value: "claude" as AgentProvider },
        { label: "GitHub Copilot", value: "github" as AgentProvider },
        { label: "OpenAI Codex", value: "codex" as AgentProvider },
      ], { placeHolder: "Choose the native agent format" });
      if (!provider) return;
      const name = await vscode.window.showInputBox({ prompt: "Agent name", validateInput: (value) => /^[a-zA-Z0-9._-]+$/.test(value) ? undefined : "Use letters, numbers, dots, underscores, or hyphens." });
      if (!name) return;
      const description = await vscode.window.showInputBox({ prompt: "When should this agent be used?" });
      if (description === undefined) return;
      update(await repository.createAgent(provider.value, name, description));
      await GraphPanel.show(context, repository, update, `${provider.value}:${provider.value === "claude" ? `.claude/agents/${name}.md` : provider.value === "github" ? `.github/agents/${name}.agent.md` : `.codex/agents/${name}.toml`}`);
    }),
    vscode.commands.registerCommand("agentOrchestration.createSkill", () => GraphPanel.show(context, repository, update).then(() => vscode.window.showInformationMessage("Use + Skill in the graph toolbar to choose the skill scope."))),
    vscode.commands.registerCommand("agentOrchestration.openSource", async (fileOrItem: string | { agent?: { file?: string } }) => {
      const file = typeof fileOrItem === "string" ? fileOrItem : fileOrItem?.agent?.file;
      if (file) await vscode.window.showTextDocument(repository.uriFor(file));
    }),
  );

  const patterns = ["**/.claude/{agents,skills}/**/*", "**/.github/{agents,skills}/**/*", "**/.codex/{agents,skills}/**/*", "**/.agents/skills/**/*", "**/.agent-graph.json"];
  let refreshTimer: NodeJS.Timeout | undefined;
  const scheduleRefresh = (): void => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 250);
  };
  for (const pattern of patterns) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    context.subscriptions.push(watcher);
  }

  if (vscode.workspace.workspaceFolders?.length) await refresh();
  return {
    getSnapshot: () => repository.current,
    isPanelReady: () => GraphPanel.current?.ready ?? false,
    createAgent: (provider, name, description) => repository.createAgent(provider, name, description),
    createSkill: (provider, name, description) => repository.createSkill(provider, name, description),
    addEdge: (edge) => repository.addEdge(edge),
  };
}

export function deactivate(): void {}
