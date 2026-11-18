import { type Appearance } from "../types/appearance";
import { type Workspace } from "../types/startup";
import { type FailureInfo } from "../failure";

export type Settings = {
    readonly version: 1;
    readonly lastWorkspace: Workspace | null;
    readonly appearance: Readonly<Appearance>;
    readonly window: { readonly width: number; readonly height: number; readonly maximized: boolean };
    readonly history: { readonly limit: number | null };
    readonly layout: { readonly width: number; readonly collapsed: boolean };
};
export type SettingsPatch = {
    readonly lastWorkspace?: Workspace | null;
    readonly appearance?: Partial<Appearance>;
    readonly window?: Partial<Settings["window"]>;
    readonly history?: Partial<Settings["history"]>;
    readonly layout?: Partial<Settings["layout"]>;
};
export type SettingsSnapshot = {
    readonly settings: Settings;
    readonly revision: number;
    readonly settingsRevision: number;
    readonly savedRevision: number;
    readonly dirty: boolean;
    readonly saving: boolean;
    readonly error: FailureInfo | null;
};
export type SettingsResult =
    | { success: true; snapshot: SettingsSnapshot }
    | { success: false; snapshot: SettingsSnapshot; error: FailureInfo };