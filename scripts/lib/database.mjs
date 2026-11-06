import { readFile, readdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";

export const baseVersion = 4;
const originId = "00000000-0000-0000-0000-000000000000";
const separator = "\n--> statement-breakpoint\n";
const customPlaceholder = "-- Add the data migration or table rebuild here before applying.";

export function migrationDirectory(root) {
    return join(root, "main/storage/migrations/generated");
}

export function json(value) {
    return JSON.stringify(value, null, 4);
}

export function splitSql(sql) {
    return sql.trim().split(/^--> statement-breakpoint\s*$/m).map(part => part.trim()).filter(Boolean);
}

export function joinSql(statements) {
    return statements.map(statement => statement.trim()).filter(Boolean).join(separator);
}

export function ruleObjects(rules) {
    const names = new Set();
    return splitSql(rules).map(statement => {
        const match = /^CREATE (TRIGGER|VIEW) ([a-z_][a-z0-9_]*)\b/i.exec(statement);
        if (!match || names.has(match[2])) throw new Error("rules.sql must contain uniquely named CREATE TRIGGER/VIEW statements separated by statement-breakpoint markers.");
        names.add(match[2]);
        return { kind: match[1].toUpperCase(), name: match[2] };
    });
}

export function schemaModel(snapshot) {
    const { id, prevId, ...model } = snapshot;
    // Drizzle includes undefined properties in memory; snapshots are persisted JSON.
    return JSON.parse(JSON.stringify(model));
}

export async function currentSchema(root, previousId = originId) {
    const tables = await import(pathToFileURL(join(root, "main/storage/tables.ts")).href);
    const snapshot = await generateSQLiteDrizzleJson(tables, previousId);
    const rules = (await readFile(join(root, "main/storage/rules.sql"), "utf8")).trim();
    ruleObjects(rules);
    const options = JSON.parse(await readFile(join(root, "main/storage/table-options.json"), "utf8"));
    if (Object.keys(options).join() !== "strictTables" || !Array.isArray(options.strictTables)
        || new Set(options.strictTables).size !== options.strictTables.length
        || options.strictTables.some(name => !Object.hasOwn(snapshot.tables, name))) {
        throw new Error("table-options.json must list existing tables once under strictTables.");
    }
    return { snapshot, rules, options };
}

export async function readHistory(root) {
    const directory = migrationDirectory(root);
    const journal = JSON.parse(await readFile(join(directory, "meta/_journal.json"), "utf8"));
    if (journal.version !== 1 || journal.dialect !== "sqlite" || journal.baseVersion !== baseVersion || !journal.entries?.length) {
        throw new Error("Invalid generated migration journal.");
    }
    const migrations = [];
    const expectedFiles = ["index.ts", "meta"];
    const expectedMeta = ["_journal.json"];
    let previousId = originId;
    for (const [index, entry] of journal.entries.entries()) {
        const version = baseVersion + index + 1;
        const prefix = String(version).padStart(4, "0");
        if (entry.version !== version || !new RegExp(`^${prefix}_[a-z][a-z0-9_]*$`).test(entry.tag)) {
            throw new Error("Generated migrations must form a continuous history after version 4.");
        }
        const sql = await readFile(join(directory, `${entry.tag}.sql`), "utf8");
        const snapshot = JSON.parse(await readFile(join(directory, `meta/${prefix}_snapshot.json`), "utf8"));
        const rules = await readFile(join(directory, `meta/${prefix}_rules.sql`), "utf8");
        const options = JSON.parse(await readFile(join(directory, `meta/${prefix}_options.json`), "utf8"));
        if (!sql.trim() || snapshot.prevId !== previousId || !snapshot.id || snapshot.id === previousId) {
            throw new Error(`Invalid migration or snapshot chain at ${entry.tag}.`);
        }
        if (/^\s*PRAGMA\s+(?:foreign_keys|user_version|application_id)\b/im.test(sql)) {
            throw new Error(`${entry.tag}: connection and version PRAGMAs belong to the workspace migration runner.`);
        }
        if (sql.includes(customPlaceholder)) {
            throw new Error(`${entry.tag}: replace the custom migration placeholder with SQL before checking or applying it.`);
        }
        if (splitSql(sql).some(statement => /^(?:BEGIN|COMMIT|END|ROLLBACK)\b/i.test(statement.replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)\s*/g, "")))) {
            throw new Error(`${entry.tag}: transaction boundaries belong to the workspace migration runner.`);
        }
        ruleObjects(rules);
        previousId = snapshot.id;
        migrations.push({ ...entry, sql, snapshot, rules, options });
        expectedFiles.push(`${entry.tag}.sql`);
        expectedMeta.push(`${prefix}_snapshot.json`, `${prefix}_rules.sql`, `${prefix}_options.json`);
    }
    if (!isDeepStrictEqual((await readdir(directory)).sort(), expectedFiles.sort())
        || !isDeepStrictEqual((await readdir(join(directory, "meta"))).sort(), expectedMeta.sort())) {
        throw new Error("Migration files do not match the journal; check for missing or orphaned files.");
    }
    return { journal, migrations };
}

