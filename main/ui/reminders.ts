import { Notification } from "electron";
import * as events from "../knowledge/events";
import { t } from "./i18n";

export function initialize(): void {
    events.subscribe(event => {
        if (event.type === "reminder" && Notification.isSupported()) new Notification({ title: t("notice.reminderTitle"), body: event.body }).show();
    });
}