
export type uuid = string & {
    __uuidBrand: never;
};

export function isUuid(value: unknown): value is uuid {
    return (
        typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    );
}