export function runtimeModule(migrations) {
    const entries = migrations.map(migration => `    {
        from: ${migration.version - 1},
        to: ${migration.version},
        foreignKeysOff: true,
        up(database) {
            ${migration.sql.includes(customPlaceholder)
                ? `throw new Error(${JSON.stringify(`${migration.tag}: custom migration is incomplete. Fill in its SQL and run pnpm db:generate.`)});`
                : `database.exec(${JSON.stringify(migration.sql)});`}
        }
    }`);
    return `// Generated by pnpm db:generate from the committed SQL. Do not edit by hand.
// Embed SQL so packaged applications do not depend on development file paths.
import { type WorkspaceMigration } from "../runner";

export const generatedMigrations: readonly WorkspaceMigration[] = [
${entries.join(",\n")}
];`;
}

export function matchesCurrent(current, previous) {
    return isDeepStrictEqual(schemaModel(current.snapshot), schemaModel(previous.snapshot))
        && current.rules === previous.rules && isDeepStrictEqual(current.options, previous.options);
}

export async function checkMigrations(root) {
    const history = await readHistory(root);
    const previous = history.migrations.at(-1);
    if (!matchesCurrent(await currentSchema(root, previous.snapshot.id), previous)) {
        throw new Error("Database definitions have changed. Run pnpm db:generate and review the new migration.");
    }
    const runtime = await readFile(join(migrationDirectory(root), "index.ts"), "utf8");
    if (runtime !== runtimeModule(history.migrations)) {
        throw new Error("Embedded migrations differ from SQL. Run pnpm db:generate after reviewing SQL edits.");
    }
    return previous.version;
}

export function applyTableOptions(statements, options) {
    return statements.filter(statement => !/^PRAGMA foreign_keys\s*=/i.test(statement.trim())).map(statement => {
        const match = /^CREATE TABLE [`"]([^`"]+)[`"]/.exec(statement);
        const name = match?.[1].replace(/^__new_/, "");
        return name && options.strictTables.includes(name) ? statement.replace(/\);\s*$/, ") STRICT;") : statement;
    });
}

export function withRules(statements, previousRules, rules) {
    return joinSql([
        ...ruleObjects(previousRules).reverse().map(({ kind, name }) => `DROP ${kind} IF EXISTS "${name}";`),
        ...statements,
        ...splitSql(rules)
    ]);
}

export async function generateMigration(root, { name = "schema", custom = false } = {}) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("--name must use lowercase letters, digits, and underscores, starting with a letter.");
    const history = await readHistory(root);
    const previous = history.migrations.at(-1);
    const current = await currentSchema(root, previous.snapshot.id);
    const directory = migrationDirectory(root);
    if (!custom && matchesCurrent(current, previous)) {
        const runtime = runtimeModule(history.migrations);
        const path = join(directory, "index.ts");
        const changed = await readFile(path, "utf8") !== runtime;
        if (changed) await writeFile(path, runtime);
        return changed ? "SQL unchanged; refreshed embedded migrations." : "No database definition changes; no files written.";
    }
    const strictChanged = Object.keys(previous.snapshot.tables).some(table => current.snapshot.tables[table]
        && previous.options.strictTables.includes(table) !== current.options.strictTables.includes(table));
    if (strictChanged && !custom) throw new Error("Changing STRICT on an existing table requires --custom and an explicit table rebuild in the generated SQL.");
    const statements = custom ? [customPlaceholder]
        : applyTableOptions(await generateSQLiteMigration(previous.snapshot, current.snapshot), current.options);
    const version = previous.version + 1;
    const prefix = String(version).padStart(4, "0");
    const tag = `${prefix}_${name}`;
    const sql = withRules(statements, previous.rules, current.rules);
    const migration = { version, tag, sql, ...current };
    // Exclusive writes never overwrite an existing migration, even if its journal entry is missing.
    await writeFile(join(directory, `${tag}.sql`), sql, { flag: "wx" });
    await writeFile(join(directory, `meta/${prefix}_snapshot.json`), json(current.snapshot), { flag: "wx" });
    await writeFile(join(directory, `meta/${prefix}_rules.sql`), current.rules, { flag: "wx" });
    await writeFile(join(directory, `meta/${prefix}_options.json`), json(current.options), { flag: "wx" });
    history.journal.entries.push({ version, tag });
    await writeFile(join(directory, "meta/_journal.json"), json(history.journal));
    await writeFile(join(directory, "index.ts"), runtimeModule([...history.migrations, migration]));
    return `Generated ${tag}.sql. Review data copying/backfills, then run pnpm db:check and pnpm test:db.`;
}