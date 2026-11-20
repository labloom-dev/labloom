<script lang="ts">
    import { onMount } from "svelte";
    import Button from "../../components/base/Button.svelte";
    import IconButton from "../../components/base/IconButton.svelte";
    import Input from "../../components/base/Input.svelte";
    import Select from "../../components/base/Select.svelte";
    import Checkbox from "../../components/base/Checkbox.svelte";
    import ListRow from "../../components/base/ListRow.svelte";
    import controls from "../../components/base/controls.css?raw";

    const states = ["default", "hover", "active", "focus", "disabled"] as const;
    const headings = ["默认", "悬停", "按下", "键盘聚焦", "禁用"];
    const rows = ["主要按钮", "次要按钮", "文字按钮", "图标按钮", "开关 · 抬起", "开关 · 已按下", "输入 · 占位", "输入 · 有值", "输入 · 出错", "搜索 · 空", "搜索 · 有值", "选择 · 占位", "选择 · 有值", "未选", "选中", "半选", "危险确认按钮", "列表行"] as const;
    const actions = [{ icon: "edit" as const, label: "编辑", onclick: () => {} }];

    // Mirror the real pseudo-class rules only in this dev document. Specimens stay outside the tab order.
    onMount(() => {
        const source = new CSSStyleSheet();
        source.replaceSync(controls.replace(/^@import[^;]+;/m, ""));
        const sheet = new CSSStyleSheet();
        for (const rule of source.cssRules) {
            if (!(rule instanceof CSSStyleRule)) continue;
            const selector = rule.selectorText.replace(/:(hover|active|focus-visible|focus-within)\b/g, "[data-sim-$1]");
            if (selector !== rule.selectorText) sheet.insertRule(selector + "{" + rule.style.cssText + "}", sheet.cssRules.length);
        }
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        return () => {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet);
        };
    });

    function illustrate(node: HTMLElement, state: string): void {
        const targets = node.querySelectorAll(".ui-control, .ui-check, .ui-field, .ui-field-input, .ui-row, .ui-row-main");
        for (const target of targets) {
            if (state === "focus") {
                if (target.matches(".ui-row")) target.setAttribute("data-sim-focus-within", "");
                else if (!target.closest(".ui-row-actions") && !target.matches(".ui-field button")) target.setAttribute("data-sim-focus-visible", "");
            }
            else if (state === "hover" || state === "active") target.setAttribute("data-sim-" + state, "");
        }
    }
</script>

<div class="table-scroll">
    <table class="state-table">
        <thead><tr><th scope="col">组件</th>{#each headings as heading (heading)}<th scope="col">{heading}</th>{/each}</tr></thead>
        <tbody>
            {#each rows as row (row)}
                <tr>
                    <th scope="row">{row}</th>
                    {#each states as state (state)}
                        {@const disabled = state === "disabled"}
                        <td>
                            <div inert use:illustrate={state}>
                                {#if row === "主要按钮" || row === "次要按钮" || row === "文字按钮"}
                                    <Button variant={row === "主要按钮" ? "primary" : row === "次要按钮" ? "secondary" : "text"} icon="add" {disabled}>新建</Button>
                                {:else if row === "图标按钮" || row.startsWith("开关")}
                                    <IconButton icon={row === "图标按钮" ? "edit" : "bold"} label={row} pressed={row === "图标按钮" ? undefined : row === "开关 · 已按下"} {disabled} />
                                {:else if row.startsWith("输入")}
                                    <Input label={row} placeholder="页面标题" value={row === "输入 · 占位" ? "" : "页面 A"} invalid={row === "输入 · 出错"} {disabled} />
                                {:else if row.startsWith("搜索")}
                                    <Input search label="搜索" clearLabel="清空搜索" placeholder="搜索页面" value={row === "搜索 · 有值" ? "页面 A" : ""} {disabled} />
                                {:else if row.startsWith("选择")}
                                    <Select label="页面类型" placeholder="选择类型" options={[{ value: "page", label: "笔记", icon: "edit" }]} value={row === "选择 · 有值" ? "page" : ""} {disabled} />
                                {:else if row === "危险确认按钮"}
                                    <Button variant="danger" {disabled}>永久删除</Button>
                                {:else if row === "列表行"}
                                    {#if !disabled}<ListRow icon="book" title="页面 A" {actions} />{:else}<span aria-label="无此状态">—</span>{/if}
                                {:else}
                                    <Checkbox label="页面 A" checked={row === "选中"} indeterminate={row === "半选"} {disabled} />
                                {/if}
                            </div>
                        </td>
                    {/each}
                </tr>
            {/each}
        </tbody>
    </table>
</div>
<div class="row-examples">
    {#each ["选中", "失焦选中", "拖动经过"] as state (state)}
        <div><span>{state}</span><div inert><ListRow icon="book" title="页面 A" description="文献" selected={state !== "拖动经过"} focused={state === "选中"} dragOver={state === "拖动经过"} /></div></div>
    {/each}
</div>