import { type Database } from "better-sqlite3";

export type WorkspaceMigration = {
    readonly from: number;
    readonly to: number;
    readonly foreignKeysOff?: boolean;
    readonly up: (database: Database) => void;
};

export function runMigrations(database: Database, migrations: readonly WorkspaceMigration[]): void {
    let target = 0;
    for (const migration of migrations) {
        if (migration.from !== target || migration.to !== target + 1) {
            throw new Error("Labloom workspace migrations must form a continuous, ordered version history starting at 0.");
        }
        target = migration.to;
    }

    const version = database.pragma("user_version", { simple: true }) as number;
    if (!Number.isInteger(version) || version < 0 || version > target) {
        throw new Error("This workspace format is incompatible with this version of Labloom. Open it with a compatible version.");
    }
    if (version === target) return;

    // SQLite table rebuilds must disable FK actions before BEGIN: disabling them
    // inside the transaction is a no-op, and DROP TABLE can cascade-delete rows.
    const suspendForeignKeys = migrations.some(migration => migration.from >= version && migration.foreignKeysOff)
        && database.pragma("foreign_keys", { simple: true }) === 1;
    if (suspendForeignKeys && database.inTransaction) {
        throw new Error("Table-rebuilding migrations must start outside a transaction with foreign keys enabled.");
    }
    if (suspendForeignKeys) database.pragma("foreign_keys = OFF");
    try {
        database.transaction(() => {
            if (database.pragma("user_version", { simple: true }) !== version) {
                throw new Error("The Labloom workspace version changed before the upgrade could start. Try again.");
            }
            for (const migration of migrations) {
                if (migration.from < version) continue;
                migration.up(database);
                database.pragma(`user_version = ${migration.to}`);
            }
            const violations = database.pragma("foreign_key_check") as unknown[];
            if (violations.length > 0) {
                throw new Error(`The Labloom workspace upgrade failed its foreign key check: ${JSON.stringify(violations)}`);
            }
        }).immediate();
    }
    finally {
        if (suspendForeignKeys) database.pragma("foreign_keys = ON");
    }
}