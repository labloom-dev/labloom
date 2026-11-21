import type { tags } from "typia";
import type { uuid } from "../types/uuid";
import type { AttributeType, AttributeValue } from "../types/attributes";
import type { PageKind } from "../types/content";

type ReferenceId = string & tags.MinLength<1>;
type AttributeRef<T extends AttributeType> = { kind: "attribute"; type: T; id: ReferenceId };
type NoParams = Record<string, never>;
export type ViewParams = {
    page: { page: { kind: "page"; id: uuid }; showProperties?: boolean };
    library: {
        scope: "all" | "pinned" | "trash";
        pageType?: { kind: "page-type"; type: PageKind };
        sort: "modified" | "created" | "title";
        tags: string[];
        filters: { attribute: { kind: "attribute"; id: ReferenceId }; value: AttributeValue }[];
    };
    calendar: { date: AttributeRef<"day">; start?: AttributeRef<"minute">; status?: AttributeRef<"status"> };
    overview: { status?: AttributeRef<"status"> };
    attributes: NoParams;
    feed: NoParams;
    settings: NoParams;
    about: NoParams;
};
export type View = { [K in keyof ViewParams]: { type: K; params: ViewParams[K] } }[keyof ViewParams];