import { defaultAppearance, type Appearance } from "../../../shared/types/appearance";
import { resolveTimeZone } from "../../../shared/content/time";

export const appearance = $state({ ...defaultAppearance, loaded: false, saving: false, error: "" });
let savedZone = $state(defaultAppearance.timeZone);
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
    return { theme: appearance.theme, readingSize: appearance.readingSize, motion: appearance.motion, timeZone: appearance.timeZone };
}

function apply(): void {
    const dark = appearance.theme === "dark"
        || (appearance.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.motion = appearance.motion ? "on" : "off";
    document.documentElement.style.setProperty("--reading-font-size", `${appearance.readingSize}px`);
}

export async function loadAppearance(): Promise<void> {
    appearance.error = "";
    try {
        Object.assign(appearance, await window.api.appearance.get());
        savedZone = appearance.timeZone;
        appearance.loaded = true;
    }
    catch (error) {
        appearance.error = `无法读取本机偏好设置：${error instanceof Error ? error.message : "请重试。"}`;
    }
    apply();
}

export async function saveAppearance(): Promise<void> {
    if (!appearance.loaded || appearance.saving) return;
    appearance.saving = true;
    appearance.error = "";
    apply();
    try {
        savedZone = (await window.api.appearance.save(values())).timeZone;
    }
    catch {
        appearance.error = "未能保存本机偏好设置，请重试。";
    }
    finally {
        appearance.saving = false;
    }
}

export function initializeAppearance(): () => void {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    systemTheme.addEventListener("change", apply);
    void loadAppearance();
    return () => systemTheme.removeEventListener("change", apply);
}