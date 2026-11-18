export type PurgeResult = { status: "confirmation"; token: string; pages: { id: string; title: string }[]; links: number } | { status: "deleted"; pages: string[]; blocks: string[] };

export type HistoryState = { canUndo: boolean; redo: { id: string; time: number }[] };
export type Notice = { pageId: string; attrId: string; leadSeconds: number; title: string; attrName: string; firedAt: number; seen: boolean };