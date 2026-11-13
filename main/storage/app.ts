import { LabloomError } from "../../shared/failure";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { StartupState, Workspace } from "../../shared/types/startup";
import { defaultAppearance, isAppearance, type Appearance } from "../../shared/types/appearance";

type AppConfig = {
    version: 1;
    lastWorkspace: Workspace | null;
    [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfig(value: unknown): value is AppConfig {
    if (!isRecord(value) || value.version !== 1) return false;
    const workspace = value.lastWorkspace;
    return workspace === null || (
        isRecord(workspace)
        && typeof workspace.id === "string" && workspace.id.length > 0
        && typeof workspace.name === "string" && workspace.name.length > 0
        && typeof workspace.path === "string" && isAbsolute(workspace.path)
    );
}

export function developmentDataPath(projectPath: string, profile = "default"): string {
    // Internal assertion: LABLOOM_PROFILE is supplied by the development launcher, never by the UI.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) {
        throw new Error("LABLOOM_PROFILE must contain 1-64 letters, digits, underscores, or hyphens, and start with a letter or digit.");
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(profile)) {
        // Internal assertion: reject invalid developer launch configuration.
        throw new Error("LABLOOM_PROFILE must not be a Windows reserved device name.");
    }
    return join(projectPath, ".local", "profiles", profile);
}

export class AppStorage {
    readonly configPath: string;
    readonly sessionsPath: string;
    private config: AppConfig | null = null;

    constructor(readonly root: string) {
        this.configPath = join(root, "config.json");
        this.sessionsPath = join(root, "sessions");
        mkdirSync(this.sessionsPath, { recursive: true });
    }

    load(): { lastWorkspace: Workspace | null; notice?: Extract<StartupState, { status: "needs-workspace" }>["notice"]; } {
        this.config = null;
        let source: string;
        try {
            source = readFileSync(this.configPath, "utf8");
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            this.config = { version: 1, lastWorkspace: null };
            return { lastWorkspace: null };
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(source);
        }
        catch {
            parsed = null;
        }
        if (isRecord(parsed) && typeof parsed.version === "number" && parsed.version > 1) {
            throw new LabloomError({ kind: "config-newer-version" });
        }
        if (!isConfig(parsed)) {
            const backup = join(this.root, `config.invalid-${randomUUID()}.json`);
            renameSync(this.configPath, backup);
            this.config = { version: 1, lastWorkspace: null };
            return { lastWorkspace: null, notice: { kind: "config-backup", path: backup } };
        }
        this.config = parsed;
        return { lastWorkspace: parsed.lastWorkspace };
    }

    remember(workspace: Workspace): void {
        if (!this.config) throw new LabloomError({ kind: "config-not-loaded" });
        this.write({ ...this.config, lastWorkspace: workspace });
    }

    getAppearance(): Appearance {
        if (!this.config) throw new LabloomError({ kind: "config-not-loaded" });
        const stored = this.config.appearance;
        const fields = isRecord(stored) ? { timeZone: defaultAppearance.timeZone, language: defaultAppearance.language, ...stored } : stored;
        return isAppearance(fields) ? this.appearanceFields(fields) : { ...defaultAppearance };
    }

    saveAppearance(value: unknown): Appearance {
        if (!this.config) throw new LabloomError({ kind: "config-not-loaded" });
        if (!isAppearance(value)) throw new LabloomError({ kind: "preferences-invalid" });
        const appearance = this.appearanceFields(value);
        this.write({ ...this.config, appearance });
        return { ...appearance };
    }

    private appearanceFields(value: Appearance): Appearance {
        return { theme: value.theme, readingSize: value.readingSize, motion: value.motion, timeZone: value.timeZone, language: value.language };
    }

    private write(config: AppConfig): void {
        const temporary = join(this.root, `config-${randomUUID()}.tmp`);
        try {
            writeFileSync(temporary, JSON.stringify(config, null, 4), { encoding: "utf8", flag: "wx" });
            renameSync(temporary, this.configPath);
            this.config = config;
        }
        finally {
            rmSync(temporary, { force: true });
        }
    }
}