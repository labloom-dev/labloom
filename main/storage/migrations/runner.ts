import { LabloomError } from "../../../shared/failure";
import Database from "better-sqlite3";
import { baselineSql, baselineVersion } from "./generated";

let expectedSchema: string | undefined;

function schemaDefinition(database: Database.Database): string {
    return JSON.stringify(database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' ORDER BY type, name").all());
}

export function createBaseline(database: Database.Database): void {
    if (database.pragma("user_version", { simple: true }) !== 0
        || database.prepare("SELECT 1 FROM sqlite_schema LIMIT 1").get()) {
        // Internal assertion: only the baseline initializer calls this on a newly reserved database.
        throw new Error("The workspace baseline requires an empty database.");
    }
    database.transaction(() => {
        database.exec(baselineSql);
        database.pragma(`user_version = ${baselineVersion}`);
        if ((database.pragma("foreign_key_check") as unknown[]).length) {
            throw new LabloomError({ kind: "workspace-foreign-key-check" });
        }
    })();
}

export function validateBaseline(database: Database.Database): void {
    if (database.pragma("user_version", { simple: true }) !== baselineVersion) throw new LabloomError({ kind: "workspace-incompatible" });
    if (expectedSchema === undefined) {
        const reference = new Database(":memory:");
        try {
            createBaseline(reference);
            expectedSchema = schemaDefinition(reference);
        }
        finally {
            reference.close();
        }
    }
    if (schemaDefinition(database) !== expectedSchema) throw new LabloomError({ kind: "workspace-incompatible" });
}