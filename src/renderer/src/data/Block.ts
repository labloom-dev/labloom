import { type uuid } from "./base";

type BlockBase = {
    id: uuid;
};

// Blocks that have content and can have children.
const BlockType_Normal = ["paragraph", "unordered_list", "ordered_list"] as const;
// Blocks that don't have content, but can have children.
const BlockType_Container = ["callout"] as const;
// Blocks that don't have content, and cannot have children.
const BlockType_Decoration = ["page_reference", "hr"] as const;

export type BlockKind =
    typeof BlockType_Normal[number] |
    typeof BlockType_Container[number] |
    typeof BlockType_Decoration[number];

export type Block_Normal = {
    type: typeof BlockType_Normal[number];
    children: Block[];
    content: string;
};

export type Block_Container = {
    type: typeof BlockType_Container[number];
    children: Block[];
};

export type Block_Decoration = {
    type: typeof BlockType_Decoration[number];
};

export type Block = BlockBase & (
    Block_Normal |
    Block_Container |
    Block_Decoration
);