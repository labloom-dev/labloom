import { defaultSettings } from "../../../shared/settings/defaults";
import { type Settings } from "../../../shared/settings/Settings";

export const shell = $state({ ...defaultSettings.layout, search: false });
let pending = 0, sequence = 0, revision = -1;
let saved: Settings["layout"] = defaultSettings.layout;
export function applyPanel(value: Settings["layout"], nextRevision: number): void {
    if (nextRevision < revision) return;
    revision = nextRevision; saved = { ...value };
    if (!pending) Object.assign(shell, saved);
}
export function persistPanel(): void {
    const id = pending = ++sequence;
    const layout = { width: shell.width, collapsed: shell.collapsed };
    void window.api.settings.update({ layout }).then(result => {
        applyPanel(result.snapshot.settings.layout, result.snapshot.revision);
        if (!result.success) console.error(result.error);
    }).catch(console.error).finally(() => {
        if (pending === id) {
            pending = 0; Object.assign(shell, saved);
        }
    });
}
export function togglePanel(): void {
    shell.collapsed = !shell.collapsed; persistPanel();
}