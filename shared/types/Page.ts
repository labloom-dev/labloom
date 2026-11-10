import { type PageKind, type PageRecord } from "./content";

export type Page<Kind extends PageKind = PageKind> = PageRecord & { kind: Kind };