import { mount } from "svelte";
import type { FeedAPI } from "../../shared/types/feed";
import FeedView from "../components/Feed/FeedView.svelte";
import "../styles/colors.css";
import "../styles/layouts.css";
import "../styles/base.css";
import "../styles/elements.css";
import "./feed.css";

async function request<T>(method: keyof FeedAPI, ...args: unknown[]): Promise<T> {
    const response = await fetch("/__feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, args })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作失败，请重试。");
    return result;
}

const api: FeedAPI = {
    getState: query => request("getState", query),
    saveSource: source => request("saveSource", source),
    removeSource: id => request("removeSource", id),
    refresh: id => request("refresh", id),
    setRead: (id, isRead) => request("setRead", id, isRead),
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

mount(FeedView, { target: document.getElementById("app")!, props: { api } });