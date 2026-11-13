function stored(): { width: number; collapsed: boolean } {
    try {
        const value = JSON.parse(localStorage.getItem("labloom.left-panel") ?? "null");
        return { width: Math.max(170, Math.min(500, Number(value?.width) || 240)), collapsed: value?.collapsed === true };
    }
    catch {
        return { width: 240, collapsed: false };
    }
}
export const shell = $state({ ...stored(), search: false });
export function persistPanel(): void {
    localStorage.setItem("labloom.left-panel", JSON.stringify({ width: shell.width, collapsed: shell.collapsed }));
}
export function togglePanel(): void {
    shell.collapsed = !shell.collapsed; persistPanel();
}