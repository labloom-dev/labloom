import { type ViewParams } from "../../../shared/workspace/views";
import { type IconName } from "../utils/Icon.svelte";

export type Destination = Exclude<keyof ViewParams, "page">;
export const destinationIcons = {
    overview: "home", feed: "rss", library: "library", papers: "book", calendar: "calendar", trash: "trash",
    settings: "settings-gear", attributes: "settings-gear", about: "home"
} as const satisfies Record<Destination, IconName>;