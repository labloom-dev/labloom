import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import typia from "@typia/unplugin/esbuild";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const benchmark = process.argv.includes("--perf");
const suites = ["ipc", "services", "workspace", "builtin-attrs", "drizzle", "attributes", "content", "history", "papers", "files", "schedule", "retention", "timestamps", "time-precision", "editor", "clipboard", "tabs", "session-views", "pdf-text", "feed", "purge", "failure", "appearance", "lifecycle", "workspace-lock"];
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export function buildTestMain(options) {
    return build({ ...options, plugins: [typia({ include: [/[/\\]main[/\\][^/\\]+[/\\]ipc\.ts$/], tsconfig: join(projectRoot, "configs/tsconfig.node.json") })] });
}

async function runWorkspace() {
    const localRoot = join(projectRoot, ".local");
    mkdirSync(localRoot, { recursive: true });
    const testRoot = mkdtempSync(join(localRoot, "workspace-schema-tests-"));

    function removeTestDirectory() {
        const resolvedRoot = realpathSync(testRoot);
        const relativeRoot = relative(realpathSync(localRoot), resolvedRoot);
        if (!relativeRoot || isAbsolute(relativeRoot) || relativeRoot === ".." || relativeRoot.startsWith(`..${sep}`)) {
            throw new Error("Refusing to remove a test directory outside .local.");
        }
        rmSync(resolvedRoot, { recursive: true, force: true });
    }

    try {
        await buildTestMain({
            absWorkingDir: projectRoot,
            entryPoints: benchmark ? ["tests/perf/bench.ts", "tests/perf/ipc.ts"] : suites.map(name => `tests/${name}.test.ts`),
            outdir: testRoot,
            outExtension: { ".js": ".cjs" },
            bundle: true,
            platform: "node",
            format: "cjs",
            target: "node22",
            packages: "external"
        });

        // Use the application's Node runtime for its native SQLite dependency.
        const runs = benchmark ? [[join(testRoot, "bench.cjs")], [join(testRoot, "ipc.cjs")]] : [["--test", ...suites.map(name => join(testRoot, `${name}.test.cjs`))]];
        for (const args of runs) execFileSync(require("electron"), args, {
            cwd: projectRoot,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", LABLOOM_TEST_ROOT: testRoot },
            stdio: "inherit",
            windowsHide: true
        });
    }
    finally {
        removeTestDirectory();
    }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await runWorkspace();