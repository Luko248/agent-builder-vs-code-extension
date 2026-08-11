import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AgentProvider, AgentRecord, GraphEdge, SkillRecord } from "./types";
import { PROVIDER_COLORS } from "./types";

export interface FrontmatterDocument {
  attributes: Record<string, unknown>;
  body: string;
}

const START_MARKER = "<!-- agent-orchestration:managed:start -->";
const END_MARKER = "<!-- agent-orchestration:managed:end -->";

export function parseFrontmatter(source: string): FrontmatterDocument {
  const normalized = source.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) {
    return { attributes: {}, body: normalized.trimStart() };
  }
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) {
    return { attributes: {}, body: normalized.trimStart() };
  }
  const attributes = (parseYaml(match[1] ?? "") ?? {}) as Record<string, unknown>;
  return { attributes, body: normalized.slice(match[0].length) };
}

export function stringifyFrontmatter(attributes: Record<string, unknown>, body: string): string {
  const header = stringifyYaml(attributes, { lineWidth: 0 }).trimEnd();
  return `---\n${header}\n---\n\n${body.trim()}\n`;
}

export function withoutManagedBlock(prompt: string): string {
  const start = prompt.indexOf(START_MARKER);
  if (start < 0) return prompt.trim();
  const end = prompt.indexOf(END_MARKER, start);
  if (end < 0) return prompt.slice(0, start).trim();
  return `${prompt.slice(0, start)}${prompt.slice(end + END_MARKER.length)}`.trim();
}

export function withManagedBlock(
  prompt: string,
  agent: Pick<AgentRecord, "name" | "provider" | "tools" | "skills">,
  outgoing: Array<{ targetName: string; label: string }>,
): string {
  const clean = withoutManagedBlock(prompt);
  if (outgoing.length === 0) return clean;
  const lines = [START_MARKER, "## Visual orchestration", "", "This section is synchronized by Agent Orchestration Studio.", ""];
  for (const edge of outgoing) {
    lines.push(`- Delegate to \`${edge.targetName}\` when ${edge.label || "its specialty is needed"}.`);
  }
  if (agent.skills.length > 0) lines.push(`- Use these assigned skills when relevant: ${agent.skills.map((skill) => `\`${skill}\``).join(", ")}.`);
  if (agent.provider === "codex" && agent.tools.length > 0) {
    lines.push(`- Requested tool capabilities: ${agent.tools.map((tool) => `\`${tool}\``).join(", ")}. Availability remains governed by Codex configuration and the parent session.`);
  }
  lines.push(END_MARKER);
  return `${clean}\n\n${lines.join("\n")}`.trim();
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseMarkdownAgent(provider: "claude" | "github", file: string, source: string): AgentRecord {
  const { attributes, body } = parseFrontmatter(source);
  const fallback = file.split("/").pop()?.replace(/\.agent\.md$|\.md$/i, "") ?? "agent";
  const name = stringValue(attributes.name) ?? fallback;
  const userInvokable = provider === "github" ? boolValue(attributes["user-invocable"], true) : true;
  const autoInvokable = provider === "github" ? !boolValue(attributes["disable-model-invocation"], false) : true;
  return {
    id: `${provider}:${file}`,
    provider,
    file,
    name,
    title: stringValue(attributes["display-name"]) ?? name,
    description: stringValue(attributes.description) ?? "",
    prompt: withoutManagedBlock(body),
    model: stringValue(attributes.model),
    color: stringValue(attributes.color) ?? PROVIDER_COLORS[provider],
    permissionMode: stringValue(attributes.permissionMode) ?? stringValue(attributes["permission-mode"]),
    tools: stringArray(attributes.tools),
    skills: stringArray(attributes.skills),
    userInvokable,
    autoInvokable,
    position: { x: 0, y: 0 },
  };
}

export function serializeMarkdownAgent(agent: AgentRecord, previousSource: string, prompt: string): string {
  const current = parseFrontmatter(previousSource);
  const attributes = { ...current.attributes };
  attributes.name = agent.name;
  attributes.description = agent.description;
  if (agent.model) attributes.model = agent.model;
  else delete attributes.model;
  if (agent.tools.length > 0) attributes.tools = agent.tools;
  else delete attributes.tools;
  if (agent.skills.length > 0) attributes.skills = agent.skills;
  else delete attributes.skills;

  if (agent.provider === "claude") {
    if (agent.permissionMode) attributes.permissionMode = agent.permissionMode;
    else delete attributes.permissionMode;
    attributes.color = agent.color;
  } else {
    attributes["user-invocable"] = agent.userInvokable;
    attributes["disable-model-invocation"] = !agent.autoInvokable;
  }
  return stringifyFrontmatter(attributes, prompt);
}

export function parseCodexAgent(file: string, source: string): AgentRecord {
  const data = parseToml(source) as Record<string, unknown>;
  const fallback = file.split("/").pop()?.replace(/\.toml$/i, "") ?? "agent";
  const skills = data.skills as { config?: Array<{ path?: string; enabled?: boolean }> } | undefined;
  return {
    id: `codex:${file}`,
    provider: "codex",
    file,
    name: stringValue(data.name) ?? fallback,
    title: stringValue(data.display_name) ?? stringValue(data.name) ?? fallback,
    description: stringValue(data.description) ?? "",
    prompt: withoutManagedBlock(stringValue(data.developer_instructions) ?? ""),
    model: stringValue(data.model),
    color: PROVIDER_COLORS.codex,
    permissionMode: stringValue(data.sandbox_mode),
    tools: [],
    skills: (skills?.config ?? [])
      .filter((entry) => entry.enabled !== false && entry.path)
      .map((entry) => entry.path!.replace(/\\/g, "/").split("/").slice(-2, -1)[0] ?? entry.path!),
    userInvokable: true,
    autoInvokable: true,
    position: { x: 0, y: 0 },
  };
}

export function serializeCodexAgent(agent: AgentRecord, previousSource: string, prompt: string, skills: SkillRecord[]): string {
  const data = parseToml(previousSource) as Record<string, unknown>;
  data.name = agent.name;
  data.description = agent.description;
  data.developer_instructions = prompt;
  if (agent.model) data.model = agent.model;
  else delete data.model;
  if (agent.permissionMode) data.sandbox_mode = agent.permissionMode;
  else delete data.sandbox_mode;
  const configured = agent.skills
    .map((name) => skills.find((skill) => skill.name === name))
    .filter((skill): skill is SkillRecord => Boolean(skill))
    .map((skill) => ({ path: skill.file, enabled: true }));
  if (configured.length > 0) data.skills = { config: configured };
  else delete data.skills;
  return `${stringifyToml(data)}\n`;
}

export function parseSkill(file: string, source: string): SkillRecord {
  const { attributes } = parseFrontmatter(source);
  const fallback = file.split("/").slice(-2, -1)[0] ?? "skill";
  const provider: SkillRecord["provider"] = file.startsWith(".claude/")
    ? "claude"
    : file.startsWith(".github/")
      ? "github"
      : file.startsWith(".codex/")
        ? "codex"
        : "shared";
  const name = stringValue(attributes.name) ?? fallback;
  return { id: `skill:${file}`, name, description: stringValue(attributes.description) ?? "", file, provider };
}

export function nextEdgeId(edges: GraphEdge[]): string {
  let index = edges.length + 1;
  while (edges.some((edge) => edge.id === `edge-${index}`)) index += 1;
  return `edge-${index}`;
}

export const MANAGED_MARKERS = { START_MARKER, END_MARKER };
