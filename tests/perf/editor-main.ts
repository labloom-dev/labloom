import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { fixture, seedLargePage } from "./fixture";

app.setPath("userData", join(process.env.LABLOOM_TEST_ROOT!, "profile"));
void app.whenReady().then(async () => {
    const data = fixture(), page = seedLargePage(data);
    ipcMain.handle("prototype:read", () => data.service.get(page.id));
    ipcMain.on("prototype:measurement", (_event, value) => console.log(JSON.stringify(value)));
    app.on("will-quit", () => data.sql.close());
    const window = new BrowserWindow({ width: 1150, height: 820, show: false, title: "Labloom 大页原型", autoHideMenuBar: true,
        webPreferences: { preload: join(__dirname, "editor-preload.cjs"), contextIsolation: true, sandbox: true } });
    window.once("ready-to-show", () => {
        window.show();
        window.focus();
    });
    await window.loadFile(join(__dirname, "editor.html"));
});
app.on("window-all-closed", () => app.quit());