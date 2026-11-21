import { blockKinds } from "../types/content";

export const convertibleKinds = blockKinds.filter(kind => kind !== "title" && kind !== "blocked_reference");