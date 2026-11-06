export const appearance = $state({ readingSize: 16, motion: true, theme: "light", error: "" });
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
systemTheme.addEventListener("change", apply);

function apply(): void {
    document.documentElement.style.setProperty("--reading-font-size", `${appearance.readingSize}px`);
    document.documentElement.dataset.motion = appearance.motion ? "on" : "off";
    document.documentElement.dataset.theme = appearance.theme === "system" ? systemTheme.matches ? "dark" : "light" : appearance.theme;
}

export async function loadAppearance(): Promise<void> {
    try {
        const saved = await window.api.knowledge.getSetting("appearance") ?? JSON.parse(localStorage.getItem("labloom:appearance") ?? "null");
        if (saved && typeof saved === "object") {
            if ("readingSize" in saved && [14, 16, 18].includes(Number(saved.readingSize))) appearance.readingSize = Number(saved.readingSize);
            if ("motion" in saved && typeof saved.motion === "boolean") appearance.motion = saved.motion;
            if ("theme" in saved && ["light", "dark", "system"].includes(String(saved.theme))) appearance.theme = String(saved.theme);
        }
    }
    catch { appearance.error = "无法读取外观偏好，已使用默认设置。"; }
    apply();
}

export async function saveAppearance(): Promise<void> {
    apply();
    try { await window.api.knowledge.setSetting("appearance", { readingSize: appearance.readingSize, motion: appearance.motion, theme: appearance.theme }); appearance.error = ""; }
    catch { appearance.error = "本次设置已应用，但未能保存到工作区，请重试。"; }
}