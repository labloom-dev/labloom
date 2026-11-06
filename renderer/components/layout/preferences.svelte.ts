import { defaultAppearance, type Appearance } from "../../../shared/types/appearance";

export const appearance = $state({ ...defaultAppearance, loaded: false, saving: false, error: "" });

function values(): Appearance {
    return { theme: appearance.theme, readingSize: appearance.readingSize, motion: appearance.motion };
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
        appearance.loaded = true;
    }
    catch (error) {
        appearance.error = `无法读取本机外观设置：${error instanceof Error ? error.message : "请重试。"}`;
    }
    apply();
}

export async function saveAppearance(): Promise<void> {
    if (!appearance.loaded || appearance.saving) return;
    appearance.saving = true;
    appearance.error = "";
    apply();
    try {
        await window.api.appearance.save(values());
    }
    catch {
        appearance.error = "本次设置已应用，但未能保存到本机，请重试。";
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