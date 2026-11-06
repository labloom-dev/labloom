import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
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
        entryPoints: ["tests/workspace.test.ts", "tests/builtin-attrs.test.ts", "tests/drizzle.test.ts"],
        outdir: testRoot,
        outExtension: { ".js": ".cjs" },
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        packages: "external"
    });

    // Use the application's Node runtime for its native SQLite dependency.
    execFileSync(require("electron"), ["--test", join(testRoot, "workspace.test.cjs"), join(testRoot, "builtin-attrs.test.cjs"), join(testRoot, "drizzle.test.cjs")], {
        cwd: projectRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", LABLOOM_TEST_ROOT: testRoot },
        stdio: "inherit",
        windowsHide: true
    });
}
finally {
    removeTestDirectory();
}