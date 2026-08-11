import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
});

const testContext = await esbuild.context({
  entryPoints: ["src/test/suite/index.ts"],
  bundle: true,
  outfile: "dist/test/suite/index.cjs",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
});

if (watch) {
  await context.watch();
  await testContext.watch();
} else {
  await context.rebuild();
  await testContext.rebuild();
  await context.dispose();
  await testContext.dispose();
}
