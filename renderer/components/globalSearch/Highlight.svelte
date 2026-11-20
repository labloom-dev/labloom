<script lang="ts">
    import { matchRanges } from "../../../shared/content/matches";
    let { text, keyword }: { text: string; keyword: string } = $props();
    const matches = $derived([...matchRanges(text, keyword)]);
</script>

{#each matches as [start, end], index (start)}{text.slice(index ? matches[index - 1][1] : 0, start)}<strong>{text.slice(start, end)}</strong>{/each}{text.slice(matches.at(-1)?.[1] ?? 0)}

<style>
    strong { color: var(--ui-text-match); font-weight: 700; }
</style>