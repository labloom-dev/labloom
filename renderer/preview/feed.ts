import "../styles/global.css";
import { mount } from "svelte";
import type { FeedAPI } from "../../shared/feed/ipc";
import { arxivURL } from "../../shared/utils/feed";
import { saveSubscription } from "../components/Feed/operations";
import { write } from "../components/Knowledge/page-sessions";
import FeedView from "../components/Feed/FeedView.svelte";
import { LabloomError } from "../../shared/failure";
import "./feed.css";

async function request<T>(method: keyof FeedAPI | "attachPDF" | "version", ...args: unknown[]): Promise<T> {
    const response = await fetch("/__feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, args })
    });
    const result = await response.json();
    if (!response.ok) throw new LabloomError(result.error ?? { kind: "unexpected" });
    return result;
}

const api: FeedAPI = {
    getState: query => request("getState", query),
    getItem: id => request("getItem", id),
    resolveSource: input => request("resolveSource", input),
    discardSource: key => request("discardSource", key),
    saveSource: source => request("saveSource", source),
    setSourceStatus: (id, action) => request("setSourceStatus", id, action),
    refresh: id => request("refresh", id),
    setRead: (id, isRead) => request("setRead", id, isRead),
    markAllRead: id => request("markAllRead", id),
    setPosition: (id, progress) => request("setPosition", id, progress),
    setKeywords: keywords => request("setKeywords", keywords),
    importItem: (id, replace) => request("importItem", id, replace),
    fetchPDF: id => request("fetchPDF", id),
    onChanged: listener => {
        // The preview has no push channel, so it asks whether anything changed.
        let known: number | undefined;
        const timer = setInterval(async () => {
            try {
                const version = await request<number>("version");
                if (version !== known) listener();
                known = version;
            }
            catch { /* The next poll reports the change. */ }
        }, 1000);
        return () => clearInterval(timer);
    },
    openItem: async id => {
        // Open synchronously so the browser keeps this within the user's gesture.
        const tab = window.open("about:blank", "_blank");
        if (tab) tab.opener = null;
        try {
            const url = await request<string>("openItem", id);
            if (tab) tab.location.href = url;
            else window.location.assign(url);
        }
        catch (error) {
            tab?.close();
            throw error;
        }
    }
};

async function seedExample(): Promise<void> {
    if (!(await api.getState({})).sources.length) await saveSubscription(api, {
        name: "示例：AI / 机器学习（large language model）", url: arxivURL("cs.AI, cs.LG", "large language model")
    }, write);
}
void seedExample().catch(error => console.warn("Could not load the example subscription", error));
mount(FeedView, { target: document.getElementById("app")!, props: { api, attachPDF: (pageId, fileId) => request("attachPDF", pageId, fileId) } });