import { type uuid } from "./base";

type Tab_Page = {
    pageId: uuid;
};

type Tab_Overview = {
    name: string;
};

export type Tab = Tab_Page | Tab_Overview;

export type TabID = string & {
    __imTabID: never;
};