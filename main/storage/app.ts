import { join } from "node:path";

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