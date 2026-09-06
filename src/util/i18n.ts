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
export function $t(key: MessageKey, ...substitutions: string[]): string {
  try {
    const val = browser.i18n.getMessage(key, substitutions);
    return val || key;
  } catch (e) {
    return key;
  }
}

/**
 * Returns a pluralized localized string.
 *
 * Which string to use is selected by Intl.PluralRules based on the given
 * number.  If the key is not found or translation fails, returns a fallback
 * string in the format: "{n} {keyBase}".
 */
export function $ts(
  keyBase: string,
  n: number,
  ...substitutions: string[]
): string {
  try {
    const category = pluralRules
      ? pluralRules.select(n)
      : n === 1
        ? "one"
        : "other";

    const val = browser.i18n.getMessage(`${keyBase}.${category}`, [
      n.toString(),
      ...substitutions,
    ]);

    if (val) return val;
    else console.warn(`Missing translation for key: ${keyBase}.${category}`);
  } catch (e) {
    console.warn(e);
  }
  return `${n} ${keyBase}`;
}
