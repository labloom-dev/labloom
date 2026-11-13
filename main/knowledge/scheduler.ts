import { app, BrowserWindow, Notification } from "electron";
import { knowledgeChanged } from "../../shared/ipc";
import { type Startup } from "../startup/startup";
import { type TimerService } from "./timers";
import { t } from "../ui/i18n";

let stop: (() => void) | undefined;
export function configureScheduler(startup: Startup, timers: () => TimerService, refresh: (id: string) => Promise<void>): void {
    if (stop) return;
    const check = (): void => {
        if (startup.state.status !== "ready") return;
        void timers().check((notice, body) => {
            for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(knowledgeChanged, { sourceTab: "", pages: [notice.pageId], blocks: [], notices: true });
            if (Notification.isSupported()) new Notification({ title: t("notice.reminderTitle"), body }).show();
        }, refresh).catch(error => console.error("Timer dispatch failed", error));
    };
    const interval = setInterval(check, 15000);
    interval.unref();
    startup.onReady = check;
    stop = () => {
 clearInterval(interval); startup.onReady = undefined;
};
    app.once("will-quit", stop);
    check();
}