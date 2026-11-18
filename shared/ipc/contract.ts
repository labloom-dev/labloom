import type { tags } from "typia";

export type TabId = string & tags.MinLength<1>;
export type InvokeKeys<API> = { [Key in keyof API]: API[Key] extends (...args: never[]) => Promise<unknown> ? Key : never }[keyof API];
export type Channels<API> = Record<InvokeKeys<API>, string>;