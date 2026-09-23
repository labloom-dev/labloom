import { ElectronAPI } from "@electron-toolkit/preload";
import type { AppAPI } from "../shared/types/Startup";

declare global {
    interface Window {
        electron: ElectronAPI;
        api: AppAPI;
    }
}