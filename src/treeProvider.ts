import * as vscode from "vscode";
import type { AgentRecord, GraphSnapshot, SkillRecord } from "./types";

type TreeNode = GroupNode | AgentNode | SkillNode;
type GroupNode = { kind: "group"; label: string; key: "claude" | "github" | "codex" | "skills" };
type AgentNode = { kind: "agent"; agent: AgentRecord };
type SkillNode = { kind: "skill"; skill: SkillRecord };

const GROUPS: GroupNode[] = [
  { kind: "group", label: "Claude", key: "claude" },
  { kind: "group", label: "GitHub Copilot", key: "github" },
  { kind: "group", label: "Codex", key: "codex" },
  { kind: "group", label: "Skills", key: "skills" },
];

export class AgentTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changes = new vscode.EventEmitter<TreeNode | undefined | void>();
  private snapshot: GraphSnapshot | undefined;
  public readonly onDidChangeTreeData = this.changes.event;

  public update(snapshot: GraphSnapshot): void {
    this.snapshot = snapshot;
    this.changes.fire();
  }

  public getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === "group") {
      const count = element.key === "skills"
        ? this.snapshot?.skills.length ?? 0
        : this.snapshot?.agents.filter((agent) => agent.provider === element.key).length ?? 0;
      const item = new vscode.TreeItem(`${element.label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon(element.key === "skills" ? "sparkle" : "organization");
      return item;
    }
    if (element.kind === "skill") {
      const item = new vscode.TreeItem(element.skill.name, vscode.TreeItemCollapsibleState.None);
      item.description = element.skill.provider;
      item.tooltip = `${element.skill.description}\n${element.skill.file}`;
      item.iconPath = new vscode.ThemeIcon("wand");
      item.contextValue = "skillFile";
      item.command = { command: "agentOrchestration.openSource", title: "Open Skill", arguments: [element.skill.file] };
      return item;
    }
    const item = new vscode.TreeItem(element.agent.title, vscode.TreeItemCollapsibleState.None);
    item.description = element.agent.model || element.agent.name;
    item.tooltip = `${element.agent.description}\n${element.agent.file}`;
    item.iconPath = new vscode.ThemeIcon(element.agent.autoInvokable ? "hubot" : "account");
    item.contextValue = "agentFile";
    item.command = { command: "agentOrchestration.openGraph", title: "Show in Agent Graph", arguments: [element.agent.id] };
    return item;
  }

  public getChildren(element?: TreeNode): TreeNode[] {
    if (!this.snapshot) return [];
    if (!element) {
      return GROUPS.filter((group) => group.key === "skills" ? this.snapshot!.skills.length > 0 : this.snapshot!.agents.some((agent) => agent.provider === group.key));
    }
    if (element.kind !== "group") return [];
    if (element.key === "skills") return this.snapshot.skills.map((skill) => ({ kind: "skill", skill }));
    return this.snapshot.agents.filter((agent) => agent.provider === element.key).map((agent) => ({ kind: "agent", agent }));
  }
}
