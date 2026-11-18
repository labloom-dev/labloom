import { defaultAppearance } from "../types/appearance";
import { type Settings } from "./Settings";

export const settingsVersion = 1;
export const minWindowWidth = 500;
export const minWindowHeight = 37 + 8 * 48;
export const maxWindowDimension = 16384;
export const minPanelWidth = 170;
export const maxPanelWidth = 500;
export const defaultSettings: Settings = {
    version: settingsVersion, lastWorkspace: null, appearance: { ...defaultAppearance },
    window: { width: 1280, height: 860, maximized: false },
    history: { limit: null },
    layout: { width: 240, collapsed: false }
};