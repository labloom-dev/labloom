import type { SettingsPatch, SettingsResult, SettingsSnapshot } from "../settings/Settings";
import type { Channels } from "../ipc/contract";

export type SettingsAPI = {
    get(): Promise<SettingsSnapshot>;
    update(patch: SettingsPatch): Promise<SettingsResult>;
    flush(revision: number): Promise<SettingsResult>;
    onChanged(listener: (snapshot: SettingsSnapshot) => void): () => void;
};

export const settingsChannels = {
    get: "settings:get",
    update: "settings:update",
    flush: "settings:flush"
} as const satisfies Channels<SettingsAPI>;
export const settingsChanged = "settings:changed";