// The benchmark uses the development renderer with its own server, Electron process and workspace.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const local = join(root, ".local");
mkdirSync(local, { recursive: true });
const dir = mkdtempSync(join(local, "tab-benchmark-"));
const server = await createServer({ root: join(root, "renderer"), configFile: false, cacheDir: join(dir, "vite"),
    plugins: [svelte({ configFile: join(root, "configs/svelte.config.js") })],
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [root] } } });
try {
    await build({ absWorkingDir: root, entryPoints: { main: "tests/perf/tabs-main.ts", preload: "preload/index.ts" }, bundle: true,
        platform: "node", format: "cjs", packages: "external", outdir: dir, outExtension: { ".js": ".cjs" } });
    await server.listen();
    const env = { ...process.env, LABLOOM_TEST_ROOT: dir, LABLOOM_BENCH_URL: server.resolvedUrls.local[0] };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const scale of ["A", "B"]) {
        const run = spawn(createRequire(import.meta.url)("electron"), [join(dir, "main.cjs"), scale], { cwd: root, env, stdio: "inherit", windowsHide: true });
        const code = await new Promise((resolve, reject) => {
            run.once("error", reject);
            run.once("exit", status => resolve(status ?? 1));
        });
        if (code) process.exitCode = code;
    }
}
finally {
    await server.close();
    const path = relative(realpathSync(local), realpathSync(dir));
    if (!path || isAbsolute(path) || path === ".." || path.startsWith(".." + sep)) {
        console.error("Invalid benchmark directory");
        process.exitCode = 1;
    }
    else rmSync(dir, { recursive: true, force: true, maxRetries: 4 });
}