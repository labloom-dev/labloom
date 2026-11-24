<script lang="ts">
    import { onMount } from "svelte";
    import type { AppInfo } from "../../../shared/app/ipc";
    import { failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import icon from "../../assets/icon.png";

    let info = $state<AppInfo>(), error = $state<ErrorValue>(""), copied = $state(false);
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    const rows = $derived(info ? [
        { label: t("about.version"), value: info.version },
        { label: t("about.electron"), value: info.electron },
        { label: t("about.chromium"), value: info.chromium },
        { label: t("about.node"), value: info.node },
        { label: t("about.v8"), value: info.v8 },
        { label: t("about.os"), value: [info.os.type, info.os.arch, info.os.version].join(" ") },
        { label: t("about.license"), value: "MIT" }
    ] : []);

    onMount(() => {
        void window.api.app.getInfo().then(value => info = value).catch(reason => {
            error = failure(reason);
        });
        return () => clearTimeout(copyTimer);
    });

    async function copy(): Promise<void> {
        if (!info) return;
        error = "";
        try {
            await navigator.clipboard.writeText(rows.map(({ label, value }) => label + " " + value).join("\n"));
            copied = true;
            clearTimeout(copyTimer);
            copyTimer = setTimeout(() => copied = false, 2000);
        }
        catch (reason) {
            copied = false;
            error = failure(reason);
        }
    }
</script>

<div class="about">
    <div class="brand"><img src={icon} alt="" draggable="false" /><span>{t("app.name")}</span></div>
    {#if info}
        <dl>
            {#each rows as { label, value } (label)}
                <div><dt>{label}</dt><dd>{value}</dd></div>
            {/each}
        </dl>
    {/if}
    <div class="actions">
        <Button disabled={!info} onclick={copy}>{t("command.copy")}</Button>
        <span role="status">{copied ? t("about.copied") : ""}</span>
    </div>
    {#if error}<div class="error" role="alert">{message(error)}</div>{/if}
</div>

<style>
    .about { height: 100%; padding: var(--ui-space-6); overflow: auto; background: var(--ui-surface-window); font-size: var(--ui-font-body); }
    .brand { display: flex; align-items: center; gap: var(--ui-space-4); font-size: var(--ui-font-title); font-weight: 600; }
    .brand img { width: calc(3 * var(--ui-icon-large)); height: auto; }
    dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--ui-space-2) var(--ui-space-5); margin: var(--ui-space-5) 0; }
    dl div { display: contents; }
    dt { color: var(--ui-text-secondary); }
    dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
    .actions { display: flex; align-items: center; gap: var(--ui-space-3); }
    .actions span { color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    .error { margin-top: var(--ui-space-2); color: var(--ui-text-danger); font-size: var(--ui-font-small); }
</style>