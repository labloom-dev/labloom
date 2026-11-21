<script lang="ts">
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    let { recycled = false, error = "", busy = false, onrestore }: { recycled?: boolean; error?: string; busy?: boolean; onrestore: () => void } = $props();
</script>

{#if recycled || error}
    <div class="page-status" role="status">
        {#if recycled}<span>{t("editor.trashed")}</span><Button variant="text" disabled={busy} onclick={onrestore}>{t("pageAction.restore")}</Button>{/if}
        {#if error}<span class="failure" title={error}>{error}</span>{/if}
    </div>
{/if}

<style>
    .page-status { display: flex; align-items: center; flex: none; gap: var(--ui-space-3); padding-inline: var(--ui-editor-gutter); min-height: var(--ui-toolbar-height); background: var(--ui-surface-panel); color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    .failure { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ui-danger); }
</style>