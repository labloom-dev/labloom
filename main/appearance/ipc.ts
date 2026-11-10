import { nativeTheme, type BrowserWindow } from "electron";
import { appearanceChannels } from "../../shared/ipc";
import { handle } from "../ipc";
import { type AppStorage } from "../storage/app";

export function registerAppearanceIPCs(window: BrowserWindow, storage: AppStorage): void {
    function applyFrame(): void {
        if (process.platform === "darwin" || window.isDestroyed()) return;
        window.setTitleBarOverlay({
            color: nativeTheme.shouldUseDarkColors ? "#292923" : "#fffdf7",
            symbolColor: nativeTheme.shouldUseDarkColors ? "#eee4d1" : "#302c25"
        });
    }

    try {
        nativeTheme.themeSource = storage.getAppearance().theme;
    }
    catch {
        // Startup reports configuration failures; the renderer can retry loading preferences.
    }
    applyFrame();
    nativeTheme.on("updated", applyFrame);
    window.once("closed", () => nativeTheme.removeListener("updated", applyFrame));
    handle(window.webContents, appearanceChannels.get, () => storage.getAppearance());
    handle(window.webContents, appearanceChannels.save, value => {
        const appearance = storage.saveAppearance(value);
        nativeTheme.themeSource = appearance.theme;
        applyFrame();
        return appearance;
    });
}