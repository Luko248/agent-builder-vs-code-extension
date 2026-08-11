import * as path from "node:path";
import * as vscode from "vscode";
import {
  parseCodexAgent,
  parseMarkdownAgent,
  parseSkill,
  serializeCodexAgent,
  serializeMarkdownAgent,
  withManagedBlock,
} from "./core";
import type { AgentProvider, AgentRecord, GraphEdge, GraphManifest, GraphSnapshot, SkillRecord } from "./types";
import { DEFAULT_MANIFEST, PROVIDER_COLORS } from "./types";

const AGENT_PATTERNS: Array<[AgentProvider, string]> = [
  ["claude", ".claude/agents/**/*.md"],
  ["github", ".github/agents/**/*.md"],
  ["codex", ".codex/agents/**/*.toml"],
];

const SKILL_PATTERNS = [
  ".claude/skills/**/SKILL.md",
  ".github/skills/**/SKILL.md",
  ".agents/skills/**/SKILL.md",
  ".codex/skills/**/SKILL.md",
];

function workspaceRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a folder or workspace before using Agent Orchestration Studio.");
  return folder.uri;
}

function relativePath(root: vscode.Uri, uri: vscode.Uri): string {
  return path.relative(root.fsPath, uri.fsPath).replace(/\\/g, "/");
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

async function writeText(uri: vscode.Uri, source: string): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(source));
}

async function find(pattern: string): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(pattern, "**/{node_modules,.git,dist}/**");
}

export class AgentRepository {
  private snapshot: GraphSnapshot | undefined;

  public get current(): GraphSnapshot | undefined {
    return this.snapshot;
  }

  public async scan(): Promise<GraphSnapshot> {
    const root = workspaceRoot();
    const manifest = await this.readManifest(root);
    const agents: AgentRecord[] = [];
    const skills: SkillRecord[] = [];

    for (const [provider, pattern] of AGENT_PATTERNS) {
      for (const uri of await find(pattern)) {
        const file = relativePath(root, uri);
        try {
          const source = await readText(uri);
          const agent = provider === "codex" ? parseCodexAgent(file, source) : parseMarkdownAgent(provider, file, source);
          agents.push(agent);
        } catch (error) {
          console.warn(`[Agent Orchestration] Could not parse ${file}`, error);
        }
      }
    }

    for (const pattern of SKILL_PATTERNS) {
      for (const uri of await find(pattern)) {
        const file = relativePath(root, uri);
        if (skills.some((skill) => skill.file === file)) continue;
        try {
          skills.push(parseSkill(file, await readText(uri)));
        } catch (error) {
          console.warn(`[Agent Orchestration] Could not parse ${file}`, error);
        }
      }
    }

    agents.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
    skills.sort((a, b) => a.name.localeCompare(b.name));
    agents.forEach((agent, index) => {
      const saved = manifest.nodes[agent.id];
      agent.title = saved?.title ?? agent.title;
      agent.color = saved?.color ?? agent.color;
      agent.userInvokable = saved?.userInvokable ?? agent.userInvokable;
      agent.autoInvokable = saved?.autoInvokable ?? agent.autoInvokable;
      agent.position = saved?.position ?? { x: 80 + (index % 4) * 320, y: 90 + Math.floor(index / 4) * 240 };
    });
    const ids = new Set(agents.map((agent) => agent.id));
    this.snapshot = {
      root: root.fsPath,
      agents,
      skills,
      edges: manifest.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    };
    return this.snapshot;
  }

  public async saveAgent(next: AgentRecord): Promise<GraphSnapshot> {
    const snapshot = this.requireSnapshot();
    const existing = snapshot.agents.find((agent) => agent.id === next.id);
    if (!existing) throw new Error(`Agent not found: ${next.id}`);
    Object.assign(existing, next, { id: existing.id, file: existing.file, provider: existing.provider });
    await this.writeAgentFile(existing);
    await this.saveManifest();
    return this.scan();
  }

  public async saveLayout(positions: Record<string, { x: number; y: number }>): Promise<void> {
    const snapshot = this.requireSnapshot();
    for (const agent of snapshot.agents) {
      const position = positions[agent.id];
      if (position) agent.position = position;
    }
    await this.saveManifest();
  }

  public async addEdge(edge: GraphEdge): Promise<GraphSnapshot> {
    const snapshot = this.requireSnapshot();
    if (edge.source === edge.target) throw new Error("An agent cannot delegate to itself.");
    const duplicate = snapshot.edges.some((current) => current.source === edge.source && current.target === edge.target);
    if (!duplicate) snapshot.edges.push(edge);
    await this.saveManifest();
    await this.syncPromptBlocks();
    return this.scan();
  }

  public async updateEdge(edge: GraphEdge): Promise<GraphSnapshot> {
    const snapshot = this.requireSnapshot();
    const current = snapshot.edges.find((item) => item.id === edge.id);
    if (!current) throw new Error(`Connection not found: ${edge.id}`);
    Object.assign(current, edge);
    await this.saveManifest();
    await this.syncPromptBlocks();
    return this.scan();
  }

