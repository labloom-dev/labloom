import { type Settings, type SettingsPatch } from "./Settings";

export function mergeSettings(base: Settings, patch: SettingsPatch): Settings {
    return {
        ...base, ...patch,
        appearance: { ...base.appearance, ...patch.appearance },
        window: { ...base.window, ...patch.window },
        layout: { ...base.layout, ...patch.layout }
    };
}