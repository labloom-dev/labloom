import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { ContentBlockKind } from "../../../shared/types/content";
import { convertibleKinds } from "../../../shared/content/block-labels";
import { conversionShortcuts } from "../../../shared/content/commands";
import en from "../../../locales/en.json";
import { t } from "../../i18n.svelte";
import { blockIcons } from "../Knowledge/labels";
import type { IconName } from "../utils/Icon.svelte";

type Reference = "inline" | "reference" | "sync";
export type InsertItem = { kind: ContentBlockKind | Reference; label: string; icon: IconName; shortcut?: string; group: number; terms: string };
export type Trigger = { from: number; to: number; query: string };
const aliases: Record<string, string> = { paragraph: "text plain", heading_1: "h1 #", heading_2: "h2 ##", heading_3: "h3 ###",
    unordered_list: "bullet", ordered_list: "numbered num", blockquote: "quote", hr: "divider div" };

export function insertItems(query: string): InsertItem[] {
    const rows: InsertItem[] = convertibleKinds.map(kind => ({ kind, label: t(`block.${kind}`), icon: blockIcons[kind],
        shortcut: conversionShortcuts[kind], terms: en.block[kind] + " " + (aliases[kind] ?? ""), group: 0 }));
    for (const kind of ["inline", "reference", "sync"] as const) rows.push({ kind, label: t(`insertReference.${kind}`),
        icon: kind === "sync" ? "sync" : "link-external", terms: en.insertReference[kind], group: 1 });
    const needle = query.trim().toLowerCase();
    return rows.filter(item => (item.label + " " + item.terms).toLowerCase().includes(needle));
}

export function slashTrigger(state: EditorState, tr: Transaction, previous: Trigger | null): Trigger | null {
    const { selection } = state, at = selection.$head;
    if (!selection.empty || at.parent.type.name !== "blockBody") return null;
    const head = selection.head, start = at.start();
    if (previous) {
        const from = tr.mapping.map(previous.from, -1), to = tr.mapping.map(previous.to, 1);
        if (from >= start && head > from && head <= to && to <= at.end()) {
            const text = state.doc.textBetween(from, to, "\n", "\n");
            if (text.startsWith("/") && !text.includes("\n")) return { from, to, query: text.slice(1) };
        }
    }
    if (!tr.docChanged || !at.parentOffset || at.parent.textBetween(at.parentOffset - 1, at.parentOffset, "", "\n") !== "/") return null;
    if (!tr.mapping.maps.some(map => {
        let inserted = false;
        map.forEach((_a, _b, from, to) => {
            if (from === head - 1 && to === head) inserted = true;
        });
        return inserted;
    })) return null;
    if (at.parentOffset > 1 && !/\s/u.test(at.parent.textBetween(at.parentOffset - 2, at.parentOffset - 1, "", "x"))) return null;
    return { from: head - 1, to: head, query: "" };
}