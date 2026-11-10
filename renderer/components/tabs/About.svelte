<section class="workspace-page">
    <div class="paper-card about">
        <img src={icon} alt="Labloom 标志" />
        <span class="eyebrow">A HOME FOR YOUR CURIOSITY</span>
        <h1>知织 <span>Labloom</span></h1>
        <p class="tagline">Where ideas take root.</p>
        <p>追踪研究动态，阅读论文，记录想法。<br />把散落的知识，编织成自己的世界。</p>
        <div class="principles"><span>本地工作区</span><span>专注研究</span><span>持续生长</span></div>
        <div class="bloom"><Bloom /></div>
        <p class="version">Labloom，MIT License</p>
    </div>
</section>


<style>
    .about {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 45px 24px 24px;
        text-align: center;
    }
    img {
        width: 68px;
        height: 68px;
        margin-bottom: 24px;
        object-fit: contain;
    }
    h1 {
        margin: 15px 0 8px;
        font-size: 36px;
        font-weight: 900;
    }
    h1 span {
        margin-left: 8px;
    }
    p {
        margin: 15px 0;
        color: var(--c-muted);
        font-size: 13px;
        line-height: 1.9;
    }
    .tagline {
        color: var(--c-accent);
        font-size: 18px;
        font-style: italic;
    }
    .principles {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
        margin-top: 12px;
    }
    .principles span {
        padding: 7px 12px;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 8px;
        background: var(--c-cream);
        color: var(--c-muted);
        font-size: 11px;
    }
    .bloom {
        width: 175px;
        margin-top: 16px;
    }
    .version {
        font-size: 10px;
    }
</style>


<script lang="ts">
    import icon from "../../assets/icon.png";
    import Bloom from "../utils/Bloom.svelte";
</script>