import { confirmationText, recycledPageNames } from "../../../shared/content/confirmation";
import { type AttributeDefinition } from "../../../shared/types/attributes";
import { type ChangePreview, type CommitResult } from "../../../shared/types/content";
import { t } from "../../i18n.svelte";

type Request = { heading: () => string; text: () => string; names: string[]; danger: boolean; resolve: (value: boolean) => void };
export const confirmation = $state<{ current: Request | null }>({ current: null });
export function ask(heading: () => string, text: () => string, names: string[] = [], danger = false): Promise<boolean> {
    if (confirmation.current) return Promise.resolve(false);
    return new Promise(resolve => {
        confirmation.current = { heading, text, names, danger, resolve };
    });
}
export function answer(value: boolean): void {
    const request = confirmation.current;
    confirmation.current = null;
    request?.resolve(value);
}
export function confirmChange(preview: ChangePreview, heading = (): string => t("dialog.change")): Promise<boolean> {
    const names = recycledPageNames(preview);
    return ask(heading, () => confirmationText(preview, t, names.length), names);
}
export async function confirmed(commit: (token?: string) => Promise<CommitResult>): Promise<boolean> {
    let result = await commit();
    while (result.status === "confirmation") {
        const { preview } = result;
        if (!await confirmChange(preview, () => t(preview.deletedBlocks.length ? "dialog.deleteBlock" : "dialog.change"))) return false;
        result = await commit(preview.token);
    }
    return true;
}
export async function define(id: string, value: AttributeDefinition | null): Promise<boolean> {
    let impact = await window.api.attributes.define(id, value);
    while (impact) {
        const { pages, recycled, token } = impact;
        if (!await ask(() => t("dialog.sharedAttribute"),
            () => t("dialog.attributeImpact") + (recycled?.length ? "\n" + t("dialog.attributeRecycle", { count: recycled.length }) : ""),
            [...pages, ...(recycled ?? [])].map(page => page.title), value === null)) return false;
        impact = await window.api.attributes.define(id, value, token);
    }
    return true;
}