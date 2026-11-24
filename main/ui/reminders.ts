import { Notification } from "electron";
import * as events from "../knowledge/events";
import { read } from "../knowledge/timers";
import { isCurrent, requireWorkspace } from "../workspace-state";
import { t } from "./i18n";

const active = new Set<Notification>();

export function initialize(openPage: (id: string) => void): void {
    events.subscribe(event => {
        if (event.type !== "reminder" || !Notification.isSupported()) return;
        const workspace = requireWorkspace(), { pageId, attrId, leadSeconds, firedAt } = event.notice;
        const notification = new Notification({ title: t("notice.reminderTitle"), body: event.body });
        const release = (): void => {
            active.delete(notification);
        };
        active.add(notification);
        notification.once("close", release);
        notification.once("failed", release);
        notification.once("click", () => {
            release();
            if (!isCurrent(workspace)) return;
            try {
                read(pageId, attrId, leadSeconds, firedAt);
                openPage(pageId);
            }
            catch (problem) {
                console.error(problem);
            }
        });
        notification.show();
    });
}