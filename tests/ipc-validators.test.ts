import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { ipcValidators } from "../configs/ipc-validators";

test("cached IPC validators follow imported types across development builds", async t => {
    const local = resolve(".local");
    mkdirSync(local, { recursive: true });
    const root = mkdtempSync(join(local, "ipc-validator-test-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const folder of ["configs", "main/a", "main/b", "shared/value"]) mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
    writeFileSync(join(root, "configs/tsconfig.node.json"), JSON.stringify({
        compilerOptions: { strict: true, target: "ESNext", module: "ESNext", moduleResolution: "bundler", types: [] },
        include: ["../main", "../shared"]
    }));
    const leaf = join(root, "shared/value/index.ts");
    writeFileSync(leaf, "export type Value = string");
    writeFileSync(join(root, "shared/contract.ts"), "export type { Value } from './value'");
    const entryA = join(root, "main/a/ipc.ts"), entryB = join(root, "main/b/ipc.ts");
    writeFileSync(entryA, "import typia from 'typia'; import type { Value } from '../../shared/contract'; export const check = typia.createAssert<Value>();");
    writeFileSync(entryB, "import typia from 'typia'; export const check = typia.createAssert<boolean>();");

    const cacheDir = join(root, "cache");
    let run = 0;
    async function compile(directory = cacheDir): Promise<(input: unknown) => unknown> {
        await build({
            root, configFile: false, cacheDir: directory, logLevel: "error", plugins: [ipcValidators()],
            build: {
                minify: false, sourcemap: true, lib: { entry: { a: entryA, b: entryB }, formats: ["es"] },
                rolldownOptions: { external: /^typia(?:\/|$)/, output: { entryFileNames: "[name].mjs" } }
            }
        });
        const url = pathToFileURL(join(root, "dist/a.mjs"));
        url.searchParams.set("run", String(++run));
        return (await import(url.href)).check;
    }

    const cold = await compile();
    assert.equal(cold("text"), "text");
    assert.throws(() => cold(1));
    const map = JSON.parse(readFileSync(join(root, "dist/a.mjs.map"), "utf8"));
    assert.ok(map.sourcesContent.includes(readFileSync(entryA, "utf8")));
    const a = join(cacheDir, "labloom-ipc/a.json"), b = join(cacheDir, "labloom-ipc/b.json");
    const inputs = join(cacheDir, "labloom-ipc/inputs.json");
    for (const file of [a, b, inputs]) utimesSync(file, 1, 1);
    const warm = await compile();
    assert.throws(() => warm(1));
    assert.equal(statSync(a).mtimeMs, 1000);
    assert.equal(statSync(b).mtimeMs, 1000);
    assert.equal(statSync(inputs).mtimeMs, 1000);

    const previousTime = statSync(leaf).mtime;
    writeFileSync(leaf, "export type Value = number");
    utimesSync(leaf, previousTime, previousTime);
    const changed = await compile();
    assert.equal(changed(1), 1);
    assert.throws(() => changed("text"));
    assert.notEqual(statSync(a).mtimeMs, 1000);
    assert.equal(statSync(b).mtimeMs, 1000);

    writeFileSync(join(root, "shared/value.ts"), "export type Value = boolean");
    const shadowed = await compile();
    assert.equal(shadowed(true), true);
    assert.throws(() => shadowed(1));

    writeFileSync(a, "{");
    const recovered = await compile();
    assert.equal(recovered(true), true);
    assert.throws(() => recovered(1));

    const unwritable = join(root, "unwritable");
    mkdirSync(unwritable);
    writeFileSync(join(unwritable, "labloom-ipc"), "occupied");
    const uncached = await compile(unwritable);
    assert.equal(uncached(true), true);
    assert.throws(() => uncached(1));
});