import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const local = join(root, ".local");
mkdirSync(local, { recursive: true });
const directory = mkdtempSync(join(local, "editor-prototype-"));
const common = { absWorkingDir: root, bundle: true, outdir: directory };
function cleanup() {
    const path = relative(realpathSync(local), realpathSync(directory));
    if (!path || isAbsolute(path) || path.startsWith(".." + sep) || path === "..") throw new Error("Invalid prototype directory");
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}

try {
    await Promise.all([
        build({ ...common, entryPoints: ["tests/perf/editor-main.ts", "tests/perf/editor-preload.ts"], platform: "node", format: "cjs", packages: "external", outExtension: { ".js": ".cjs" } }),
        build({ ...common, entryPoints: ["tests/perf/editor-renderer.ts"], platform: "browser", loader: { ".ttf": "file" } })
    ]);
    copyFileSync(join(root, "tests/perf/editor.html"), join(directory, "editor.html"));
    const electron = createRequire(import.meta.url)("electron");
    const env = { ...process.env, LABLOOM_TEST_ROOT: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [join(directory, "editor-main.cjs")], { cwd: root, stdio: "inherit", env });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}
finally {
    cleanup();
}