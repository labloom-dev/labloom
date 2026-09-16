import type { Page } from "./Page";

type PaperAttrTypes = {
    doi: string | null;
    publishedYear: number | null;
    //todo: 文献库：add more attributes
};

type PaperAttr = {
    [K in keyof PaperAttrTypes]: {
        id: K;
        value: PaperAttrTypes[K];
    };
}[keyof PaperAttrTypes];

export type Paper = Page<"paper", PaperAttr>;