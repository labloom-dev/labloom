import { type uuid } from "./base";

type Tab_Editor = {
    pageId: uuid;
};

type Tab_Paper = {
    paperId: uuid;
    version: string;
};

type Tab_Other = {
    name: string;
};

export type Tab = {
    id: uuid;
    type: "editor" | "paper" | "other";
} & (
    Tab_Editor
);