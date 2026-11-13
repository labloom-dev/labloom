import { type FailureInfo } from "../failure";

export type Workspace = {
    id: string;
    name: string;
    path: string;
};

export type WorkspaceAction = "create" | "open";

export type StartupState =
    | { status: "ready"; workspace: Workspace; }
    | {
        status: "needs-workspace";
        lastWorkspace: Workspace | null;
        canChoose: boolean;
        attemptedPath?: string;
        error?: FailureInfo;
        notice?: { kind: "config-backup"; path: string };
    };