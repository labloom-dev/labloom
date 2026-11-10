import { type BuiltinAttrId } from "../attrs/builtins";
import { type AttributeValue } from "./attributes";

export type PageAttr = { id: BuiltinAttrId | `custom:${string}`; value: AttributeValue };