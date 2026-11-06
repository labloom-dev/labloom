import type { FeedItem } from "../../../shared/types/feed";
import { openDestination } from "../layout/navigation";

// Search and overview can request the same reader without duplicating feed tabs.
export const feedNavigation = $state<{ item: FeedItem | null }>({ item: null });

export function openFeedItem(item: FeedItem): void {
    feedNavigation.item = item;
    openDestination("feed");
}