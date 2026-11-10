import { type Database } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as tables from "./tables";

export type WorkspaceDatabase = BetterSQLite3Database<typeof tables> & { $client: Database; };

// Share the workspace's native connection, including its transactions and lifetime.
export function createWorkspaceDatabase(database: Database): WorkspaceDatabase {
    return drizzle({ client: database, schema: tables });
}