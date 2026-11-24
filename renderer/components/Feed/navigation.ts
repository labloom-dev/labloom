import { SvelteMap } from "svelte/reactivity";
import { openDestination } from "../layout/navigation";

type FeedRequest = { kind: "add" } | { kind: "item"; id: string };
export const feedRequests = new SvelteMap<string, FeedRequest>();

export function openFeed(request: FeedRequest): void {
    feedRequests.set(openDestination("feed").id, request);
}