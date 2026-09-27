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
 * Helper to fetch localized messages. Converts '.' to '_' in key names
 * for Chrome compatibility.
 */
function getMessage(
  key: MessageKey | string,
  substitutions?: string | string[],
): string {
  const sanitizedKey = String(key).replace(/\./g, "_");
  return browser.i18n.getMessage(sanitizedKey, substitutions);
}

/**
 * Returns a localized string for the given key.
 * If the key is not found or translation fails, returns the key itself.
 */
export function $t(key: MessageKey, ...substitutions: string[]): string {
  try {
    const val = getMessage(key, substitutions);
    return val || String(key);
  } catch (e) {
    return String(key);
  }
}

/**
 * Returns a pluralized localized string.
 *
 * Which string to use is selected by Intl.PluralRules based on the given
 * number. If the key is not found or translation fails, returns a fallback
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

    const val = getMessage(`${keyBase}.${category}`, [
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
