import { createI18n, type Translate } from "../../shared/i18n";
import { type Language } from "../../shared/locale";

const instance = createI18n("zh-CN");
export function setLocale(language: Language): void {
    void instance.changeLanguage(language);
}
export const t: Translate = (key, options) => instance.t(key, options);