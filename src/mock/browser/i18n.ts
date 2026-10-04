import type {I18n} from "webextension-polyfill";

// The mock answers getMessage() calls from the English catalog, so that tests
// exercise the same strings an English-speaking user would see.
import catalog from "../../../assets/_locales/en/messages.json" with {type: "json"};

const MESSAGES = catalog as Record<string, {message: string}>;

function substitute(
  message: string,
  substitutions?: string[] | string,
): string {
  const subs =
    typeof substitutions === "string" ? [substitutions] : substitutions;
  return message.replace(/\$(\d+)/g, (_, n: string) => {
    const i = Number(n) - 1;
    return subs?.[i] !== undefined ? subs[i] : `$${n}`;
  });
}

export default (() => {
  const exports = {
    reset() {
      const i18n: I18n.Static = {
        getMessage(messageName, substitutions) {
          const message = MESSAGES[messageName]?.message;
          return message === undefined
            ? ""
            : substitute(message, substitutions);
        },

        getUILanguage() {
          return "en";
        },

        /* c8 ignore start -- not implemented */
        async getAcceptLanguages() {
          throw "unimplemented";
        },

        async getPreferredSystemLanguages() {
          throw "unimplemented";
        },

        async detectLanguage(_text: string) {
          throw "unimplemented";
        },
        /* c8 ignore stop */
      };
      (<any>globalThis).browser.i18n = i18n;
    },
  };

  exports.reset();

  return exports;
})();
