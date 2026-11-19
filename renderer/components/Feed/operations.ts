import { type FeedAPI } from "../../../shared/feed/ipc";
import { type FeedSourceInput } from "../../../shared/types/feed";

type Write = <T>(action: () => Promise<T>) => Promise<T>;

export async function saveSubscription(api: Pick<FeedAPI, "resolveSource" | "saveSource" | "discardSource">, input: FeedSourceInput, write: Write): Promise<string | null> {
    const resolution = await api.resolveSource(input);
    if (!resolution) return null;
    try {
        return await write(() => api.saveSource(resolution));
    }
    catch (error) {
        await api.discardSource(resolution);
        throw error;
    }
}

// Several views can request the same item while its file is waiting for the page buffers.
const downloading = new Map<string, Promise<void>>();
export async function downloadAttachment(api: Pick<FeedAPI, "fetchPDF">, itemId: string, attach: (pageId: string, fileId: string) => Promise<void>, write: Write): Promise<void> {
    const pending = downloading.get(itemId);
    if (pending) return pending;
    const request = api.fetchPDF(itemId).then(async file => {
        if (file) await write(() => attach(file.pageId, file.fileId));
    }).finally(() => downloading.delete(itemId));
    downloading.set(itemId, request);
    return request;
}