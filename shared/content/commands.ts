export const commands = {
    newPage: { label: "新建页面", shortcut: "Ctrl+N" }, importPDF: { label: "导入 PDF", shortcut: "" },
    closeTab: { label: "关闭标签", shortcut: "Ctrl+W" }, settings: { label: "偏好设置", shortcut: "Ctrl+," },
    undo: { label: "撤销", shortcut: "Ctrl+Z" }, redo: { label: "重做", shortcut: "Ctrl+Y" },
    cut: { label: "剪切", shortcut: "Ctrl+X" }, copy: { label: "复制", shortcut: "Ctrl+C" },
    paste: { label: "粘贴", shortcut: "Ctrl+V" }, selectAll: { label: "全选", shortcut: "Ctrl+A" },
    sidebar: { label: "切换左侧面板", shortcut: "Ctrl+Alt+B" }, splitRight: { label: "向右拆分", shortcut: "Ctrl+\\" },
    splitDown: { label: "向下拆分", shortcut: "" }, overview: { label: "总览", shortcut: "" },
    feed: { label: "订阅", shortcut: "" }, library: { label: "知识库", shortcut: "" }, papers: { label: "文献库", shortcut: "" },
    calendar: { label: "日历", shortcut: "" }, attributes: { label: "属性管理", shortcut: "" }, search: { label: "搜索", shortcut: "Ctrl+P" },
    nextTab: { label: "下一个标签", shortcut: "Ctrl+Tab" }, previousTab: { label: "上一个标签", shortcut: "Ctrl+Shift+Tab" },
    group1: { label: "聚焦第1标签组", shortcut: "Ctrl+1" }, group2: { label: "聚焦第2标签组", shortcut: "Ctrl+2" }, group3: { label: "聚焦第3标签组", shortcut: "Ctrl+3" },
    about: { label: "关于知织", shortcut: "" }, devtools: { label: "开发者工具", shortcut: "F12" }
} as const;
export type Command = keyof typeof commands;
export const menus: { label: string; items: Command[] }[] = [
    { label: "文件", items: ["newPage", "importPDF", "closeTab", "settings"] },
    { label: "编辑", items: ["undo", "redo", "cut", "copy", "paste", "selectAll"] },
    { label: "视图", items: ["sidebar", "splitRight", "splitDown"] },
    { label: "前往", items: ["overview", "feed", "library", "papers", "calendar", "attributes", "search", "nextTab", "previousTab"] },
    { label: "帮助", items: ["about", "devtools"] }
];
export function shortcutCommand(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "defaultPrevented">): Command | undefined {
    if (event.isComposing || event.defaultPrevented || event.key === "Process" || event.metaKey) return;
    const chord = `${event.ctrlKey ? "Ctrl+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.key.length === 1 ? event.key.toUpperCase() : event.key}`;
    return (Object.keys(commands) as Command[]).find(id => commands[id].shortcut && commands[id].shortcut.toUpperCase() === chord.toUpperCase());
}
export const conversionShortcuts: Record<string, string> = { paragraph: "Ctrl+Alt+0", heading_1: "Ctrl+Alt+1", heading_2: "Ctrl+Alt+2", heading_3: "Ctrl+Alt+3", unordered_list: "Ctrl+Shift+8", ordered_list: "Ctrl+Shift+7" };