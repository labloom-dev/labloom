<Menubar.Root>
    <Menubar.Menu>
        <Menubar.Trigger>Menu</Menubar.Trigger>
        <Menubar.Portal>
            <Menubar.Content sideOffset={8}>
                <Menubar.Item onSelect={() => window.electron.ipcRenderer.send("window:open-devtools")}>
                    打开开发者工具
                    <kbd>F12</kbd>
                </Menubar.Item>
            </Menubar.Content>
        </Menubar.Portal>
    </Menubar.Menu>
</Menubar.Root>


<script lang="ts">
    import { Menubar } from "bits-ui";
</script>