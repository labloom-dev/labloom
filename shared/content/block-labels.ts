import { blockKinds } from "../types/content";
import { isMediaKind } from "./blocks";

export const convertibleKinds = blockKinds.filter(kind => kind !== "title" && kind !== "blocked_reference" && !isMediaKind(kind));