import type { uuid } from "../types/uuid";
import type { ViewParams } from "./views";
import { defaultOverviewDate, defaultOverviewStatus } from "./overview";

export const defaultCalendar: ViewParams["calendar"] = {
    date: defaultOverviewDate,
    start: { kind: "attribute", type: "minute", id: "schedule_start" },
    status: defaultOverviewStatus
};

export type CalendarQuery = {
    date: string;
    start?: string;
    status?: string;
    from: number;
    to: number;
    ids?: uuid[];
};

export type CalendarPage = {
    id: string;
    title: string;
    date: number;
    start: number | null;
    status: string | null;
    hasStatus: boolean;
    pinned: boolean;
};