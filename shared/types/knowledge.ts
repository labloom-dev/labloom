import type { TimePrecision } from "../content/time";

export type PurgeResult = { status: "confirmation"; token: string; pages: { id: string; title: string }[]; links: number } | { status: "deleted"; pages: string[]; blocks: string[] };

export type HistoryState = { canUndo: boolean; canRedo: boolean };
export type NoticeKey = { pageId: string; attrId: string; leadSeconds: number; firedAt: number };
export type Notice = NoticeKey & { title: string; attrName: string; attrType: TimePrecision; attrValue: number | null; seen: boolean };