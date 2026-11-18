import { nativeTheme, type BrowserWindow } from "electron";
import * as settings from "../settings/store";

export function attach(window: BrowserWindow): () => void {
    const rememberWindow = (): void => {
        if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
        const maximized = window.isMaximized();
        if (maximized) {
            settings.update({ window: { maximized } });
            return;
        }
        const { width, height } = window.getBounds();
        settings.update({ window: { width, height, maximized } });
    };
    const applyFrame = (): void => {
        if (process.platform === "darwin" || window.isDestroyed()) return;
        window.setTitleBarOverlay({ color: nativeTheme.shouldUseDarkColors ? "#292923" : "#fffdf7", symbolColor: nativeTheme.shouldUseDarkColors ? "#eee4d1" : "#302c25" });
    };
    const applyTheme = (): void => {
        const theme = settings.get().settings.appearance.theme;
        if (nativeTheme.themeSource !== theme) nativeTheme.themeSource = theme;
        applyFrame();
    };
    window.on("resize", rememberWindow);
    window.on("maximize", rememberWindow);
    window.on("unmaximize", rememberWindow);
    window.on("restore", rememberWindow);
    window.on("leave-full-screen", rememberWindow);
    nativeTheme.on("updated", applyFrame);
    applyTheme();
    const unsubscribe = settings.subscribe(applyTheme);
    window.once("closed", () => {
        unsubscribe(); nativeTheme.removeListener("updated", applyFrame);
    });
    return rememberWindow;
}