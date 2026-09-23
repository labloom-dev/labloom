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
        error?: string;
        notice?: string;
    };

export interface AppAPI {
    startup: {
        getState: () => Promise<StartupState>;
        chooseWorkspace: (action: WorkspaceAction) => Promise<StartupState>;
        retry: () => Promise<StartupState>;
    };
}