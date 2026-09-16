import { type uuid } from "./uuid";

type BlockBase = {
    id: uuid;
};

// Blocks that have content and can have children.
const BlockType_Normal = ["paragraph", "unordered_list", "ordered_list"] as const;
// Blocks that don't have content, but can have children.
const BlockType_Container = ["callout", "blockquote"] as const;
// BLocks that have content, but cannot have children.
const BlockType_Leaf = ["title", "heading_1", "heading_2", "heading_3", "code"] as const;
// Blocks that don't have content, and cannot have children.
const BlockType_Decoration = ["page_reference", "hr"] as const;

export type BlockKind =
    typeof BlockType_Normal[number] |
    typeof BlockType_Container[number] |
    typeof BlockType_Leaf[number] |
    typeof BlockType_Decoration[number];

export type Block_Normal = BlockBase & {
    type: typeof BlockType_Normal[number];
    children: Block[];
    content: string;
};

export type Block_Container = BlockBase & {
    type: typeof BlockType_Container[number];
    children: Block[];
};

export type Block_Leaf = BlockBase & {
    type: typeof BlockType_Leaf[number];
};

export type Block_Decoration = BlockBase & {
    type: typeof BlockType_Decoration[number];
};

export type Block = (
    Block_Normal |
    Block_Container |
    Block_Leaf |
    Block_Decoration
);

export type BlockOf<T extends BlockKind> = Block & {
    type: T;
};