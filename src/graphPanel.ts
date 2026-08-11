import * as vscode from "vscode";
import { nextEdgeId } from "./core";
import { AgentRepository } from "./repository";
import type { AgentProvider, AgentRecord, GraphEdge, GraphSnapshot } from "./types";

type PanelMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "saveAgent"; agent: AgentRecord }
  | { type: "saveLayout"; positions: Record<string, { x: number; y: number }> }
  | { type: "addEdge"; source: string; target: string; label?: string }
  | { type: "updateEdge"; edge: GraphEdge }
  | { type: "deleteEdge"; id: string }
  | { type: "createAgent" }
  | { type: "createSkill" }
  | { type: "openSource"; file: string };

export class GraphPanel {
  public static current: GraphPanel | undefined;
  public ready = false;

  public static async show(context: vscode.ExtensionContext, repository: AgentRepository, onChange: (snapshot: GraphSnapshot) => void, selectId?: string): Promise<void> {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal(vscode.ViewColumn.One);
      await GraphPanel.current.refresh(selectId);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "agentOrchestration.graph",
      "Agent Orchestration",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] },
    );
    GraphPanel.current = new GraphPanel(panel, context, repository, onChange);
    await GraphPanel.current.refresh(selectId);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly repository: AgentRepository,
    private readonly onChange: (snapshot: GraphSnapshot) => void,
  ) {
    this.panel.onDidDispose(() => { GraphPanel.current = undefined; }, null, context.subscriptions);
    this.panel.webview.onDidReceiveMessage((message: PanelMessage) => this.handle(message), null, context.subscriptions);
    this.panel.webview.html = this.html();
  }

  public async refresh(selectId?: string): Promise<void> {
    const snapshot = await this.repository.scan();
    this.onChange(snapshot);
    await this.panel.webview.postMessage({ type: "snapshot", snapshot, selectId });
  }

  private async handle(message: PanelMessage): Promise<void> {
    try {
      let snapshot: GraphSnapshot | undefined;
      switch (message.type) {
        case "ready":
          this.ready = true;
          await this.refresh();
          return;
        case "refresh":
          await this.refresh();
          return;
        case "saveAgent":
          snapshot = await this.repository.saveAgent(message.agent);
          break;
        case "saveLayout":
          await this.repository.saveLayout(message.positions);
          await this.panel.webview.postMessage({ type: "saved", message: "Layout saved" });
          return;
        case "addEdge":
          snapshot = await this.repository.addEdge({
            id: nextEdgeId(this.repository.current?.edges ?? []),
            source: message.source,
            target: message.target,
            label: message.label?.trim() || "its specialty is needed",
            style: "solid",
          });
          break;
        case "updateEdge":
          snapshot = await this.repository.updateEdge(message.edge);
          break;
        case "deleteEdge":
          snapshot = await this.repository.deleteEdge(message.id);
          break;
        case "createAgent":
          snapshot = await this.createAgent();
          if (!snapshot) return;
          break;
        case "createSkill":
          snapshot = await this.createSkill();
          if (!snapshot) return;
          break;
        case "openSource":
          await vscode.window.showTextDocument(this.repository.uriFor(message.file));
          return;
      }
      this.onChange(snapshot);
      await this.panel.webview.postMessage({ type: "snapshot", snapshot });
      await this.panel.webview.postMessage({ type: "saved", message: "Repository files synchronized" });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Agent Orchestration: ${messageText}`);
      await this.panel.webview.postMessage({ type: "error", message: messageText });
    }
  }

  private async createAgent(): Promise<GraphSnapshot | undefined> {
    const provider = await vscode.window.showQuickPick(
      [
        { label: "Claude Code", value: "claude" as const, detail: ".claude/agents/<name>.md" },
        { label: "GitHub Copilot", value: "github" as const, detail: ".github/agents/<name>.agent.md" },
        { label: "OpenAI Codex", value: "codex" as const, detail: ".codex/agents/<name>.toml" },
      ],
      { placeHolder: "Choose the native agent format" },
    );
    if (!provider) return undefined;
    const name = await vscode.window.showInputBox({ prompt: "Agent name", placeHolder: "security-reviewer", validateInput: validateName });
    if (!name) return undefined;
    const description = await vscode.window.showInputBox({ prompt: "When should this agent be used?", placeHolder: "Reviews changes for security risks and missing controls." });
    if (description === undefined) return undefined;
    return this.repository.createAgent(provider.value, name, description);
  }

  private async createSkill(): Promise<GraphSnapshot | undefined> {
    const provider = await vscode.window.showQuickPick(
      [
        { label: "Shared standard", value: "shared" as const, detail: ".agents/skills/<name>/SKILL.md" },
        { label: "Claude Code", value: "claude" as const, detail: ".claude/skills/<name>/SKILL.md" },
        { label: "GitHub Copilot", value: "github" as const, detail: ".github/skills/<name>/SKILL.md" },
        { label: "OpenAI Codex", value: "codex" as const, detail: ".codex/skills/<name>/SKILL.md" },
      ],
      { placeHolder: "Choose the skill scope" },
    );
    if (!provider) return undefined;
    const name = await vscode.window.showInputBox({ prompt: "Skill name", placeHolder: "release-check", validateInput: validateName });
    if (!name) return undefined;
    const description = await vscode.window.showInputBox({ prompt: "What workflow does this skill provide?" });
    if (description === undefined) return undefined;
    return this.repository.createSkill(provider.value, name, description);
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = randomNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "graph.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "graph.css"));
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${style}" />
  <title>Agent Orchestration</title>
</head>
<body>
  <header class="toolbar">
    <div class="brand"><span class="brand-mark">AO</span><div><strong>Agent Orchestration</strong><small id="stats">Scanning workspace…</small></div></div>
    <div class="toolbar-actions">
      <button id="auto-layout" title="Arrange agents automatically">Auto layout</button>
      <button id="refresh" title="Rescan agent and skill files">Refresh</button>
      <button id="create-skill">+ Skill</button>
      <button id="create-agent" class="primary">+ Agent</button>
    </div>
  </header>
  <main class="workspace">
    <section class="canvas-shell" id="canvas-shell" aria-label="Agent orchestration graph">
      <div id="empty" class="empty hidden"><div class="empty-icon">◇</div><h2>No repository agents yet</h2><p>Create an agent or add files under <code>.claude/agents</code>, <code>.github/agents</code>, or <code>.codex/agents</code>.</p><button id="empty-create" class="primary">Create first agent</button></div>
      <div class="canvas" id="canvas">
        <svg id="edges" class="edges" width="3200" height="2200" aria-hidden="true"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs></svg>
        <div id="nodes"></div>
      </div>
      <div id="connect-banner" class="connect-banner hidden">Select another agent to create a delegation <button id="cancel-connect">Cancel</button></div>
    </section>
    <aside class="inspector" id="inspector"><div class="inspector-empty"><span>◇</span><p>Select an agent or connection to edit it.</p></div></aside>
  </main>
  <div id="toast" class="toast hidden" role="status"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function validateName(value: string): string | undefined {
  return /^[a-zA-Z0-9._-]+$/.test(value) ? undefined : "Use letters, numbers, dots, underscores, or hyphens.";
}

function randomNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
