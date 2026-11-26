import type { tags } from "typia";
import type { uuid } from "../types/uuid";
import type { AttributeType } from "../types/attributes";

import type { FeedParams } from "./feed";
import type { TableParams, TrashParams } from "./table";

type ReferenceId = string & tags.MinLength<1>;
type AttributeRef<T extends AttributeType> = { kind: "attribute"; type: T; id: ReferenceId };
type NoParams = Record<string, never>;
export type ViewParams = {
    page: {
        page: { kind: "page"; id: uuid };
        fileId?: uuid;
        showProperties?: boolean;
        infoWidth?: number & tags.Minimum<1>;
        paperSidebar?: "info" | "annotations";
    };
    library: TableParams;
    papers: TableParams;
    trash: TrashParams;
    calendar: { date: AttributeRef<"day">; start?: AttributeRef<"minute">; status?: AttributeRef<"status">; agendaWidth?: number & tags.Minimum<1> };
    overview: { status?: AttributeRef<"status">; date?: AttributeRef<"day"> };
    attributes: { listWidth?: number & tags.Minimum<1> };
    feed: FeedParams;
    settings: NoParams;
    about: NoParams;
};
export type View = { [K in keyof ViewParams]: { type: K; params: ViewParams[K] } }[keyof ViewParams];