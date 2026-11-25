import type { AppCommands, AppQueries } from "./app/ipc";
import type { PagesAPI } from "./pages/ipc";
import type { AttributesAPI } from "./attributes/ipc";
import type { HistoryAPI } from "./history/ipc";
import type { PapersAPI } from "./papers/ipc";
import type { AttachmentsAPI } from "./attachments/ipc";
import type { TimersAPI } from "./timers/ipc";
import type { WorkspaceAPI } from "./workspace/ipc";
import type { SettingsAPI } from "./settings/ipc";
import type { StartupAPI } from "./startup/ipc";
import type { FeedAPI } from "./feed/ipc";

export type AppAPI = {
    app: AppCommands & AppQueries;
    pages: PagesAPI;
    attributes: AttributesAPI;
    history: HistoryAPI;
    papers: PapersAPI;
    attachments: AttachmentsAPI;
    timers: TimersAPI;
    workspace: WorkspaceAPI;
    settings: SettingsAPI;
    startup: StartupAPI;
    feed: FeedAPI;
};