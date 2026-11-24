import type { AppAPI } from "../shared/app";
import type { BridgeAPI } from "../shared/ipc/bridge";

declare global {
    interface Window {
        getPathForFile(file: File): string;
        api: AppAPI;
        bridge: BridgeAPI<AppAPI>;
    }
}