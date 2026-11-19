import { type CommitResult } from "../../../shared/types/content";

const pending = new Set<Promise<unknown>>();
export function trackWrite<T>(request: Promise<T>): Promise<T> {
    pending.add(request);
    const finish = (): void => {
        pending.delete(request);
    };
    void request.then(finish, finish);
    return request;
}
export function pendingWrites(): Promise<unknown>[] {
    return [...pending];
}

/** Each page buffer recognizes only its own saved notifications, in either delivery order. */
export class WriteReceipts {
    private readonly ids = new Set<string>();
    take(id: string | undefined): boolean {
        return id !== undefined && this.ids.delete(id);
    }
    async submit(send: (id: string) => Promise<CommitResult>): Promise<CommitResult> {
        const id = crypto.randomUUID();
        this.ids.add(id);
        try {
            const result = await trackWrite(send(id));
            if (result.status !== "saved") this.ids.delete(id);
            return result;
        }
        catch (error) {
            this.ids.delete(id);
            throw error;
        }
    }
}