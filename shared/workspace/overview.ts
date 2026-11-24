import type { PageKind } from "../types/content";
import type { uuid } from "../types/uuid";

export const defaultOverviewStatus = { kind: "attribute", type: "status", id: "task_status" } as const;
export const defaultOverviewDate = { kind: "attribute", type: "day", id: "schedule_date" } as const;
export const overviewBatchSize = 96;

export type OverviewQuery = { status: string; date: string; recent: uuid[]; around?: uuid };
export type OverviewPage = { id: string; kind: PageKind; title: string; pinned: boolean; date: number | null };
export type OverviewIndex = { taskIds: string[]; tasks: OverviewPage[]; recent: OverviewPage[]; missingStatus: boolean };