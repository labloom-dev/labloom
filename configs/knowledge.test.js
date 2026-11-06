import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, ".local"), { recursive: true });
const output = mkdtempSync(join(root, ".local", "knowledge-tests-"));
try {
    await build({ entryPoints: [join(root, "tests/knowledge.test.ts")], outfile: join(output, "test.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22", packages: "external" });
    execFileSync(process.execPath, ["--test", join(output, "test.cjs")], { cwd: root, stdio: "inherit" });
}
finally { rmSync(output, { recursive: true, force: true }); }