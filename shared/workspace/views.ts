import type { tags } from "typia";
import type { uuid } from "../types/uuid";
import type { AttributeType, AttributeValue } from "../types/attributes";
import type { PageKind } from "../types/content";

import type { FeedParams } from "./feed";
import type { LibraryColumn, LibrarySort } from "./library";

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
    library: {
        scope: "all" | "pinned" | "trash";
        pageType?: { kind: "page-type"; type: PageKind };
        sort: LibrarySort;
        paperOnly?: boolean;
        columns?: LibraryColumn[];
        showProperties?: boolean;
        infoWidth?: number & tags.Minimum<1>;
        tags: string[];
        filters: { attribute: { kind: "attribute"; id: ReferenceId }; value: AttributeValue }[];
    };
    calendar: { date: AttributeRef<"day">; start?: AttributeRef<"minute">; status?: AttributeRef<"status"> };
    overview: { status?: AttributeRef<"status">; date?: AttributeRef<"day"> };
    attributes: NoParams;
    feed: FeedParams;
    settings: NoParams;
    about: NoParams;
};
export type View = { [K in keyof ViewParams]: { type: K; params: ViewParams[K] } }[keyof ViewParams];