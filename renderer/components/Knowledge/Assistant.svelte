<section class="workspace-page assistant-page">
    <header class="page-heading"><div><span class="eyebrow">THINK TOGETHER, GROW TOGETHER</span><h1>AI 研究助手</h1><p>带着自己的资料，聊一个问题，整理一点思路。</p></div><span class="badge">{assistantState.config?.model || "先连接你的模型"}</span></header>
    <details class="paper-card connection" open={!assistantState.config?.model}><summary>模型连接与设置</summary><form onsubmit={configure}><label>Ollama 服务地址<input bind:value={endpoint} type="url" required placeholder="http://localhost:11434" /></label><label>模型名称<input bind:value={model} required placeholder="填写已安装的模型名称" /></label><label>访问令牌（可选）<input bind:value={key} type="password" autocomplete="off" placeholder={assistantState.config?.hasKey ? "已安全保存，留空保留" : "本地 Ollama 通常不需要"} /></label><label class="check"><input type="checkbox" bind:checked={clearKey} />清除已保存令牌</label><button class="button" disabled={configuring || !!assistantState.request}>{configuring ? "正在保存…" : "保存连接"}</button><p>问题、最近对话与选中的页面内容会发送到此地址。每页最多提供前 12,000 个字符。PDF 仅使用文献信息、摘要和你写的笔记。远程服务需要 HTTPS。</p></form></details>
    <section class="paper-card context"><header><h2><Icon name="library" size={18} />这次带上的资料 <span class="badge">{assistantState.pages.length} / 10</span></h2><button class="text-button" disabled={!!assistantState.request} onclick={() => { assistantState.pages = []; }}>清空选择</button></header><form onsubmit={search}><input aria-label="搜索要提供给 AI 的资料" bind:value={query} placeholder="搜索知识页面或文献…" /><button class="button" disabled={searching}>{searching ? "正在搜索…" : "查找资料"}</button></form>{#if results.length}<div class="source-results">{#each results as page}<button class="source-option" disabled={!!assistantState.request || assistantState.pages.length >= 10 || assistantState.pages.some(item => item.id === page.id)} onclick={() => { assistantState.pages = [...assistantState.pages, { id: page.id, title: page.title }]; }}>{page.title}<span>＋</span></button>{/each}</div>{/if}<div class="selected-sources">{#each assistantState.pages as page}<button class="badge" disabled={!!assistantState.request} title="移除此资料" onclick={() => { assistantState.pages = assistantState.pages.filter(item => item.id !== page.id); }}>{page.title} ×</button>{/each}</div><div class="quick-prompts"><button class="text-button" disabled={!assistantState.pages.length || !!assistantState.request} onclick={() => { assistantState.question = "请总结所选资料的核心观点，指出依据，并列出值得继续研究的问题。"; }}>生成摘要</button><button class="text-button" disabled={!assistantState.pages.length || !!assistantState.request} onclick={() => { assistantState.question = "请解释所选资料中最重要的概念，说明资料之间的联系和差异，并标注引用。"; }}>解释与对比</button></div></section>
    <div class="conversation" aria-live="polite">{#each assistantState.messages as message, index}<section class="message paper-card" class:user={message.role === "user"}><header><span class="badge">{message.role === "user" ? "我的问题" : "研究助手"}</span>{#if message.role === "assistant"}<button class="text-button" onclick={() => saveAnswer(index)}>保存为知识页面</button>{/if}</header><div class="message-content">{message.content}</div>{#if message.sources?.length}<p class="source-label">本次提供的资料</p><div class="answer-sources">{#each message.sources as source}<button class="button" onclick={() => openPage(source)}>[{source.number}] {source.title}</button>{/each}</div>{/if}</section>{:else}<div class="empty-state"><Icon name="ai" size={38} /><strong>一个问题，就是新的起点。</strong><p>选上几页资料，让助手帮你归纳、解释或梳理关联。</p></div>{/each}</div>
    {#if assistantState.error}<div class="notice error" role="alert">{assistantState.error}</div>{/if}
    <form class="paper-card composer" onsubmit={ask}><textarea aria-label="向 AI 提问" bind:value={assistantState.question} placeholder="写下你的问题…" rows="3" maxlength="10000" disabled={!!assistantState.request}></textarea><footer><button class="text-button" type="button" disabled={!!assistantState.request || !assistantState.messages.length} onclick={() => { if (confirm("清空当前对话？已经保存的知识页面会保留。")) assistantState.messages = []; }}>清空对话</button><span>回答可作为研究参考，请结合资料核对。</span>{#if assistantState.request}<button class="button" type="button" onclick={cancel}>停止生成</button>{:else}<button class="button primary" disabled={!assistantState.config?.model || !assistantState.question.trim()}>发送问题 →</button>{/if}</footer></form>
</section>


<style>
    .assistant-page { max-width: 1100px; }
    .connection { margin-bottom: 22px; box-shadow: none; }
    summary { padding: 16px 20px; font-size: 12px; font-weight: 800; cursor: pointer; }
    .connection form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; padding: 4px 20px 20px; }
    label { display: flex; flex-direction: column; gap: 8px; color: var(--c-muted); font-size: 11px; }
    .check { flex-direction: row; align-items: center; }
    input, textarea { width: 100%; min-width: 0; padding: 10px; border: 1px solid var(--c-line); border-radius: 7px; background: var(--c-paper); color: var(--c-ink); font: inherit; font-size: 12px; }
    input[type="checkbox"] { width: auto; }
    .connection p { grid-column: 1 / -1; margin: 0; color: var(--c-muted); font-size: 11px; line-height: 1.8; }
    .context { padding: 20px; box-shadow: none; }
    header, .context form, .selected-sources, .quick-prompts, .answer-sources, footer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    h2 { display: flex; align-items: center; gap: 8px; flex: 1; margin: 0; font-size: 13px; }
    .context form { margin-top: 15px; }
    .context form input { flex: 1; }
    .selected-sources { margin-top: 14px; }
    .selected-sources .badge { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .quick-prompts { margin-top: 12px; gap: 20px; }
    .source-results { max-height: 220px; overflow: auto; margin-top: 10px; }
    .source-option { display: flex; gap: 12px; justify-content: space-between; width: 100%; padding: 10px 4px; border-bottom: 1px solid var(--c-line); text-align: left; font-size: 11px; }
    .source-option:disabled { opacity: .4; }
    .conversation { margin: 24px 0; }
    .message { padding: 22px; margin-bottom: 18px; box-shadow: none; }
    .message.user { background: var(--c-cream); }
    .message header { justify-content: space-between; }
    .message-content { margin-top: 15px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; font-size: var(--reading-font-size, 16px); line-height: 1.9; }
    .source-label { margin-top: 18px; color: var(--c-muted); font-size: 11px; }
    .answer-sources .button { font-size: 10px; max-width: 100%; overflow-wrap: anywhere; }
    .composer { padding: 16px; }
    textarea { resize: vertical; min-height: 90px; border: 0; font-size: 14px; }
    footer { margin-top: 12px; }
    footer span { flex: 1; color: var(--c-muted); font-size: 10px; }
</style>


<script lang="ts">
    import { onMount } from "svelte";
    import type { DocumentNode, PageSummary } from "../../../shared/types/knowledge";
    import Icon from "../utils/Icon.svelte";
    import { openPage } from "../layout/navigation";
    import { acceptPage, changed, knowledgeState, saveAll } from "./state.svelte";
    import { assistantState } from "./assistant.svelte";

    let endpoint = $state("http://localhost:11434"), model = $state(""), key = $state("");
    let clearKey = $state(false), configuring = $state(false), searching = $state(false);
    let query = $state("");
    let results = $state<PageSummary[]>([]);
    onMount(() => { void window.api.assistant.config().then(config => { assistantState.config = config; endpoint = config.endpoint; model = config.model; }).catch(error => { assistantState.error = String(error); }); });
    async function configure(event: SubmitEvent): Promise<void> {
        event.preventDefault(); configuring = true; assistantState.error = "";
        try { assistantState.config = await window.api.assistant.configure({ endpoint, model, key, clearKey }); key = ""; clearKey = false; knowledgeState.notice = "模型配置已保存，可以发送问题测试连接。"; }
        catch (error) { assistantState.error = error instanceof Error ? error.message : "配置保存失败。"; }
        finally { configuring = false; }
    }
    async function search(event: SubmitEvent): Promise<void> { event.preventDefault(); searching = true; try { results = (await window.api.knowledge.list({ keyword: query, limit: 12 })).items; if (!results.length) assistantState.error = "没有找到匹配的页面。"; } catch (error) { assistantState.error = String(error); } finally { searching = false; } }
    async function ask(event: SubmitEvent): Promise<void> {
        event.preventDefault(); if (assistantState.request || !assistantState.question.trim()) return;
        assistantState.error = "";
        const id = crypto.randomUUID(); assistantState.request = id; assistantState.cancelled = false;
        try {
            if (!await saveAll()) throw new Error("有页面尚未保存，请先解决保存错误再发送资料。");
            if (assistantState.cancelled) throw new Error("已取消生成。");
            const question = assistantState.question.trim();
            const history = $state.snapshot(assistantState.messages.slice(-12));
            assistantState.messages.push({ role: "user", content: question });
            const reply = await window.api.assistant.ask({ id, question, pageIds: assistantState.pages.map(page => page.id), history });
            assistantState.messages.push({ role: "assistant", ...reply }); assistantState.question = "";
        }
        catch (error) { assistantState.error = error instanceof Error ? error.message : "回答生成失败。"; }
        finally { assistantState.request = ""; }
    }
    async function cancel(): Promise<void> { assistantState.cancelled = true; try { await window.api.assistant.cancel(assistantState.request); } catch (error) { assistantState.error = String(error); } }
    async function saveAnswer(index: number): Promise<void> {
        const message = assistantState.messages[index];
        try {
            const content: DocumentNode[] = message.content.split("\n").map(line => ({ type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] } : {}) }));
            for (const source of message.sources ?? []) content.push({ type: "pageReference", attrs: { targetId: source.id, title: source.title, mode: "reference", writable: false } });
            const page = await window.api.knowledge.create({ title: `研究笔记：${assistantState.messages[index - 1]?.content.slice(0, 45) || "AI 回答"}`, document: { type: "doc", content } });
            acceptPage(page); changed(); openPage(page);
        }
        catch (error) { assistantState.error = error instanceof Error ? error.message : "回答保存失败。"; }
    }
</script>