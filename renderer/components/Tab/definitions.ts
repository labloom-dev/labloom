import { type uuid } from "../../../shared/data/uuid";
import { v4 } from "uuid";
import { createContext } from "svelte";

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
    __imTabID: never;
};

export function isTabID(id: string): id is TabID {
    return id.startsWith("tab-");
}

export function getTabID(): TabID {
    return `tab-${v4()}` as TabID;
}

export type TabState = {
    items: Tab[];
    activeId: TabID | null;
};

export const [getTabs, setTabs] = createContext<TabState>();