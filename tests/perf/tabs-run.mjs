// The benchmark uses the development renderer with its own server, Electron process and workspace.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildTestMain } from "../run-workspace.mjs";
import { build } from "esbuild";
import typia from "@typia/unplugin/vite";
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const editing = process.argv.includes("--editing");
const library = process.argv.includes("--library");
const reader = process.argv.includes("--reader");
const picker = library || editing || process.argv.includes("--picker");
const local = join(root, ".local");
mkdirSync(local, { recursive: true });
const dir = mkdtempSync(join(local, reader ? "reader-benchmark-" : picker ? "picker-benchmark-" : "tab-benchmark-"));
const pdfAssets = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")).replaceAll("\\", "/");
const server = await createServer({ root: process.env.LABLOOM_RENDERER_ROOT ?? join(root, "renderer"), configFile: false, cacheDir: join(dir, "vite"),
    ...(picker || reader ? { optimizeDeps: { entries: ["index.html", "components/Editor/code-worker.ts"], exclude: ["svelte/elements"], include: ["typia/lib/internal/_accessExpressionAsString"] } } : {}),
    plugins: [typia({ include: [/[/\\]Tab[/\\]restore\.ts$/], tsconfig: join(root, "configs/tsconfig.web.json") }), svelte({ configFile: join(root, "configs/svelte.config.js") }),
        ...(reader ? [viteStaticCopy({ targets: ["cmaps", "iccs", "standard_fonts", "wasm"].map(folder => ({
            src: pdfAssets + "/" + folder + "/*", dest: "pdfjs/" + folder, rename: { stripBase: true }
        })) })] : [])],
    server: { host: "127.0.0.1", port: reader ? 15176 : 0, hmr: false, watch: null, ...(reader ? { forwardConsole: false } : {}), fs: { allow: [root] } } });
try {
    const options = { absWorkingDir: root, bundle: true, platform: "node", format: "cjs", packages: "external", outdir: dir, outExtension: { ".js": ".cjs" } };
    await buildTestMain({ ...options, entryPoints: { main: reader ? "tests/perf/reader-main.ts" : library ? "tests/perf/library-main.ts" : picker ? "tests/perf/picker-main.ts" : "tests/perf/tabs-main.ts" } });
    await build({ ...options, entryPoints: { preload: "preload/index.ts" } });
    await server.listen();
    const env = { ...process.env, LABLOOM_TEST_ROOT: dir, LABLOOM_BENCH_URL: server.resolvedUrls.local[0] };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const scale of reader ? ["reader"] : picker ? [editing ? "editing" : "B"] : process.env.LABLOOM_TAB_SCALE ? [process.env.LABLOOM_TAB_SCALE] : ["A", "B"]) {
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