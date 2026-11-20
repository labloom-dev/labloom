import { defaultAppearance, type Appearance } from "../../../shared/types/appearance";
import { resolveTimeZone } from "../../../shared/content/time";
import { type SettingsSnapshot } from "../../../shared/settings/Settings";
import { failure, setLocale, type ErrorValue } from "../../i18n.svelte";
import { applyPanel } from "./shell.svelte";

export const appearance = $state<Appearance & { loaded: boolean; saving: boolean; error: ErrorValue }>({ ...defaultAppearance, loaded: false, saving: false, error: "" });
let savedZone = $state(defaultAppearance.timeZone);
let latest: SettingsSnapshot | undefined, pending = 0, sequence = 0;
const zone = $derived(resolveTimeZone(savedZone));
const dateTime = $derived(new Intl.DateTimeFormat(undefined, {
    timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit"
}));
export function currentTimeZone(): string {
    return zone;
}
export function displayMilliseconds(ms: number): string {
    return dateTime.format(ms);
}
function values(): Appearance {
    return { theme: appearance.theme, readingSize: appearance.readingSize, motion: appearance.motion, timeZone: appearance.timeZone, language: appearance.language };
}

let frameColors = "";
function apply(): void {
    const dark = appearance.theme === "dark"
        || (appearance.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.motion = appearance.motion ? "on" : "off";
    document.documentElement.style.setProperty("--reading-font-size", `${appearance.readingSize}px`);
    setLocale(appearance.language);
    const style = getComputedStyle(document.documentElement);
    const color = style.getPropertyValue("--ui-titlebar-background").trim(), symbol = style.getPropertyValue("--ui-titlebar-foreground").trim();
    if (color && symbol && frameColors !== color + symbol) {
        frameColors = color + symbol;
        window.api.app.setFrameColors(color, symbol);
    }
}


function receive(snapshot: SettingsSnapshot): void {
    if (latest && snapshot.revision < latest.revision) return;
    latest = snapshot;
    if (!pending) Object.assign(appearance, snapshot.settings.appearance);
    savedZone = snapshot.settings.appearance.timeZone;
    appearance.loaded = true; appearance.saving = snapshot.saving;
    appearance.error = snapshot.error ? failure(snapshot.error) : "";
    applyPanel(snapshot.settings.layout, snapshot.revision);
    apply();
}
export async function loadAppearance(): Promise<void> {
    try {
        receive(await window.api.settings.get());
    }
    catch (error) {
        appearance.error = failure(error); apply();
    }
}
export async function saveAppearance(): Promise<void> {
    if (!appearance.loaded) return;
    const id = pending = ++sequence;
    appearance.error = ""; apply();
    try {
        const result = await window.api.settings.update({ appearance: values() });
        receive(result.snapshot);
        if (!result.success) appearance.error = failure(result.error);
    }
    catch (error) {
        appearance.error = failure(error);
    }
    finally {
        if (pending === id) {
            pending = 0;
            if (latest) Object.assign(appearance, latest.settings.appearance);
            apply();
        }
    }
}
export function initializeAppearance(): () => void {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    systemTheme.addEventListener("change", apply);
    apply();
    const off = window.api.settings.onChanged(receive);
    void loadAppearance();
    return () => {
        systemTheme.removeEventListener("change", apply); off();
    };
}