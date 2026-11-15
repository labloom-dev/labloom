import { join } from "node:path";
import { type FailureInfo, LabloomError, toFailureInfo } from "../../shared/failure";
import { defaultSettings } from "../../shared/settings/defaults";
import { type Settings, type SettingsResult, type SettingsSnapshot } from "../../shared/settings/Settings";
import { mergeSettings } from "../../shared/settings/merge";
import { freezeSnapshot } from "../../shared/settings/snapshot";
import { readSettings, writeSettings, type LoadResult } from "./file";
import { validatePatch } from "./validate";

const saveDelayMs = 500, saveMaxWaitMs = 5000;
let path: string | undefined;
let loaded = false;
let generation = 0;
let settings: Settings = structuredClone(defaultSettings);
let currentText = JSON.stringify(settings), savedText: string | null = null;
let revision = 0, settingsRevision = 0, savedRevision = -1, pendingSaves = 0;
let error: FailureInfo | null = null;
let writes: Promise<void> = Promise.resolve();
let delayTimer: ReturnType<typeof setTimeout> | undefined, maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
let snapshot: SettingsSnapshot | undefined;
const listeners = new Set<(snapshot: SettingsSnapshot) => void>();
function cancelTimers(): void {
    clearTimeout(delayTimer); clearTimeout(maxWaitTimer);
    delayTimer = maxWaitTimer = undefined;
}
export function initialize(root: string): Pick<LoadResult, "notice"> {
    cancelTimers();
    generation++;
    path = join(root, "settings.json");
    loaded = false;
    settings = structuredClone(defaultSettings);
    currentText = JSON.stringify(settings); savedText = null;
    revision = settingsRevision = pendingSaves = 0; savedRevision = -1;
    writes = Promise.resolve(); error = null; snapshot = undefined;
    try {
        const result = readSettings(path);
        settings = structuredClone(result.settings); currentText = JSON.stringify(settings);
        savedText = result.savedText; savedRevision = currentText === savedText ? settingsRevision : -1;
        loaded = true;
        notify();
        return { notice: result.notice };
    }
    catch (cause) {
        error = toFailureInfo(cause);
        notify();
        throw cause;
    }
}
export function get(): SettingsSnapshot {
    return snapshot ??= freezeSnapshot({
        settings: structuredClone(settings), revision, settingsRevision, savedRevision,
        dirty: currentText !== savedText, saving: pendingSaves > 0, error: error ? structuredClone(error) : null
    });
}
export function subscribe(listener: (snapshot: SettingsSnapshot) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
function notify(): void {
    revision++;
    snapshot = undefined;
    const value = get();
    for (const listener of listeners) {
        try {
            listener(value);
        }
        catch (cause) {
            console.error(cause);
        }
    }
}
function scheduleSave(): void {
    if (currentText === savedText && pendingSaves === 0) {
        cancelTimers(); return;
    }
    const persist = (): void => {
        void flush(settingsRevision);
    };
    clearTimeout(delayTimer);
    delayTimer = setTimeout(persist, saveDelayMs);
    maxWaitTimer ??= setTimeout(persist, saveMaxWaitMs);
    delayTimer.unref(); maxWaitTimer.unref();
}
export function update(value: unknown): SettingsResult {
    try {
        if (!loaded) throw new LabloomError({ kind: "config-not-loaded" });
        const patch = validatePatch(value, settings);
        const next = mergeSettings(settings, structuredClone(patch)), text = JSON.stringify(next);
        if (text !== currentText) {
            settings = next; currentText = text; settingsRevision++;
            notify(); scheduleSave();
        }
        return { success: true, snapshot: get() };
    }
    catch (cause) {
        if (!(cause instanceof LabloomError)) throw cause;
        return { success: false, error: cause.failure, snapshot: get() };
    }
}
export function flush(target: number): Promise<SettingsResult> {
    if (!loaded || !path) return Promise.resolve({ success: false, error: { kind: "config-not-loaded" }, snapshot: get() });
    if (!Number.isSafeInteger(target) || target < 0 || target > settingsRevision) return Promise.resolve({ success: false, error: { kind: "settings-invalid-update" }, snapshot: get() });
    cancelTimers();
    const captured = structuredClone(settings), text = currentText, version = settingsRevision, destination = path, run = generation;
    pendingSaves++; notify();
    const operation = writes.then(async (): Promise<SettingsResult> => {
        let failure: FailureInfo | null = null;
        try {
            if (text !== savedText || run !== generation) await writeSettings(destination, JSON.stringify(captured, null, 4));
            if (run === generation) {
                savedText = text; savedRevision = version; error = null;
            }
        }
        catch (cause) {
            failure = toFailureInfo(cause);
            if (run === generation) error = failure;
            console.error("Could not save settings", destination, cause);
        }
        finally {
            if (run === generation) {
                pendingSaves--; notify();
            }
        }
        return failure ? { success: false, error: failure, snapshot: get() } : { success: true, snapshot: get() };
    });
    writes = operation.then(() => { }, () => { });
    return operation;
}