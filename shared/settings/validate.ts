import { isAppearance } from "../types/appearance";
import { type Workspace } from "../types/startup";
import { type Settings, type SettingsPatch } from "./Settings";
import { maxPanelWidth, maxWindowDimension, minPanelWidth, minWindowHeight, minWindowWidth, settingsVersion } from "./defaults";

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
    return Object.keys(value).every(key => allowed.includes(key) && value[key] !== undefined);
}
function validWorkspace(value: unknown): value is Workspace | null {
    return value === null || record(value) && keys(value, ["id", "name", "path"])
        && typeof value.id === "string" && value.id.length > 0
        && typeof value.name === "string" && value.name.length > 0
        && typeof value.path === "string" && /^(?:[a-z]:[\\/]|[\\/])/i.test(value.path);
}
function validWindowSettings(value: unknown): value is Settings["window"] {
    return record(value) && keys(value, ["width", "height", "maximized"])
        && Number.isSafeInteger(value.width) && Number(value.width) >= minWindowWidth && Number(value.width) <= maxWindowDimension
        && Number.isSafeInteger(value.height) && Number(value.height) >= minWindowHeight && Number(value.height) <= maxWindowDimension
        && typeof value.maximized === "boolean";
}
function validLayout(value: unknown): value is Settings["layout"] {
    return record(value) && keys(value, ["width", "collapsed"])
        && typeof value.width === "number" && Number.isFinite(value.width) && value.width >= minPanelWidth && value.width <= maxPanelWidth
        && typeof value.collapsed === "boolean";
}
function validHistory(value: unknown): value is Settings["history"] {
    return record(value) && keys(value, ["limit"]) && (value.limit === null || Number.isSafeInteger(value.limit) && Number(value.limit) > 0);
}
export function validSettings(value: unknown): value is Settings {
    return record(value) && keys(value, ["version", "lastWorkspace", "appearance", "window", "layout", "history"])
        && value.version === settingsVersion && validWorkspace(value.lastWorkspace)
        && record(value.appearance) && keys(value.appearance, ["theme", "readingSize", "motion", "timeZone", "language"])
        && isAppearance(value.appearance) && validWindowSettings(value.window) && validLayout(value.layout) && validHistory(value.history);
}
export function validPatch(value: unknown, base: Settings): value is SettingsPatch {
    if (!record(value) || !Object.keys(value).length || !keys(value, ["lastWorkspace", "appearance", "window", "layout", "history"])) return false;
    if (Object.hasOwn(value, "lastWorkspace") && !validWorkspace(value.lastWorkspace)) return false;
    const sections = ["appearance", "window", "layout", "history"] as const;
    const validators = { appearance: isAppearance, window: validWindowSettings, layout: validLayout, history: validHistory };
    for (const section of sections) {
        if (!Object.hasOwn(value, section)) continue;
        const patch = value[section];
        if (!record(patch) || !Object.keys(patch).length || !keys(patch, Object.keys(base[section]))
            || !validators[section]({ ...base[section], ...patch } as never)) return false;
    }
    return true;
}