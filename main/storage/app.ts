import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Workspace } from "../../shared/types/startup";

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
    // Prefix the directory to avoid Windows reserved device names such as CON.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) {
        throw new Error("LABLOOM_PROFILE 只能包含 1–64 个字母、数字、下划线或连字符，并以字母或数字开头。");
    }
    return join(projectPath, ".local", "profiles", `profile-${profile}`, "user-data");
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

    load(): { lastWorkspace: Workspace | null; notice?: string; } {
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
            throw new Error("应用配置来自更新版本的知织，请更新应用后重试。");
        }
        if (!isConfig(parsed)) {
            const backup = join(this.root, `config.invalid-${randomUUID()}.json`);
            renameSync(this.configPath, backup);
            this.config = { version: 1, lastWorkspace: null };
            return { lastWorkspace: null, notice: `应用配置无法读取，已保留至 ${backup}。请重新选择工作区。` };
        }
        this.config = parsed;
        return { lastWorkspace: parsed.lastWorkspace };
    }

    remember(workspace: Workspace): void {
        if (!this.config) throw new Error("应用配置尚未成功读取，请重试。");
        const config: AppConfig = { ...this.config, lastWorkspace: workspace };
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