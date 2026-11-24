import type { Notice, NoticeKey } from "../types/knowledge";
import { type Channels } from "../ipc/contract";

export type TimersAPI = {
    settings(pageId: string): Promise<Record<string, number[]>>;
    set(pageId: string, attrId: string, leadSeconds: number, enabled: boolean): Promise<void>;
    notices(): Promise<Notice[]>;
    unreadCount(): Promise<number>;
    readNotice(pageId: string, attrId: string, leadSeconds: number, firedAt?: number): Promise<void>;
    unreadNotice(notice: NoticeKey): Promise<void>;
    readAllNotices(): Promise<void>;
    clearNotice(notice: NoticeKey): Promise<void>;
    clearAllNotices(): Promise<void>;
    onOpenNotice(listener: (pageId: string) => void): () => void;
};

export const timersChannels = {
    settings: "timers:settings",
    set: "timers:set",
    notices: "timers:notices",
    unreadCount: "timers:unread-count",
    readNotice: "timers:read-notice",
    unreadNotice: "timers:unread-notice",
    readAllNotices: "timers:read-all-notices",
    clearNotice: "timers:clear-notice",
    clearAllNotices: "timers:clear-all-notices"
} as const satisfies Channels<TimersAPI>;
export const openReminderPage = "timers:open-reminder-page";