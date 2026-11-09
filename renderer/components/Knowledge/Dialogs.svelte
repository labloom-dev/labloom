{#if knowledgeState.error}
    <div class="notice error toast">{knowledgeState.error}<button onclick={() => knowledgeState.error = ""}>关闭</button></div>
{/if}
{#if confirmation.resolve}
    <div class="shade">
        <section class="paper-card confirmation">
            <h2>{confirmation.heading}</h2>
            <p>{confirmation.text}</p>
            {#if confirmation.names.length}
                <ul>
                    {#each confirmation.names as name, index (index)}
                        <li>{name || "未命名"}</li>
                    {/each}
                </ul>
            {/if}
            <footer>
                <button class="button" onclick={() => answer(false)}>取消</button>
                <button class="button primary" onclick={() => answer(true)}>确认更改</button>
            </footer>
        </section>
    </div>
{/if}
<style>
    .shade { position: fixed; inset: 36px 0 0; z-index: 900; display: grid; place-items: center; padding: 24px; background: #0006; }
    .confirmation { width: min(520px, 100%); max-height: 80vh; padding: 24px; overflow: auto; }
    h2 { margin: 0 0 16px; font-size: 19px; }
    p, li { font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
    p { white-space: pre-line; }
    ul { max-height: 240px; overflow: auto; }
    footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
    .toast { position: fixed; bottom: 18px; right: 18px; max-width: 600px; z-index: 850; display: flex; gap: 20px; box-shadow: 2px 3px 12px #0002; }
</style>
<script lang="ts">
    import { answer, confirmation, knowledgeState } from "./state.svelte";
</script>