import { type uuid } from "./base";
import { type Block } from "./Block";
import { type PageAttr } from "./PageAttr";

export type PageBase<
    Kind extends string,
    ExtraIntrAttrs = never
> = {
    kind: Kind;
    id: uuid;
    attrs: (PageAttr | ExtraIntrAttrs)[];
    children: Block[];
    title: Block;
};

export type Page = PageBase<"normal">;