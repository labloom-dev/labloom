<div class="reference-card" class:missing={!value}>
    {#if pending}
        <span>{t("editor.loadingReference")}</span>
    {:else if value}
        <button type="button" class="reference-title" onclick={open}>
            <Icon name="link-external" size="var(--ui-icon-normal)" />
            {value.status === "deleted" ? t("editor.deleted") : value.title || t(kind === "page" ? "shell.untitled" : "editor.emptyBlock")}{value.status === "recycled" ? t("editor.recycledSuffix") : ""}
        </button>
        {#if expanded || kind === "page"}<p>{value.text}</p>{/if}
    {:else}
        <span>{t("editor.missingReference")}</span>
    {/if}
</div>

<script lang="ts">
    import type { ResolvedTarget, Target } from "../../../shared/types/content";
    import { t } from "../../i18n.svelte";
    import Icon from "../utils/Icon.svelte";
    let { kind, value, pending = false, onopen }: {
        kind: Target["kind"]; value: ResolvedTarget | null; pending?: boolean; onopen: () => void;
    } = $props();
    let expanded = $state(false);
    function open(): void {
        if (kind === "block" && value?.status !== "deleted") expanded = !expanded;
        else onopen();
    }
</script>