import { type uuid } from "./base";
import { type Block } from "./Block";
import { type PageAttr } from "./PageAttr";

export type Page = {
    id: uuid;
    attrs: PageAttr[];
    children: Block[];
    title: Block;
    deleted: boolean;
};