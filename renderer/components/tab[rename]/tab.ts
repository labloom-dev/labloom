import { type uuid } from "../../../shared/data/base";
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

export type TabState = {
    items: Tab[];
    activeId: TabID | null;
};

export const [getTabs, setTabs] = createContext<TabState>();