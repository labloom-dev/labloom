<script module lang="ts">
    export const overlayNames = ["选择", "下拉菜单", "右键菜单", "子菜单", "悬浮提示", "确认对话框", "危险确认", "浮层"] as const;
    type Example = typeof overlayNames[number];
</script>

<script lang="ts">
    import { onMount, tick } from "svelte";
    import Button from "../../components/base/Button.svelte";
    import Menu, { type MenuItem } from "../../components/base/Menu.svelte";
    import Select from "../../components/base/Select.svelte";
    import Tooltip from "../../components/base/Tooltip.svelte";
    import ConfirmDialog from "../../components/base/ConfirmDialog.svelte";
    import Popover from "../../components/base/Popover.svelte";
    import Input from "../../components/base/Input.svelte";

    let { sample, expanded = false, report = () => {} }: { sample: Example; expanded?: boolean; report?: (message: string) => void } = $props();
    let open = $state(false);
    let checked = $state(true);
    let value = $state("page");
    const items: MenuItem[] = $derived([
        { label: "重命名", icon: "edit", shortcut: "F2", onselect: () => report("已选择重命名") },
        { label: "移动到", items: [
            { label: "页面 A", onselect: () => report("已移到页面 A") },
            { label: "页面 B", onselect: () => report("已移到页面 B") }
        ] },
        { separator: true },
        { label: "显示说明", checked, onselect: () => {
            checked = !checked; report(checked ? "已显示说明" : "已隐藏说明");
        } },
        { label: "删除", icon: "trash", disabled: true, onselect: () => {} }
    ]);
    const options = [
        { value: "page", label: "笔记", icon: "edit" },
        { value: "paper", label: "文献", icon: "book" },
        { value: "feed", label: "订阅", icon: "rss", disabled: true }
    ] as const;

    onMount(async () => {
        if (!expanded) return;
        if (sample === "右键菜单") {
            const trigger = document.querySelector<HTMLElement>("[data-context-menu-trigger]")!;
            const rect = trigger.getBoundingClientRect();
            trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom + 4 }));
        }
        else open = true;
        if (sample === "子菜单") {
            await tick();
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
            const sub = document.querySelector<HTMLElement>("[data-dropdown-menu-sub-trigger]");
            sub?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
        }
    });
</script>

{#if sample === "选择"}
    <Select label="页面类型" options={[...options]} bind:value bind:open onchange={next => report(next === "paper" ? "已选择文献" : "已选择笔记")} />
{:else if sample === "下拉菜单" || sample === "右键菜单" || sample === "子菜单"}
    <Menu {items} context={sample === "右键菜单"} bind:open>
        {#snippet trigger({ props })}
            <Button {...props}>{sample === "右键菜单" ? "右键操作" : "页面操作"}</Button>
        {/snippet}
    </Menu>
{:else if sample === "悬浮提示"}
    <Tooltip text="拆分编辑器" shortcut="Ctrl+\" bind:open>
        {#snippet trigger({ props })}<Button {...props} icon="split-horizontal">拆分</Button>{/snippet}
    </Tooltip>
{:else if sample === "浮层"}
    <Popover label="批注" bind:open>
        {#snippet trigger({ props })}<Button {...props} icon="comment">添加批注</Button>{/snippet}
        <div class="popover-example">
            <Input label="批注内容" placeholder="批注内容" />
            <Button onclick={() => {
                open = false; report("已关闭批注");
            }}>完成</Button>
        </div>
    </Popover>
{:else}
    {@const danger = sample === "危险确认"}
    <ConfirmDialog title={danger ? "永久删除页面 A？" : "保存更改？"} body={danger ? "删除后无法恢复页面内容。" : "更改将保存到当前工作区。"}
        confirmLabel={danger ? "永久删除" : "保存"} cancelLabel="取消" {danger} bind:open
        onconfirm={() => report(danger ? "已确认删除" : "已确认保存")} oncancel={() => report("已取消")}>
        {#snippet trigger({ props })}<Button {...props}>{danger ? "删除页面" : "保存更改"}</Button>{/snippet}
    </ConfirmDialog>
{/if}