import { randomUUID } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LabloomError } from "../../shared/failure";
import { defaultSettings, settingsVersion } from "../../shared/settings/defaults";
import { type Settings } from "../../shared/settings/Settings";
import { type StartupState } from "../../shared/types/startup";
import { validSettings } from "../../shared/settings/validate";

export type LoadResult = { settings: Settings; savedText: string | null; notice?: Extract<StartupState, { status: "needs-workspace" }>["notice"] };
export function readSettings(path: string): LoadResult {
    let source: string;
    try {
        source = readFileSync(path, "utf8");
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { settings: structuredClone(defaultSettings), savedText: null };
        throw error;
    }
    let value: unknown;
    try {
        value = JSON.parse(source);
    }
    catch {
        value = null;
    }
    if (value && typeof value === "object" && "version" in value && typeof value.version === "number" && value.version > settingsVersion) throw new LabloomError({ kind: "config-newer-version" });
    if (value && typeof value === "object" && !("history" in value)) value = { ...value, history: defaultSettings.history };
    if (validSettings(value)) return { settings: value, savedText: JSON.stringify(value) };
    const backup = join(dirname(path), "settings.invalid-" + randomUUID() + ".json");
    renameSync(path, backup);
    return { settings: structuredClone(defaultSettings), savedText: null, notice: { kind: "config-backup", path: backup } };
}
export async function writeSettings(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + "." + randomUUID() + ".tmp";
    try {
        const file = await open(temporary, "wx");
        try {
            await file.writeFile(text, "utf8"); await file.sync();
        }
        finally {
            await file.close();
        }
        await rename(temporary, path);
    }
    finally {
        await unlink(temporary).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
    }
}