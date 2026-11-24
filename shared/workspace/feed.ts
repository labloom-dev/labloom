import type { tags } from "typia";
import type { FeedOrder, FeedRead } from "../types/feed";
import type { uuid } from "../types/uuid";

export type FeedScope = "all" | "followed" | uuid;
export type FeedParams = {
    scope?: FeedScope;
    read?: FeedRead;
    order?: FeedOrder;
    sourcesWidth?: number & tags.Minimum<1>;
    listWidth?: number & tags.Minimum<1>;
};