import { setLocale } from "../ui/i18n";
import * as workspace from "../workspace-state";
import * as timers from "../knowledge/timers";
import * as settings from "./store";
let unsubscribe: (() => void) | undefined;
export function initialize(): void {
    unsubscribe?.();
    let zone = settings.get().settings.appearance.timeZone;
    setLocale(settings.get().settings.appearance.language);
    unsubscribe = settings.subscribe(snapshot => {
        setLocale(snapshot.settings.appearance.language);
        const next = snapshot.settings.appearance.timeZone;
        if (next !== zone && workspace.ready()) timers.recalculateAll();
        zone = next;
    });
}
export function release(): void {
    unsubscribe?.(); unsubscribe = undefined;
}