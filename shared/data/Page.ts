import { type uuid } from "./uuid";
import { type Block, type BlockOf } from "./Block";
import { type PageAttr } from "./PageAttr";

export type Page<
    Kind extends string,
    ExtraIntrAttrs = never
> = {
    kind: Kind;
    id: uuid;
    attrs: (PageAttr | ExtraIntrAttrs)[];
    children: Block[];
    title: BlockOf<"title">;
};