import type Messages from "../../assets/_locales/en/messages.json";
import browser from "webextension-polyfill";

export type MessageKey = keyof typeof Messages;

let pluralRules: Intl.PluralRules | null = null;
try {
  pluralRules = new Intl.PluralRules(browser.i18n.getUILanguage());
} catch (e) {
  // Ignored
}

/**
 * Returns a localized string for the given key.
 * If the key is not found or translation fails, returns the key itself.
 */
export function $t(key: MessageKey, substitutions?: string | string[]): string {
  try {
    const val = browser.i18n.getMessage(key, substitutions);
    return val || key;
  } catch (e) {
    return key;
  }
}

/**
 * Returns a pluralized localized string.
 * E.g. keyBase = "group" -> keyBase_one, keyBase_few (if language has few), keyBase_many
 */
export function $ts(
  n: number,
  keyBase: string,
  substitutions: string[] = [],
): string {
  try {
    const category = pluralRules
      ? pluralRules.select(n)
      : n === 1
        ? "one"
        : "other";
    let key = `${keyBase}_many`;

    if (category === "one") {
      key = `${keyBase}_one`;
    } else if (category === "few") {
      key = `${keyBase}_few`;
    } else if (category === "two") {
      key = `${keyBase}_two`;
    } else if (category === "zero") {
      key = `${keyBase}_zero`;
    }

    const val = browser.i18n.getMessage(key, [n.toString(), ...substitutions]);
    return val || `${n} ${keyBase}`;
  } catch (e) {
    return `${n} ${keyBase}`;
  }
}
