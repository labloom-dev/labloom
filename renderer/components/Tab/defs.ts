import type { View } from "../../../shared/workspace/views";
import type { XYDirection } from "../types";

export type Tab = { id: TabID; view: View };

export type TabID = string & {
    __TabIDBrand: never;
};

export type GroupID = string & {
    __GroupIDBrand: never;
};

export type TabGroup = {
    id: GroupID;
    tabs: Tab[];
    activeTabId: TabID | null;
};

export type LayoutNode =
    | { type: "group"; groupId: GroupID }
    | {
        type: "split";
        direction: XYDirection;
        ratio: number;
        children: [LayoutNode, LayoutNode];
    };

export type TabState = {
    groups: TabGroup[];
    focusedGroupId: GroupID;
    layout: LayoutNode;
};