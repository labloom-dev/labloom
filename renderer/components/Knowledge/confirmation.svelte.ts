import { confirmationText } from "../../../shared/content/confirmation";
import { type AttributeDefinition } from "../../../shared/types/attributes";
import { type CommitResult } from "../../../shared/types/content";
import { t } from "../../i18n.svelte";

export const confirmation = $state<{ heading: () => string; text: () => string; names: string[]; resolve: ((value: boolean) => void) | null }>({ heading: () => "", text: () => "", names: [], resolve: null });
export function ask(heading: () => string, text: () => string, names: string[] = []): Promise<boolean> {
    if (confirmation.resolve) return Promise.resolve(false);
    return new Promise(resolve => Object.assign(confirmation, { heading, text, names, resolve }));
}
export function answer(value: boolean): void {
    const resolve = confirmation.resolve;
    confirmation.resolve = null;
    resolve?.(value);
}
export async function confirmed(commit: (token?: string) => Promise<CommitResult>): Promise<boolean> {
    let result = await commit();
    while (result.status === "confirmation") {
        const { preview } = result;
        if (!await ask(() => t(preview.deletedBlocks.length ? "dialog.deleteBlock" : "dialog.change"), () => confirmationText(preview, t))) return false;
        result = await commit(preview.token);
    }
    return true;
}
export async function define(id: string, value: AttributeDefinition | null): Promise<boolean> {
    let impact = await window.api.attributes.define(id, value);
    while (impact) {
        if (!await ask(() => t("dialog.sharedAttribute"), () => t("dialog.attributeImpact") + (impact?.recycled?.length ? t("dialog.attributeRecycle", { count: impact.recycled.length }) : ""), [...impact.pages, ...(impact.recycled ?? [])].map(page => page.title))) return false;
        impact = await window.api.attributes.define(id, value, impact.token);
    }
    return true;
}