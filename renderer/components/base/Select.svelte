<script module lang="ts">
    import type { IconName } from "../utils/Icon.svelte";
    export type SelectOption = { value: string; label: string; icon?: IconName; disabled?: boolean };
</script>

<script lang="ts">
    import { Select } from "bits-ui";
    import Icon from "../utils/Icon.svelte";
    import TopLayer from "./TopLayer.svelte";
    import "./controls.css";

    let { label, options, groups = [], value = $bindable(""), open = $bindable(false), placeholder, disabled = false, onchange }: {
        label: string;
        options: SelectOption[];
        groups?: { label: string; options: SelectOption[] }[];
        value?: string;
        open?: boolean;
        placeholder?: string;
        disabled?: boolean;
        onchange?: (value: string) => void;
    } = $props();
    const items = $derived([...options, ...groups.flatMap(group => group.options)]);
    const selected = $derived(items.find(option => option.value === value));
</script>

<Select.Root type="single" bind:value bind:open items={items} {disabled} onValueChange={onchange}>
    <Select.Trigger class="ui-control ui-select" aria-label={label}>
        {#if selected?.icon}<Icon name={selected.icon} size="var(--ui-icon-normal)" />{/if}
        <span class="ui-select-label">{selected?.label ?? placeholder ?? ""}</span>
        <Icon name="chevron-down" size="var(--ui-icon-small)" />
    </Select.Trigger>
    <Select.Content class="ui-popup ui-options" strategy="fixed" sideOffset={4} collisionPadding={8}>
        {#snippet child({ props, wrapperProps })}
            <TopLayer props={wrapperProps}>
                <div {...props}>
                    <Select.Viewport>
                        {#each options as option (option.value)}{@render entry(option)}{/each}
                        {#each groups as group (group.label)}
                            <Select.Group>
                                <Select.GroupHeading class="group-heading">{group.label}</Select.GroupHeading>
                                {#each group.options as option (option.value)}{@render entry(option)}{/each}
                            </Select.Group>
                        {/each}
                    </Select.Viewport>
                </div>
            </TopLayer>
        {/snippet}
    </Select.Content>
</Select.Root>

{#snippet entry(option: SelectOption)}
    <Select.Item class="ui-menu-item" value={option.value} label={option.label} disabled={option.disabled}>
        {#if option.icon}<Icon name={option.icon} size="var(--ui-icon-normal)" />{/if}
        <span class="ui-menu-label">{option.label}</span>
        {#if value === option.value}<Icon name="check" size="var(--ui-icon-normal)" />{/if}
    </Select.Item>
{/snippet}

<style>
    .group-heading { padding: var(--ui-space-1) var(--ui-space-3); color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
</style>