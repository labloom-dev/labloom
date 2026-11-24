<script lang="ts">
    import { onMount, type Snippet } from "svelte";
    import { isComposingKey, settingsShortcuts } from "../../../shared/content/commands";
    import { resolveTimeZone } from "../../../shared/content/time";
    import { type Workspace } from "../../../shared/types/startup";
    import { readingSizes, type Appearance } from "../../../shared/types/appearance";
    import { appearance, loadAppearance, preferences, savePreferences } from "../layout/preferences.svelte";
    import { message, t, failure, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Checkbox from "../base/Checkbox.svelte";
    import Combobox from "../base/Combobox.svelte";
    import Input from "../base/Input.svelte";
    import Select from "../base/Select.svelte";

    const languages = [{ value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }] as const;
    const themes = ["light", "dark", "system"] as const;
    const sizeOptions = readingSizes.map(size => ({ value: String(size), label: size + " px" }));
    const supportedZones = Intl.supportedValuesOf("timeZone");
    let systemZone = $state(resolveTimeZone("system"));
    const zones = $derived([
        { value: "system", label: t("settings.system"), detail: systemZone },
        ...[...new Set(["UTC", ...supportedZones, appearance.timeZone])].filter(name => name !== "system").sort()
            .map(name => ({ value: name, label: name }))
    ]);

    const limitErrorId = $props.id();
    let limitText = $state<string | null>(null), invalidLimit = $state(false);
    let workspace = $state<Workspace | null>(null);
    let workspaceError = $state<ErrorValue>("");

    onMount(() => {
        const refreshZone = (): void => {
            systemZone = resolveTimeZone("system");
        };
        window.addEventListener("focus", refreshZone);
        void window.api.startup.getState().then(state => {
            if (state.status === "ready") workspace = state.workspace;
            else workspaceError = { kind: "workspace-not-ready" };
        }).catch(error => {
            workspaceError = failure(error);
        });
        return () => window.removeEventListener("focus", refreshZone);
    });

    function change<K extends keyof Appearance>(key: K, value: Appearance[K]): void {
        void savePreferences({ appearance: { [key]: value } });
    }

    function applyLimit(): void {
        if (limitText === null) return;
        const text = limitText.trim(), limit = text ? Number(text) : null;
        invalidLimit = limit !== null && (!/^\d+$/.test(text) || !Number.isSafeInteger(limit) || limit <= 0);
        if (invalidLimit) return;
        limitText = null;
        if (limit !== preferences.historyLimit) void savePreferences({ history: { limit } });
    }

    function limitKeys(event: KeyboardEvent): void {
        if (isComposingKey(event) || event.key !== settingsShortcuts.apply) return;
        event.preventDefault();
        event.stopPropagation();
        applyLimit();
    }
</script>

<div class="settings">
    <div class="content">
        {#if preferences.error}
            <div class="save-error" role="alert">
                <div>{message(preferences.error)}</div>
                <Button disabled={preferences.saving} onclick={() => preferences.loaded ? savePreferences() : loadAppearance()}>{t("dialog.retry")}</Button>
            </div>
        {/if}

        <section>
            <h2>{t("settings.appearance")}</h2>
            {#snippet language()}
                <Select label={t("language.label")} value={appearance.language} options={[...languages]} disabled={!preferences.loaded}
                    onchange={value => change("language", value === "en" ? "en" : "zh-CN")} />
            {/snippet}
            {@render field(t("language.label"), t("language.hint"), language)}
            {#snippet theme()}
                <Select label={t("settings.theme")} value={appearance.theme} disabled={!preferences.loaded}
                    options={themes.map(value => ({ value, label: t(`settings.${value}`) }))} onchange={value => change("theme", value as Appearance["theme"])} />
            {/snippet}
            {@render field(t("settings.theme"), t("settings.themeHint"), theme)}
            {#snippet readingSize()}
                <Select label={t("settings.readingSize")} value={String(appearance.readingSize)} disabled={!preferences.loaded}
                    options={sizeOptions}
                    onchange={value => change("readingSize", Number(value) as Appearance["readingSize"])} />
            {/snippet}
            {@render field(t("settings.readingSize"), t("settings.readingSizeHint"), readingSize)}
            {#snippet motion()}
                <Checkbox label={t("settings.motion")} hideLabel checked={appearance.motion} disabled={!preferences.loaded} onchange={value => change("motion", value)} />
            {/snippet}
            {@render field(t("settings.motion"), t("settings.motionHint"), motion)}
        </section>

        <section>
            <h2>{t("settings.time")}</h2>
            {#snippet timeZone()}
                <div class="zone"><Combobox label={t("settings.timeZone")} options={zones} value={appearance.timeZone} disabled={!preferences.loaded}
                    onchange={value => change("timeZone", value)} /></div>
            {/snippet}
            {@render field(t("settings.timeZone"), t("settings.timeZoneHint"), timeZone)}
        </section>

        <section>
            <h2>{t("settings.undo")}</h2>
            {#snippet historyLimit()}
                <div class="limit">
                    <Input label={t("settings.historyLimit")} placeholder={t("settings.unlimited")} invalid={invalidLimit} disabled={!preferences.loaded}
                        value={limitText ?? String(preferences.historyLimit ?? "")}
                        oninput={value => {
                            limitText = value; invalidLimit = false;
                        }}
                        inputProps={{ inputmode: "numeric", onblur: applyLimit, onkeydown: limitKeys,
                            "aria-describedby": invalidLimit ? limitErrorId : undefined }} />
                </div>
                {#if invalidLimit}<div class="error" id={limitErrorId} role="alert">{t("settings.invalidHistoryLimit")}</div>{/if}
            {/snippet}
            {@render field(t("settings.historyLimit"), t("settings.historyLimitHint"), historyLimit)}
        </section>

        <section>
            <h2>{t("settings.workspace")}</h2>
            {#if workspace}
                <div class="name">{workspace.name}</div>
                <div class="path">{workspace.path}</div>
            {:else}
                <div class={workspaceError ? "error" : "hint"} role="status">{workspaceError ? message(workspaceError) : t("settings.workspaceLoading")}</div>
            {/if}
        </section>
    </div>
</div>

{#snippet field(name: string, hint: string, control: Snippet)}
    <div class="field">
        <div class="name">{name}</div>
        <div class="hint">{hint}</div>
        <div class="control">{@render control()}</div>
    </div>
{/snippet}

<style>
    .settings { height: 100%; overflow: auto; background: var(--ui-surface-window); color: var(--ui-text); font-size: var(--ui-font-body); }
    .content { max-width: var(--ui-editor-content-width); padding: var(--ui-space-6); }
    section + section { margin-top: var(--ui-space-6); }
    h2 { margin: 0 0 var(--ui-space-3); font-size: var(--ui-font-body); font-weight: 600; }
    .field + .field { margin-top: var(--ui-space-4); }
    .name { font-weight: 600; }
    .hint, .path { color: var(--ui-text-secondary); }
    .hint, .path, .error, .save-error { font-size: var(--ui-font-small); }
    .hint, .path { margin-top: var(--ui-space-1); }
    .path { overflow-wrap: anywhere; user-select: text; }
    .control { margin-top: var(--ui-space-2); }
    .zone { width: min(17em, 100%); }
    .zone :global(.ui-select) { width: 100%; }
    .limit { width: min(10em, 100%); }
    .error, .save-error { color: var(--ui-text-danger); }
    .error { margin-top: var(--ui-space-2); }
    .save-error { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-space-3); margin-bottom: var(--ui-space-5); }
</style>