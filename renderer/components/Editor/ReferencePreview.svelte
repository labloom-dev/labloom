<div class="editor-reference-preview" popover="manual" inert {@attach position}>{@render children()}</div>

<script lang="ts">
    import type { Snippet } from "svelte";
    let { anchor, children }: { anchor: HTMLElement; children: Snippet } = $props();

    function position(element: HTMLElement): () => void {
        function place(): void {
            const rect = anchor.getBoundingClientRect();
            const viewport = anchor.closest(".group-content") ?? anchor.closest(".editor-canvas");
            const pane = viewport?.getBoundingClientRect();
            const left = Math.max(0, pane?.left ?? 0), right = Math.min(window.innerWidth, pane?.right ?? window.innerWidth);
            const top = Math.max(0, pane?.top ?? 0), bottom = Math.min(window.innerHeight, pane?.bottom ?? window.innerHeight);
            const gap = parseFloat(getComputedStyle(element).getPropertyValue("--ui-space-2"));
            element.style.maxWidth = Math.max(0, right - left) + "px";
            const box = element.getBoundingClientRect();
            element.style.left = Math.max(left, Math.min(rect.left, right - box.width)) + "px";
            element.style.top = Math.max(top, rect.bottom + gap + box.height <= bottom ? rect.bottom + gap : rect.top - gap - box.height) + "px";
        }
        element.showPopover();
        place();
        const observer = new ResizeObserver(place);
        observer.observe(element);
        window.addEventListener("scroll", place, true);
        return () => {
            observer.disconnect();
            window.removeEventListener("scroll", place, true);
        };
    }
</script>