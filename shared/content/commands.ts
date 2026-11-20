export const commands = {
    newPage: { shortcut: "Ctrl+N" }, importPDF: { shortcut: "" },
    closeTab: { shortcut: "Ctrl+W" }, settings: { shortcut: "Ctrl+," },
    undo: { shortcut: "Ctrl+Z" }, redo: { shortcut: "Ctrl+Y" },
    cut: { shortcut: "Ctrl+X" }, copy: { shortcut: "Ctrl+C" },
    paste: { shortcut: "Ctrl+V" }, selectAll: { shortcut: "Ctrl+A" },
    sidebar: { shortcut: "Ctrl+Alt+B" }, splitRight: { shortcut: "Ctrl+\\" },
    mergeGroup: { shortcut: "" }, commandPalette: { shortcut: "Ctrl+Shift+P" },
    splitDown: { shortcut: "" }, overview: { shortcut: "" },
    feed: { shortcut: "" }, library: { shortcut: "" }, papers: { shortcut: "" },
    calendar: { shortcut: "" }, attributes: { shortcut: "" }, search: { shortcut: "Ctrl+P" },
    nextTab: { shortcut: "Ctrl+Tab" }, previousTab: { shortcut: "Ctrl+Shift+Tab" },
    group1: { shortcut: "Ctrl+1" }, group2: { shortcut: "Ctrl+2" }, group3: { shortcut: "Ctrl+3" },
    about: { shortcut: "" }, devtools: { shortcut: "F12" }
} as const;
export type Command = keyof typeof commands;
export const menus = [
    { id: "file", items: ["newPage", "importPDF", "closeTab", "settings"] },
    { id: "edit", items: ["undo", "redo", "cut", "copy", "paste", "selectAll"] },
    { id: "view", items: ["sidebar", "splitRight", "splitDown", "mergeGroup", "commandPalette"] },
    { id: "go", items: ["overview", "feed", "library", "papers", "calendar", "attributes", "search", "nextTab", "previousTab"] },
    { id: "help", items: ["about", "devtools"] }
] as const satisfies ReadonlyArray<{ id: string; items: readonly Command[] }>;
export function shortcutCommand(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "defaultPrevented">): Command | undefined {
    if (event.isComposing || event.defaultPrevented || event.key === "Process" || event.metaKey) return;
    const chord = `${event.ctrlKey ? "Ctrl+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.key.length === 1 ? event.key.toUpperCase() : event.key}`;
    return (Object.keys(commands) as Command[]).find(id => commands[id].shortcut && commands[id].shortcut.toUpperCase() === chord.toUpperCase());
}
export const conversionShortcuts: Record<string, string> = { paragraph: "Ctrl+Alt+0", heading_1: "Ctrl+Alt+1", heading_2: "Ctrl+Alt+2", heading_3: "Ctrl+Alt+3", unordered_list: "Ctrl+Shift+8", ordered_list: "Ctrl+Shift+7" };