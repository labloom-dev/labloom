<script lang="ts">
    import type { CodeLanguage } from "../../../shared/content/code-languages";
    import { codeLanguages } from "../../../shared/content/code-languages";
    import { blockShortcuts } from "../../../shared/content/commands";
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Popover from "../base/Popover.svelte";
    import SearchList from "../globalSearch/SearchList.svelte";
    import { tick } from "svelte";

    let { language, writable, choose, copy, restore }: {
        language: CodeLanguage | null; writable: () => boolean; choose: (value: CodeLanguage | null) => void;
        copy: () => void; restore: () => void;
    } = $props();
    let trigger = $state<HTMLButtonElement>(), input = $state<HTMLInputElement>(), query = $state(""), selected = $state(0), open = $state(false);
    const options = $derived((["plain", ...codeLanguages] as const).map(id => ({ id, title: t(`codeLanguage.${id}`) }))
        .filter(row => (row.title + " " + row.id).toLowerCase().includes(query.trim().toLowerCase())));
    function toggle(event: MouseEvent): void {
        if (!writable()) return;
        trigger = event.currentTarget as HTMLButtonElement;
        query = ""; selected = 0; open = !open;
    }
</script>
<div class="code-tools" contenteditable="false">
    <Button variant="text" class="code-language" aria-label={t("editor.language")} title={t("editor.language") + " (" + blockShortcuts.language + ")"}
        aria-haspopup="listbox" aria-expanded={open} onpointerdown={e => e.preventDefault()} onclick={toggle}>{t(`codeLanguage.${language ?? "plain"}`)}</Button>
    <IconButton label={t("editor.copyCode")} icon="copy" onpointerdown={e => e.preventDefault()} onclick={copy} />
</div>
{#if open}
    <Popover label={t("editor.language")} bind:open align="end" contentProps={{ class: "code-language-picker", customAnchor: trigger, trapFocus: true,
        onOpenAutoFocus: e => {
            e.preventDefault(); void tick().then(() => input?.focus());
        },
        onCloseAutoFocus: e => {
            e.preventDefault(); restore();
        } }}>
        <SearchList bind:query bind:input bind:selected {options} label={t("editor.language")} onchoose={index => {
            const row = options[index];
            if (row) {
                choose(row.id === "plain" ? null : row.id); open = false;
            }
        }} />
    </Popover>
{/if}
<style>
    .code-tools { display: flex; align-items: center; gap: var(--ui-space-1); position: absolute; top: 0; right: 0; z-index: 1; visibility: hidden; background: var(--ui-surface-panel); }
    :global([data-kind="code"]:is(:hover, .code-active, :focus-within)) .code-tools { visibility: visible; }
    :global(.ui-popover.code-language-picker) { width: var(--ui-editor-preview-width); padding: 0; }
</style>