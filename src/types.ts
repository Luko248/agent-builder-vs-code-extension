export type AgentProvider = "claude" | "github" | "codex";

export type Point = { x: number; y: number };

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  file: string;
  provider: AgentProvider | "shared";
}

export interface AgentRecord {
  id: string;
  provider: AgentProvider;
  file: string;
  name: string;
  title: string;
  description: string;
  prompt: string;
  model?: string;
  color: string;
  permissionMode?: string;
  tools: string[];
  skills: string[];
  userInvokable: boolean;
  autoInvokable: boolean;
  position: Point;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  style?: "solid" | "dashed";
}

export interface GraphManifest {
  version: 1;
  nodes: Record<string, Partial<Pick<AgentRecord, "title" | "color" | "position" | "userInvokable" | "autoInvokable">>>;
  edges: GraphEdge[];
}

export interface GraphSnapshot {
  root: string;
  agents: AgentRecord[];
  skills: SkillRecord[];
  edges: GraphEdge[];
}

export const DEFAULT_MANIFEST: GraphManifest = { version: 1, nodes: {}, edges: [] };

export const PROVIDER_COLORS: Record<AgentProvider, string> = {
  claude: "#D97757",
  github: "#7C5CFC",
  codex: "#16A394",
};
