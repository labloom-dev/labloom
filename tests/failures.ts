import { LabloomError, type FailureKind } from "../shared/failure";

export function hasFailure(...kinds: FailureKind[]): (error: unknown) => boolean {
    return error => error instanceof LabloomError && kinds.includes(error.failure.kind);
}