  public async deleteEdge(id: string): Promise<GraphSnapshot> {
    const snapshot = this.requireSnapshot();
    snapshot.edges = snapshot.edges.filter((edge) => edge.id !== id);
    await this.saveManifest();
    await this.syncPromptBlocks();
    return this.scan();
  }

  public async createAgent(provider: AgentProvider, name: string, description: string): Promise<GraphSnapshot> {
    const root = workspaceRoot();
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!safeName) throw new Error("Agent name must contain letters or numbers.");
    const file = provider === "claude"
      ? `.claude/agents/${safeName}.md`
      : provider === "github"
        ? `.github/agents/${safeName}.agent.md`
        : `.codex/agents/${safeName}.toml`;
    const uri = vscode.Uri.joinPath(root, file);
    try {
      await vscode.workspace.fs.stat(uri);
      throw new Error(`${file} already exists.`);
    } catch (error) {
      if (error instanceof Error && error.message.endsWith("already exists.")) throw error;
    }
    const agent: AgentRecord = {
      id: `${provider}:${file}`,
      provider,
      file,
      name: safeName,
      title: name.trim(),
      description,
      prompt: `You are the ${name.trim()} agent.\n\n${description}`,
      color: PROVIDER_COLORS[provider],
      tools: [],
      skills: [],
      userInvokable: true,
      autoInvokable: true,
      position: { x: 120, y: 120 },
    };
    const source = provider === "codex"
      ? serializeCodexAgent(agent, "", agent.prompt, [])
      : serializeMarkdownAgent(agent, "", agent.prompt);
    await writeText(uri, source);
    return this.scan();
  }

  public async createSkill(provider: AgentProvider | "shared", name: string, description: string): Promise<GraphSnapshot> {
    const root = workspaceRoot();
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!safeName) throw new Error("Skill name must contain letters or numbers.");
    const base = provider === "claude" ? ".claude/skills" : provider === "github" ? ".github/skills" : provider === "codex" ? ".codex/skills" : ".agents/skills";
    const file = `${base}/${safeName}/SKILL.md`;
    const body = `---\nname: ${safeName}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name.trim()}\n\nDescribe the workflow this skill should follow.\n`;
    await writeText(vscode.Uri.joinPath(root, file), body);
    return this.scan();
  }

  public uriFor(relativeFile: string): vscode.Uri {
    return vscode.Uri.joinPath(workspaceRoot(), relativeFile);
  }

  private requireSnapshot(): GraphSnapshot {
    if (!this.snapshot) throw new Error("Agent repository has not been scanned yet.");
    return this.snapshot;
  }

  private async readManifest(root: vscode.Uri): Promise<GraphManifest> {
    const file = vscode.workspace.getConfiguration("agentOrchestration").get<string>("graphFile", ".agent-graph.json");
    try {
      const parsed = JSON.parse(await readText(vscode.Uri.joinPath(root, file))) as GraphManifest;
      return { version: 1, nodes: parsed.nodes ?? {}, edges: parsed.edges ?? [] };
    } catch {
      return structuredClone(DEFAULT_MANIFEST);
    }
  }

  private async saveManifest(): Promise<void> {
    const snapshot = this.requireSnapshot();
    const root = workspaceRoot();
    const file = vscode.workspace.getConfiguration("agentOrchestration").get<string>("graphFile", ".agent-graph.json");
    const manifest: GraphManifest = {
      version: 1,
      nodes: Object.fromEntries(snapshot.agents.map((agent) => [agent.id, {
        title: agent.title,
        color: agent.color,
        position: agent.position,
        userInvokable: agent.userInvokable,
        autoInvokable: agent.autoInvokable,
      }])),
      edges: snapshot.edges,
    };
    await writeText(vscode.Uri.joinPath(root, file), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  private async syncPromptBlocks(): Promise<void> {
    if (!vscode.workspace.getConfiguration("agentOrchestration").get<boolean>("writePromptBlocks", true)) return;
    const snapshot = this.requireSnapshot();
    for (const agent of snapshot.agents) await this.writeAgentFile(agent);
  }

  private async writeAgentFile(agent: AgentRecord): Promise<void> {
    const snapshot = this.requireSnapshot();
    const uri = this.uriFor(agent.file);
    const previous = await readText(uri);
    const outgoing = snapshot.edges
      .filter((edge) => edge.source === agent.id)
      .map((edge) => ({ targetName: snapshot.agents.find((item) => item.id === edge.target)?.name ?? edge.target, label: edge.label }));
    const prompt = withManagedBlock(agent.prompt, agent, outgoing);
    const source = agent.provider === "codex"
      ? serializeCodexAgent(agent, previous, prompt, snapshot.skills)
      : serializeMarkdownAgent(agent, previous, prompt);
    await writeText(uri, source);
  }
}
