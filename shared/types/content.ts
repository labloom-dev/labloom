export const pageKinds = ["editable", "paper", "annotation", "task", "event"] as const;
export type PageKind = typeof pageKinds[number];