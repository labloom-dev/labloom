import type { AppAPI } from "../shared/app";
import type { BridgeAPI } from "../shared/failure";

declare global {
    interface Window {
        api: AppAPI;
        bridge: BridgeAPI<AppAPI>;
    }
}