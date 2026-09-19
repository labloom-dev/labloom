import { type uuid } from "../../../shared/types/uuid";

type Tab_Page = {
    type: "page";
    pageId: uuid;
};

type Tab_Overview = {
    type: "overview";
};

type Tab_About = {
    type: "about";
};

type Tab_Settings = {
    type: "settings";
};

export type Tab = {
    id: TabID;
    title: string;
} & (
    Tab_Page |
    Tab_Overview |
    Tab_About |
    Tab_Settings
);

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

export type SplitDirection = "horizontal" | "vertical";

export type LayoutNode =
    | { type: "group"; groupId: GroupID }
    | {
        type: "split";
        direction: SplitDirection;
        ratio: number;
        children: [LayoutNode, LayoutNode];
    };

export type TabState = {
    groups: TabGroup[];
    focusedGroupId: GroupID;
    layout: LayoutNode;
};