import { v4 } from "uuid";

export type uuid = string & {
    __uuidBrand: never;
};

export function getUUID(): uuid {
    return v4() as uuid;
}