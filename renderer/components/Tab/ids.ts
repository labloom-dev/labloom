import { v4 } from "uuid";
import type { GroupID, TabID } from "./defs";

export const getTabID = (): TabID => v4() as TabID;
export const getGroupID = (): GroupID => v4() as GroupID;