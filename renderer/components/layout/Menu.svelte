<Menubar.Root>
    <Menubar.Menu>
        <Menubar.Trigger class="app-menu" aria-label="应用菜单">菜单 <Icon name="chevron" size={12} /></Menubar.Trigger>
        <Menubar.Portal>
            <Menubar.Content class="menu-content" sideOffset={12} align="end" collisionPadding={12}>
                <Menubar.Item class="menu-item" onSelect={() => openDestination("settings")}>偏好设置</Menubar.Item>
                <Menubar.Item class="menu-item" onSelect={() => openDestination("about")}>关于知织</Menubar.Item>
                <Menubar.Separator class="menu-divider" />
                <Menubar.Item class="menu-item" onSelect={() => window.api.openDevTools()}>开发者工具 <kbd>F12</kbd></Menubar.Item>
            </Menubar.Content>
        </Menubar.Portal>
    </Menubar.Menu>
</Menubar.Root>


<style>
    :global(.app-menu) {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 9px 12px;
        border: 1.5px solid var(--c-ink);
        border-radius: 9px;
        background: var(--c-cream);
        box-shadow: 2px 2px 0 var(--c-ink);
        font-size: 11px;
        font-weight: 800;
    }
    :global(.menu-content) {
        min-width: 190px;
        padding: 6px;
        border: 1.5px solid var(--c-ink);
        border-radius: 12px;
        background: var(--c-paper);
        box-shadow: var(--c-shadow);
        z-index: 60;
    }
    :global(.menu-item) {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px;
        border-radius: 7px;
        font-size: 12px;
        cursor: pointer;
    }
    :global(.menu-item[data-highlighted]) {
        background: var(--c-gold-light);
    }
    :global(.menu-divider) {
        height: 1px;
        margin: 5px;
        background: var(--c-line);
    }
</style>


<script lang="ts">
    import Icon from "../utils/Icon.svelte";
    import { Menubar } from "bits-ui";
    import { openDestination } from "./navigation";
</script>