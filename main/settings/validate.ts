import { LabloomError } from "../../shared/failure";
import { type Settings, type SettingsPatch } from "../../shared/settings/Settings";
import { validPatch } from "../../shared/settings/validate";

export function validatePatch(value: unknown, base: Settings): SettingsPatch {
    if (!validPatch(value, base)) throw new LabloomError({ kind: "settings-invalid-update" });
    return value;
}