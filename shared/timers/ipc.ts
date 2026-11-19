import type { Notice } from "../types/knowledge";
import { type Channels } from "../ipc/contract";

export type TimersAPI = {
    settings(pageId: string): Promise<Record<string, number[]>>;
    set(pageId: string, attrId: string, leadSeconds: number, enabled: boolean): Promise<void>;
    notices(): Promise<Notice[]>;
    readNotice(pageId: string, attrId: string, leadSeconds: number): Promise<void>;
};

export const timersChannels = {
    settings: "timers:settings",
    set: "timers:set",
    notices: "timers:notices",
    readNotice: "timers:read-notice"
} as const satisfies Channels<TimersAPI>;