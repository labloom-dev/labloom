import type { IconName } from "../utils/Icon.svelte";
import type { Tab } from "../Tab/defs";
import { activateTab, addTab, getTabID } from "../Tab/api";
import { tabState } from "../Tab/state.svelte";
import type { uuid } from "../../../shared/types/uuid";
import type { PageSummary, PageKind } from "../../../shared/types/knowledge";
import { acceptPage, knowledgeState, changed } from "../Knowledge/state.svelte";

export const destinations = [
    { type: "overview", title: "我的花园", icon: "home", description: "工作台总览" },
    { type: "feed", title: "订阅动态", icon: "feed", description: "发现新的论文与灵感" },
    { type: "reader-test", title: "文献阅读", icon: "book", description: "收藏文献、阅读 PDF 与标注原文" },
    { type: "knowledge", title: "知识库", icon: "library", description: "笔记与知识的家" },
    { type: "calendar", title: "日程计划", icon: "calendar", description: "安排下一步探索" },
    { type: "assistant", title: "AI 助手", icon: "ai", description: "研究路上的小帮手" },
    { type: "settings", title: "偏好设置", icon: "settings", description: "让花园更合心意" },
    { type: "about", title: "关于知织", icon: "home", description: "Where ideas take root." }
] satisfies { type: Exclude<Tab["type"], "page">; title: string; icon: IconName; description: string }[];

export type Destination = typeof destinations[number]["type"];

export function openDestination(type: Destination): void {
    const existing = tabState.groups.flatMap(group => group.tabs).find(tab => tab.type === type);
    if (existing) activateTab(existing.id);
    else {
        const destination = destinations.find(item => item.type === type)!;
        addTab(tabState.focusedGroupId, { id: getTabID(), title: destination.title, type });
    }
}

export function openPage(page: Pick<PageSummary, "id" | "title">): void {
    const existing = tabState.groups.flatMap(group => group.tabs).find(tab => tab.type === "page" && tab.pageId === page.id);
    if (existing) activateTab(existing.id);
    else addTab(tabState.focusedGroupId, { id: getTabID(), title: page.title, type: "page", pageId: page.id as uuid });
    void window.api.knowledge.visit(page.id).catch(() => {});
}

export async function createPage(kind: PageKind = "editable"): Promise<void> {
    try {
        const page = await window.api.knowledge.create({ kind });
        acceptPage(page);
        openPage(page);
        changed();
    }
    catch (error) { knowledgeState.error = error instanceof Error ? error.message : "无法创建页面。"; }
}

export function openDraft(): void { void createPage(); }