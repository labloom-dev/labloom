<script lang="ts">
    import { untrack } from "svelte";
    import { feedIntervals, type FeedSource, type FeedSourceInput } from "../../../shared/types/feed";
    import { arxivURL, feedURL } from "../../../shared/utils/feed";
    import { failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Checkbox from "../base/Checkbox.svelte";
    import Input from "../base/Input.svelte";
    import Select from "../base/Select.svelte";
    import { intervalLabel } from "./labels";

    let { source, pending, error = "", onsave, oncancel }: {
        source?: FeedSource;
        pending: boolean;
        error?: ErrorValue;
        onsave: (input: FeedSourceInput) => Promise<void>;
        oncancel: () => void;
    } = $props();

    const uid = $props.id();
    const blogs = [
        { name: "OpenAI News", url: "https://openai.com/news/rss.xml" },
        { name: "Anthropic News", url: "https://www.anthropic.com/news" },
        { name: "Anthropic Engineering", url: "https://www.anthropic.com/engineering" }
    ];
    const methods = $derived([
        { value: "url", label: t("feed.urlMethod") },
        { value: "arxiv", label: t("feed.arxivMethod") },
        ...blogs.map(blog => ({ value: blog.url, label: blog.name }))
    ]);
    let name = $state(untrack(() => source?.name ?? ""));
    let url = $state(untrack(() => source?.url ?? ""));
    let kind = $state(untrack(() => blogs.find(blog => blog.url === source?.url)?.url ?? "url"));
    let categories = $state(""), keyword = $state("");
    let autoRefresh = $state(untrack(() => source?.autoRefresh ?? true));
    let intervalMinutes = $state(untrack(() => source?.intervalMinutes ?? feedIntervals.default));
    const intervals = $derived([...new Set([15, 30, 60, 120, 180, 360, 720, 1440, intervalMinutes])].sort((a, b) => a - b)
        .map(minutes => ({ value: String(minutes), label: intervalLabel(minutes) })));
    const address = $derived.by(() => {
        if (kind === "url" && !url.trim() || kind === "arxiv" && !categories.trim() && !keyword.trim()) return { url: "", error: "" };
        try {
            return { url: kind === "arxiv" ? arxivURL(categories, keyword) : feedURL(kind === "url" ? url : kind), error: "" };
        }
        catch (cause) {
            return { url: "", error: failure(cause) };
        }
    });

    function selectKind(value: string): void {
        const blog = blogs.find(blog => blog.url === value);
        if (blog && (!name.trim() || blogs.some(entry => entry.name === name))) name = blog.name;
    }
    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!pending && address.url) await onsave({ id: source?.id, name, url: address.url, autoRefresh, intervalMinutes });
    }
</script>

<form onsubmit={submit}>
    <div class="field">
        <label for={uid + "-name"}>{t("feed.sourceName")}</label>
        <Input label={t("feed.sourceName")} bind:value={name} disabled={pending} inputProps={{ id: uid + "-name" }} />
    </div>
    <div class="field">
        <span>{t("feed.sourceMethod")}</span>
        <Select label={t("feed.sourceMethod")} options={methods} bind:value={kind} disabled={pending} onchange={selectKind} />
    </div>
    {#if kind === "url"}
        <div class="field">
            <label for={uid + "-url"}>{t("feed.address")}</label>
            <Input label={t("feed.address")} type="url" bind:value={url} disabled={pending} invalid={!!address.error}
                inputProps={{ id: uid + "-url", required: true, "aria-describedby": uid + "-discover" }} />
            <div class="hint" id={uid + "-discover"}>{t("feed.discoverAddress")}</div>
        </div>
    {:else if kind === "arxiv"}
        <div class="field">
            <label for={uid + "-categories"}>{t("feed.arxivCategories")}</label>
            <Input label={t("feed.arxivCategories")} bind:value={categories} disabled={pending}
                inputProps={{ id: uid + "-categories", "aria-describedby": uid + "-categories-rule" }} />
            <div class="hint" id={uid + "-categories-rule"}>{t("feed.arxivCategoriesRule")}</div>
        </div>
        <div class="field">
            <label for={uid + "-phrase"}>{t("feed.arxivKeyword")}</label>
            <Input label={t("feed.arxivKeyword")} bind:value={keyword} disabled={pending}
                inputProps={{ id: uid + "-phrase", "aria-describedby": uid + "-keyword-rule" }} />
            <div class="hint" id={uid + "-keyword-rule"}>{t("feed.arxivKeywordRule")}</div>
        </div>
    {/if}
    {#if kind !== "url" && address.url}<div class="address">{address.url}</div>{/if}
    {#if address.error}<div class="error" role="status">{message(address.error)}</div>{/if}
    <Checkbox label={t("feed.autoRefresh")} bind:checked={autoRefresh} disabled={pending} />
    {#if autoRefresh}
        <div class="field">
            <span>{t("feed.interval")}</span>
            <Select label={t("feed.interval")} options={intervals} value={String(intervalMinutes)} disabled={pending}
                onchange={value => intervalMinutes = Number(value)} />
        </div>
    {/if}
    {#if error}<div class="error" role="alert">{message(error)}</div>{/if}
    <div class="ui-dialog-actions">
        <Button onclick={oncancel} disabled={pending}>{t("dialog.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={pending || !address.url} aria-busy={pending}>
            {t(pending ? "feed.saving" : "feed.validateAndSave")}
        </Button>
    </div>
</form>

<style>
    form { display: flex; flex-direction: column; gap: var(--ui-space-4); padding-block-start: var(--ui-space-4); }
    .field { display: flex; flex-direction: column; gap: var(--ui-space-2); font-size: var(--ui-font-body); }
    .hint, .address, .error { color: var(--ui-text-secondary); font-size: var(--ui-font-small); line-height: 1.4; overflow-wrap: anywhere; }
    .address, .error { user-select: text; }
    .error { color: var(--ui-danger); }
    .field :global(.ui-select) { justify-content: space-between; }
    .ui-dialog-actions { margin-block-start: 0; }
</style>