import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const userData = await mkdtemp(join(tmpdir(), "agent-orchestration-vscode-user-"));
const extensions = await mkdtemp(join(tmpdir(), "agent-orchestration-vscode-ext-"));
const workspace = await mkdtemp(join(tmpdir(), "agent-orchestration-workspace-"));
await cp(join(root, "fixtures/demo-repo"), workspace, { recursive: true });
const code = process.env.CODE_PATH || "code";
const args = [
  "--new-window",
  "--disable-extensions",
  `--user-data-dir=${userData}`,
  `--extensions-dir=${extensions}`,
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${join(root, "dist/test/suite/index.cjs")}`,
  workspace,
];

try {
  const exitCode = await new Promise((resolveCode, reject) => {
    const child = spawn(code, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (codeValue) => resolveCode(codeValue ?? 1));
  });
  if (exitCode !== 0) throw new Error(`VS Code extension tests exited with code ${exitCode}`);
} finally {
  await rm(userData, { recursive: true, force: true });
  await rm(extensions, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
