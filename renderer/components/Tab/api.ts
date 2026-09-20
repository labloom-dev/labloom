import { v4 } from "uuid";
import type { GroupID, LayoutNode, Tab, TabGroup, TabID } from "./defs";
import type { XYDirection } from "../types";
import { tabState } from "./state.svelte";

export function isTabID(id: string): id is TabID {
    return id.startsWith("tab-");
}

export function getTabID(): TabID {
    return `tab-${v4()}` as TabID;
}

function findGroup(id: GroupID): TabGroup | undefined {
    return tabState.groups.find(group => group.id === id);
}

function findTabGroup(id: TabID): TabGroup | undefined {
    return tabState.groups.find(group => group.tabs.some(tab => tab.id === id));
}

function detachTab(group: TabGroup, index: number): Tab {
    const [tab] = group.tabs.splice(index, 1);
    if (group.activeTabId === tab.id) {
        group.activeTabId = group.tabs[index]?.id ?? group.tabs[index - 1]?.id ?? null;
    }
    return tab;
}

export function addTab(groupId: GroupID, tab: Tab, activate = true): boolean {
    const group = findGroup(groupId);
    if (!group || findTabGroup(tab.id)) return false;
    group.tabs.push(tab);
    if (activate || group.activeTabId === null) group.activeTabId = tab.id;
    if (activate) tabState.focusedGroupId = groupId;
    return true;
}

export function updateTab(tab: Tab): boolean {
    const group = findTabGroup(tab.id);
    if (!group) return false;
    group.tabs[group.tabs.findIndex(item => item.id === tab.id)] = tab;
    return true;
}

export function removeTab(id: TabID): boolean {
    const group = findTabGroup(id);
    if (!group) return false;
    detachTab(group, group.tabs.findIndex(tab => tab.id === id));
    return true;
}

export function moveTab(id: TabID, targetGroupId: GroupID, toIndex: number): boolean {
    const source = findTabGroup(id);
    const target = findGroup(targetGroupId);
    if (!source || !target || !Number.isInteger(toIndex)) return false;
    const maxIndex = target.tabs.length - (source === target ? 1 : 0);
    if (toIndex < 0 || toIndex > maxIndex) return false;
    const index = source.tabs.findIndex(tab => tab.id === id);
    if (source === target) {
        if (index !== toIndex) {
            const [tab] = source.tabs.splice(index, 1);
            source.tabs.splice(toIndex, 0, tab);
        }
    }
    else {
        target.tabs.splice(toIndex, 0, detachTab(source, index));
        target.activeTabId = id;
        tabState.focusedGroupId = targetGroupId;
    }
    return true;
}

export function focusGroup(id: GroupID): boolean {
    if (!findGroup(id)) return false;
    tabState.focusedGroupId = id;
    return true;
}

export function activateTab(id: TabID): boolean {
    const group = findTabGroup(id);
    if (!group) return false;
    group.activeTabId = id;
    tabState.focusedGroupId = group.id;
    return true;
}

function splitLeaf(node: LayoutNode, groupId: GroupID, newId: GroupID, direction: XYDirection): LayoutNode {
    if (node.type === "group") return node.groupId === groupId
        ? { type: "split", direction, ratio: 0.5, children: [node, { type: "group", groupId: newId }] }
        : node;
    node.children = node.children.map(child => splitLeaf(child, groupId, newId, direction)) as [LayoutNode, LayoutNode];
    return node;
}

export function splitGroup(groupId: GroupID, direction: XYDirection): GroupID | null {
    if (!findGroup(groupId) || (direction !== "horizontal" && direction !== "vertical")) return null;
    const id = `group-${v4()}` as GroupID;
    tabState.groups.push({ id, tabs: [], activeTabId: null });
    tabState.layout = splitLeaf(tabState.layout, groupId, id, direction);
    tabState.focusedGroupId = id;
    return id;
}

function collectGroups(node: LayoutNode): GroupID[] {
    return node.type === "group" ? [node.groupId] : node.children.flatMap(collectGroups);
}

function removeLeaf(node: LayoutNode, id: GroupID): LayoutNode | null {
    if (node.type === "group") return node.groupId === id ? null : node;
    const left = removeLeaf(node.children[0], id);
    const right = removeLeaf(node.children[1], id);
    if (!left) return right;
    if (!right) return left;
    node.children = [left, right];
    return node;
}

export function closeGroup(id: GroupID): boolean {
    const source = findGroup(id);
    if (!source || tabState.groups.length === 1) return false;
    const order = collectGroups(tabState.layout);
    const index = order.indexOf(id);
    const target = findGroup(order[index + 1] ?? order[index - 1])!;
    target.tabs.push(...source.tabs);
    if (target.activeTabId === null) target.activeTabId = source.activeTabId;
    if (tabState.focusedGroupId === id) {
        tabState.focusedGroupId = target.id;
        if (source.activeTabId !== null) target.activeTabId = source.activeTabId;
    }
    tabState.layout = removeLeaf(tabState.layout, id)!;
    tabState.groups.splice(tabState.groups.findIndex(group => group.id === id), 1);
    return true;
}

export function resizeSplit(path: readonly number[], ratio: number): boolean {
    if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 0.9) return false;
    let node = tabState.layout;
    for (const index of path) {
        if (node.type !== "split" || (index !== 0 && index !== 1)) return false;
        node = node.children[index];
    }
    if (node.type !== "split") return false;
    node.ratio = ratio;
    return true;
}

/** Collapse one side of a split, merging its tabs into the adjoining surviving group. */
export function closeSplitSide(path: readonly number[], side: 0 | 1): boolean {
    let node = tabState.layout;
    let parent: Extract<LayoutNode, { type: "split" }> | null = null;
    let childIndex = 0;
    for (const index of path) {
        if (node.type !== "split" || (index !== 0 && index !== 1)) return false;
        parent = node;
        childIndex = index;
        node = node.children[index];
    }
    if (node.type !== "split" || (side !== 0 && side !== 1)) return false;
    const removedIds = collectGroups(node.children[side]);
    const survivingNode = node.children[side === 0 ? 1 : 0];
    const survivingIds = collectGroups(survivingNode);
    const target = findGroup(side === 0 ? survivingIds[0] : survivingIds[survivingIds.length - 1])!;
    const removedGroups = removedIds.map(id => findGroup(id)!);
    const focused = removedGroups.find(group => group.id === tabState.focusedGroupId);
    target.tabs.push(...removedGroups.flatMap(group => group.tabs));
    if (target.activeTabId === null) target.activeTabId = target.tabs[0]?.id ?? null;
    if (focused) {
        tabState.focusedGroupId = target.id;
        if (focused.activeTabId !== null) target.activeTabId = focused.activeTabId;
    }
    if (parent) parent.children[childIndex] = survivingNode;
    else tabState.layout = survivingNode;
    tabState.groups = tabState.groups.filter(group => !removedIds.includes(group.id));
    return true;
}