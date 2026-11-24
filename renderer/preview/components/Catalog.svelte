<script lang="ts">
    import Icon, { iconNames, fluentIcons } from "../../components/utils/Icon.svelte";
    import Button from "../../components/base/Button.svelte";
    import IconButton from "../../components/base/IconButton.svelte";
    import Checkbox from "../../components/base/Checkbox.svelte";
    import Input from "../../components/base/Input.svelte";
    import ListRow from "../../components/base/ListRow.svelte";
    import ShellExample from "./ShellExample.svelte";
    import ComboboxExamples from "./ComboboxExamples.svelte";
    import DatePickerExamples from "./DatePickerExamples.svelte";
    import EditorExample from "./EditorExample.svelte";
    import StateTable from "./StateTable.svelte";
    import OverlayExample, { overlayNames } from "./OverlayExample.svelte";
    import tokens from "../../styles/ui-tokens.css?raw";

    let dark = $state(new URLSearchParams(location.search).get("theme") === "dark"), motion = $state(true), bold = $state(false), selected = $state(false);
    let search = $state("页面 A"), status = $state("");
    let values = $state<Record<string, string>>({});
    const names = [...new Set(tokens.match(/--ui-[\w-]+(?=:)/g))].filter(name => !name.startsWith("--ui-p-"));
    const colors = names.filter(name => /^--ui-(surface-|text(?:-|$)|border(?:-|$)|divider$|hover$|pressed$|selected(?:-|$)|focus$|accent|danger|shadow-|editor-(?:fg-|bg-|block-selection$|sync-border$))/.test(name));
    const metrics = names.filter(name => !colors.includes(name) && name !== "--ui-font-family" && name !== "--ui-font-mono");
    const groups = [
        { title: "控件与外壳", names: metrics.filter(name => /-height$|-activity-width$/.test(name)) },
        { title: "图标与间距", names: metrics.filter(name => /--ui-(icon-|space-)/.test(name)) },
        { title: "圆角与描边", names: metrics.filter(name => /--ui-(radius-|stroke|focus-)/.test(name)) },
        { title: "字号", names: metrics.filter(name => /--ui-font-/.test(name)) },
        { title: "动效时长", names: metrics.filter(name => /--ui-duration-/.test(name)) }
    ];
    $effect(() => {
        const root = document.documentElement;
        root.dataset.theme = dark ? "dark" : "light";
        root.dataset.motion = motion ? "on" : "off";
        const style = getComputedStyle(root);
        values = Object.fromEntries(names.map(name => [name, style.getPropertyValue(name).trim()]));
    });
    function report(message: string): void {
        status = message;
    }
</script>

<header class="catalog-header">
    <div><div data-paragraph>知织 / 开发预览</div><h1>基础组件</h1></div>
    <div class="theme-tools">
        <div class="theme-choice" role="group" aria-label="主题">
            <Button variant={dark ? "text" : "primary"} aria-pressed={!dark} onclick={() => dark = false}>浅色</Button>
            <Button variant={dark ? "primary" : "text"} aria-pressed={dark} onclick={() => dark = true}>深色</Button>
        </div>
        <Checkbox label="启用动效" bind:checked={motion} />
    </div>
