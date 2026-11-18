import { type SettingsSnapshot } from "./Settings";

export function freezeSnapshot(snapshot: SettingsSnapshot): SettingsSnapshot {
    const freeze = (value: unknown): void => {
        if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    };
    freeze(snapshot);
    return snapshot;
}