import { type ContentBlock, type ContentBlockKind } from "./content";

export type BlockKind = ContentBlockKind;
export type Block = ContentBlock;
export type BlockOf<Kind extends BlockKind> = Block & { type: Kind };