</header>
<main class="catalog">
    <section aria-labelledby="live-title">
        <h2 id="live-title">交互样例</h2>
        <div class="live-grid" id="live">
            <div><h3>按钮</h3><div class="examples">
                <Button variant="primary" icon="add" onclick={() => report("已选择新建")}>新建</Button>
                <Button onclick={() => report("已选择编辑")}>编辑</Button>
                <Button variant="text" onclick={() => report("已选择查看")}>查看</Button>
            </div></div>
            <div><h3>图标按钮与复选框</h3><div class="examples">
                <IconButton icon="search" label="查找" shortcut="Ctrl+F" onclick={() => report("已选择查找")} />
                <IconButton icon="bold" label="加粗" shortcut="Ctrl+B" pressed={bold} onclick={() => bold = !bold} />
                <Checkbox label="标记已读" />
            </div></div>
            <div><h3>文本输入</h3><div class="examples fields">
                <Input label="页面标题" placeholder="页面标题" />
                <Input search label="搜索页面" clearLabel="清空搜索" placeholder="搜索页面" bind:value={search} />
            </div></div>
            <div><h3>选择与菜单</h3><div class="examples">
                <OverlayExample sample="选择" {report} />
                <OverlayExample sample="下拉菜单" {report} />
                <OverlayExample sample="右键菜单" {report} />
            </div></div>
            <div><h3>提示、对话框与浮层</h3><div class="examples">
                {#each ["悬浮提示", "确认对话框", "危险确认", "浮层"] as const as sample (sample)}<OverlayExample {sample} {report} />{/each}
            </div></div>
            <div><h3>列表行</h3>
                <ListRow icon="book" title="页面 A" description="研究笔记" {selected} onclick={() => selected = !selected}
                    actions={[{ icon: "edit", label: "编辑页面 A", onclick: () => report("已选择编辑页面 A") }]} />
            </div>
        </div>
        <output class="feedback" aria-live="polite">{status}</output>
    </section>
    <ComboboxExamples />
    <DatePickerExamples />
    <section><h2>外壳</h2><ShellExample /></section>
    <section id="editor">
        <h2>编辑器 <small><a href={"?sample=editor&theme=" + (dark ? "dark" : "light")}>单独查看</a></small></h2>
        <EditorExample />
    </section>
    <section><h2>控件状态</h2><StateTable /></section>
    <section>
        <h2>弹出状态</h2>
        <div class="overlay-grid">
            {#each overlayNames as sample (sample)}
                <figure><figcaption>{sample}</figcaption><iframe inert tabindex="-1" title={sample + "展开样例"} src={"?sample=" + sample + "&theme=" + (dark ? "dark" : "light") + "&motion=" + (motion ? "on" : "off")}></iframe></figure>
            {/each}
        </div>
    </section>
    <section>
        <h2>颜色与阴影</h2>
        <div class="swatches">
            {#each colors as name (name)}
                <div><i style:background={name.includes("shadow") ? "var(--ui-surface-popup)" : "var(" + name + ")"} style:box-shadow={name.includes("shadow") ? "var(" + name + ")" : undefined}></i>
                    <span>{name}<small>{values[name]}</small></span>
                </div>
            {/each}
        </div>
    </section>
    <section>
        <h2>尺寸、层级与动效</h2>
        <div class="metric-grid">
            {#each groups as group (group.title)}
                <div><h3>{group.title}</h3><dl>
                    {#each group.names as name (name)}
                        <div><dt>{name}</dt><dd>
                            {#if group.title === "字号"}<span style:font-size={"var(" + name + ")"}>字 Aa</span>
                            {:else if group.title === "圆角与描边"}<i class="metric-shape" style:border-radius={"var(" + name + ")"}></i>
                            {:else if group.title === "图标与间距" || group.title === "控件与外壳"}<i class="metric-bar" style:width={"var(" + name + ")"}></i>{/if}
                            {values[name]}
                        </dd></div>
                    {/each}
                </dl></div>
            {/each}
        </div>
    </section>
    <section>
        <h2>图标 <small>{iconNames.length}</small></h2>
        <div class="icon-comparison">
            {#each [16, 20] as size (size)}
                <div>
                    <h3>{size}px 对齐</h3>
                    <div class="examples" inert>
                        <Button><Icon name="bold" {size} />加粗</Button>
                        <Button><Icon name="underline" {size} />下划线</Button>
                        <Button><Icon name="undo" {size} />撤销</Button>
                        <Button><Icon name="redo" {size} />重做</Button>
                    </div>
                    <div data-paragraph><Icon name="bold" {size} /> 加粗 <Icon name="underline" {size} /> 下划线</div>
                </div>
            {/each}
        </div>
        <div class="glyphs">
            {#each iconNames as name (name)}
                {@const art = fluentIcons[name]}
                <div>
                    <Icon {name} size="var(--ui-icon-normal)" />{#if art}<Icon {name} size="var(--ui-icon-large)" />{/if}
                    <span class="glyph-label">{name}<small>{art ? (art.artwork16 ? "Fluent · 16 / 20px 画稿" : "Fluent · 均用 20px 画稿") : "Codicon"}</small></span>
                </div>
            {/each}
        </div>
    </section>
</main>