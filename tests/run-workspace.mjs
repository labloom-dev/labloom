import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const benchmark = process.argv.includes("--perf");
const suites = ["workspace", "builtin-attrs", "drizzle", "attributes", "content", "papers", "schedule", "retention", "timestamps", "time-precision", "editor", "tabs", "session-views", "pdf-text", "feed", "purge"];
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
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
    await build({
        absWorkingDir: projectRoot,
        entryPoints: benchmark ? ["tests/perf/bench.ts"] : suites.map(name => `tests/${name}.test.ts`),
        outdir: testRoot,
        outExtension: { ".js": ".cjs" },
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        packages: "external"
    });

    // Use the application's Node runtime for its native SQLite dependency.
    const args = benchmark ? [join(testRoot, "bench.cjs")] : ["--test", ...suites.map(name => join(testRoot, `${name}.test.cjs`))];
    execFileSync(require("electron"), args, {
        cwd: projectRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", LABLOOM_TEST_ROOT: testRoot },
        stdio: "inherit",
        windowsHide: true
    });
}
finally {
    removeTestDirectory();
}