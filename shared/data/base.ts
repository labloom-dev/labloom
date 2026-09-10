
export type uuid = string & {
    __uuidBrand: never;
};

export function isUuid(value: string): value is uuid {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}