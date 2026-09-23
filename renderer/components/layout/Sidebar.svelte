<nav>
    <button class="icon-container" title="Overview">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html home}
    </button>
    <button class="icon-container" title="RSS">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html rss}
    </button>
    <button class="icon-container" title="Papers">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html book}
    </button>
    <button class="icon-container" title="Schedule">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html calendar}
    </button>
    <button class="icon-container" title="Knowledge Base">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html library}
    </button>
    <button class="icon-container" title="AI">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html ai}
    </button>
    <div class="flex-end flex">
        <button class="icon-container" title="New Page">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html add}
        </button>
        <button class="icon-container" title="Settings">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html settings}
        </button>
    </div>
</nav>


<style>
    nav {
        /* Note: We cannot ignore this and this only. */
        app-region: drag;
        background-color: var(--c-sidebar-background);
        height: 100%;
        width: 48px;
        display: flex;
        flex-flow: column nowrap;
        justify-content: center;
    }
    nav :global(*) {
        /* Note: We cannot ignore this and this only. */
        app-region: no-drag;
    }
    .icon-container {
        display: grid;
        place-items: center;
        padding: 12px;
    }
    .flex-end {
        margin-top: auto;
    }
    .flex {
        display: flex;
        flex-flow: column nowrap;
        justify-content: center;
    }
</style>


<script lang="ts">
    import home from "../../assets/carbon--home.svg?raw";
    import rss from "../../assets/carbon--rss.svg?raw";
    import book from "../../assets/basil--book-outline.svg?raw";
    import calendar from "../../assets/carbon--calendar.svg?raw";
    import library from "../../assets/codicon--library.svg?raw";
    import ai from "../../assets/carbon--ai-agent.svg?raw";
    import add from "../../assets/carbon--add-large.svg?raw";
    import settings from "../../assets/carbon--settings.svg?raw";
</script>