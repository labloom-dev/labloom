import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { checkMigrations, generateMigration } from "./lib/database.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = process.argv[2];
const help = {
    generate: "pnpm db:generate [--name <lowercase_name>] [--custom]\nGenerate repository SQL/snapshots and embed SQL for the app. Does not connect to a database.",
    check: "pnpm db:check\nCheck repository definitions, migration history and embedded SQL. Does not connect to a database.",
    init: "pnpm db:init --workspace <directory>\nCreate a development workspace in a new or empty folder. Never overwrites files.",
    status: "pnpm db:status --workspace <directory>\nRead the workspace version without creating or upgrading a database.",
    migrate: "pnpm db:migrate --workspace <directory>\nUpgrade an existing workspace with the application's backup and transaction workflow. Close the workspace in Labloom first."
};

try {
    if (!Object.hasOwn(help, command)) throw new Error("Expected a database command: generate, check, init, status, migrate.");
    const options = { help: { type: "boolean" } };
    if (command === "generate") Object.assign(options, { name: { type: "string" }, custom: { type: "boolean" } });
    if (["init", "status", "migrate"].includes(command)) options.workspace = { type: "string" };
    const { values, tokens } = parseArgs({ args: process.argv.slice(3), options, tokens: true, allowPositionals: false });
    const seen = new Set();
    for (const token of tokens) {
        if (token.kind !== "option" || seen.has(token.name)) throw new Error("Unexpected or repeated database command argument.");
        seen.add(token.name);
    }
    if (values.help) {
        if (tokens.length !== 1) throw new Error("Use --help on its own.");
        console.log(help[command]);
    }
    else if (command === "generate") console.log(await generateMigration(root, values));
    else if (command === "check") {
        console.log(`Repository migration check passed (workspace version ${await checkMigrations(root)}). No database was connected or migrated.`);
    }
    else {
        if (!values.workspace?.trim()) throw new Error("Specify --workspace <directory> explicitly.");
        const path = resolve(values.workspace);
        const { default: Database } = await import("better-sqlite3");
        const { workspaceFormatVersion } = await import("../main/storage/schema.ts");
        if (command === "status") {
            const database = new Database(join(path, "workspace.sqlite"), { readonly: true, fileMustExist: true });
            try {
                if (database.pragma("application_id", { simple: true }) !== 0x4c424c4d) throw new Error("Not a Labloom workspace database.");
                console.log(`Workspace: ${path}\nStored version: ${database.pragma("user_version", { simple: true })}\nApplication version: ${workspaceFormatVersion}\nRead only; no migrations applied.`);
            }
            finally {
                database.close();
            }
        }
        else {
            await checkMigrations(root);
            const { createWorkspace, openWorkspace } = await import("../main/storage/workspace.ts");
            if (command === "init") await mkdir(path, { recursive: true });
            const workspace = command === "init" ? createWorkspace(path) : openWorkspace(path);
            try {
                console.log(`${command === "init" ? "Created" : "Migrated"}: ${path}\nWorkspace version: ${workspace.database.pragma("user_version", { simple: true })}`);
            }
            finally {
                workspace.database.close();
            }
        }
    }
}
catch (error) {
    console.error(error.message);
    if (error.failure?.backupPath) console.error(`Pre-upgrade backup: ${error.failure.backupPath}`);
    process.exitCode = 1;
}