import type { ContentBlockKind } from "../../../shared/types/content";
import { isMediaKind } from "../../../shared/content/blocks";
import * as labels from "../../../shared/content/block-labels";
import * as shortcuts from "../../../shared/content/commands";
import * as i18n from "../../i18n.svelte";
import type { MenuItem } from "../base/Menu.svelte";
import * as icons from "../Knowledge/labels";

type Handle = { kind: ContentBlockKind; shared: boolean; folded: boolean; children: boolean; caption?: boolean; media?: boolean };
type Action = "row" | "column" | "fold" | "unsync" | "delete" | "caption";
export function block(handle: Handle, convert: (kind: ContentBlockKind) => void, act: (action: Action) => void,
    pick: (mode: "reference" | "sync") => void, move: (direction: -1 | 1) => void, multiple = false): MenuItem[] {
    const items: MenuItem[] = handle.media || isMediaKind(handle.kind) ? [] : [{ label: i18n.t("editor.convert"), items: labels.convertibleKinds.map(kind => ({
        icon: icons.blockIcons[kind], label: i18n.t(`block.${kind}`), shortcut: shortcuts.conversionShortcuts[kind], onselect: () => convert(kind)
    })) }];
    if (!multiple && handle.caption) items.push({ label: i18n.t("editor.addCaption"), onselect: () => act("caption") });
    if (!multiple && handle.kind === "table") items.push({ label: i18n.t("editor.row"), onselect: () => act("row") }, { label: i18n.t("editor.column"), onselect: () => act("column") });
    if (!multiple) items.push({ label: i18n.t("editor.reference"), onselect: () => pick("reference") }, { label: i18n.t("editor.sync"), onselect: () => pick("sync") });
    if (!multiple && handle.shared) items.push({ label: i18n.t("editor.unsync"), onselect: () => act("unsync") });
    if (handle.children) items.push({ label: i18n.t(handle.folded ? "editor.unfold" : "editor.fold"), shortcut: shortcuts.blockShortcuts.fold, onselect: () => act("fold") });
    return [...items, { label: i18n.t("editor.up"), shortcut: shortcuts.blockShortcuts.up, onselect: () => move(-1) },
        { label: i18n.t("editor.down"), shortcut: shortcuts.blockShortcuts.down, onselect: () => move(1) }, { label: i18n.t("editor.delete"), icon: "trash", onselect: () => act("delete") }];
}

export function body(run: (id: "cut" | "copy" | "paste" | "inlineReference") => void, writable: boolean): MenuItem[] {
    return [...(["cut", "copy", "paste"] as const).map(id => ({ label: i18n.commandLabel(id), shortcut: shortcuts.commands[id].shortcut,
        disabled: id !== "copy" && !writable, onselect: () => run(id) })), { label: i18n.t("editor.inline"), disabled: !writable, onselect: () => run("inlineReference") }];
}

export function paste(run: (synced: boolean) => void): MenuItem[] {
    return [{ label: i18n.commandLabel("paste"), onselect: () => run(false) }, { label: i18n.t("editor.pasteSynced"), onselect: () => run(true) }];
}