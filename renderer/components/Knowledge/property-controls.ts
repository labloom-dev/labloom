import { getContext, setContext } from "svelte";
import type { AttributeDefinition } from "../../../shared/types/attributes";
import * as confirmation from "./confirmation.svelte";
import * as sessions from "./page-sessions";
import * as navigation from "../layout/navigation";
import * as picker from "../globalSearch/page-search";

const defaults = {
    picker,
    open: (id: string) => navigation.openPage(id),
    manage: () => {
        navigation.openDestination("attributes");
    },
    saveDefinition: (value: AttributeDefinition) => sessions.write(() => confirmation.define(value.id, value)),
    files: (ids?: string[]) => window.api.papers.files(ids),
    openFile: (id: string) => window.api.papers.openFile(id),
    reminders: (page: string) => window.api.timers.settings(page),
    setReminder: (page: string, attribute: string, seconds: number, enabled: boolean) =>
        sessions.write(() => window.api.timers.set(page, attribute, seconds, enabled))
};
const context = Symbol("property controls");
export function propertyControls(): typeof defaults {
    return getContext<typeof defaults>(context) ?? defaults;
}
export function providePropertyControls(value: typeof defaults): void {
    setContext(context, value);
}