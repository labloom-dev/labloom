import { defaultAppearance, type Appearance } from "../../../shared/types/appearance";
import { resolveTimeZone } from "../../../shared/content/time";
import { defaultSettings } from "../../../shared/settings/defaults";
import { type SettingsPatch, type SettingsSnapshot } from "../../../shared/settings/Settings";
import { failure, setLocale, type ErrorValue } from "../../i18n.svelte";
import { applyPanel } from "./shell.svelte";

export const appearance = $state<Appearance>({ ...defaultAppearance });
export const preferences = $state({ loaded: false, saving: false, error: "" as ErrorValue, historyLimit: defaultSettings.history.limit });
type PreferencePatch = Pick<SettingsPatch, "appearance"> & { history?: Readonly<{ limit: number | null }> };
let latest: SettingsSnapshot | undefined;
let pending = 0, writes = Promise.resolve(), rejected: PreferencePatch = {}, writeError: ErrorValue = "";
let savedZone = $state(defaultAppearance.timeZone);
const zone = $derived(resolveTimeZone(savedZone));
export function currentTimeZone(): string {
    return zone;
}

let frameColors = "", appliedAppearance = "";
function apply(): void {
    const dark = appearance.theme === "dark"
        || (appearance.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const signature = JSON.stringify([dark, appearance.motion, appearance.readingSize, appearance.language]);
    if (signature === appliedAppearance) return;
    appliedAppearance = signature;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.motion = appearance.motion ? "on" : "off";
    document.documentElement.style.setProperty("--ui-editor-font-body", appearance.readingSize + "px");
    setLocale(appearance.language);
    const style = getComputedStyle(document.documentElement);
    const color = style.getPropertyValue("--ui-titlebar-background").trim(), symbol = style.getPropertyValue("--ui-titlebar-foreground").trim();
    if (color && symbol && frameColors !== color + symbol) {
        frameColors = color + symbol;
        window.api.app.setFrameColors(color, symbol);
    }
}

function reconcile(): void {
    if (latest && !pending) {
        Object.assign(appearance, latest.settings.appearance, rejected.appearance);
        preferences.historyLimit = (rejected.history ?? latest.settings.history).limit;
    }
    preferences.saving = pending > 0 || !!latest?.saving;
    preferences.error = writeError || latest?.error || "";
    apply();
}

function receive(snapshot: SettingsSnapshot): void {
    if (latest && snapshot.revision < latest.revision) return;
    latest = snapshot;
    savedZone = snapshot.settings.appearance.timeZone;
    preferences.loaded = true;
    applyPanel(snapshot.settings.layout, snapshot.revision);
    reconcile();
}

export async function loadAppearance(): Promise<void> {
    try {
        receive(await window.api.settings.get());
    }
    catch (error) {
        preferences.error = failure(error);
        apply();
    }
}

export function savePreferences(patch?: PreferencePatch): Promise<void> {
    if (!preferences.loaded) return Promise.resolve();
    pending++;
    Object.assign(appearance, patch?.appearance);
    if (patch?.history) preferences.historyLimit = patch.history.limit;
    reconcile();

    writes = writes.then(async () => {
        try {
            rejected = { ...rejected, ...patch, ...(patch?.appearance && { appearance: { ...rejected.appearance, ...patch.appearance } }) };
            if (Object.keys(rejected).length) {
                const result = await window.api.settings.update(rejected);
                receive(result.snapshot);
                if (!result.success) throw result.error;
                rejected = {};
            }
            if (!patch && latest?.dirty) {
                const result = await window.api.settings.flush(latest.settingsRevision);
                receive(result.snapshot);
                if (!result.success) throw result.error;
            }
            writeError = "";
        }
        catch (error) {
            writeError = failure(error);
        }
        finally {
            pending--;
            reconcile();
        }
    });
    return writes;
}

export const finishPreferences = (): Promise<void> => writes;

export function initializeAppearance(): () => void {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    systemTheme.addEventListener("change", apply);
    apply();
    const off = window.api.settings.onChanged(receive);
    void loadAppearance();
    return () => {
        systemTheme.removeEventListener("change", apply);
        off();
    };
}