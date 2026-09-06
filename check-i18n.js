import {readFileSync, readdirSync} from "fs";
import {join} from "path";

//
// Where to find the files to check.
//

const MESSAGES_PATH = "assets/_locales";
const MANIFEST_PATH = "assets/manifest.json";
const SRC_PATH = "src";
const SRC_INCLUDE_RES = [/\.ts$/, /\.vue$/];
// We exclude i18n.ts itself because it defines $t() and $ts(), and our silly
// little regex matcher misinterprets these definitions as call sites.
const SRC_EXCLUDE_RES = [/\.d\.ts$/, /\.test\.ts$/, /src\/util\/i18n\.ts$/];

//
// What each call site looks like.
//

// For manifest.json, it looks like "__MSG_key__" (no quotes).
const MANIFEST_CALL_RE = /__MSG_([A-Za-z0-9_]+)__/g;

// For everything else, it looks like a call to the special $t or $ts functions,
// with a hard-coded key name. (Dynamic keys are not allowed.)
const SINGULAR_CALL_RE = /\$t[ \t\r\n]*\([ \t\r\n]*(["'])([a-zA-Z0-9_]+)\1/g;
const PLURAL_CALL_RE = /\$ts[ \t\r\n]*\([ \t\r\n]*(["'])([a-zA-Z0-9_]+)\1/g;

// An dynamic usage of $t or $ts, which is not allowed.
const DYNAMIC_CALL_RE = /\$ts?[ \t\r\n]*\([ \t\r\n]*[^"' \t\r\n]/g;

//
// State this program keeps.
//

// Which passes to run.
const passes = [];

// Errors discovered by each pass.
const errors = [];

//
// Utility functions.
//

/** Read/modify/write of a map.
 * @param {Map} map - The map to read/modify/write.
 * @param {any} key - The key to read/modify/write.
 * @param {function} ctor - A function that returns a new value if the key is not present.
 * @param {function} update - A function that takes the current value and returns a new value.
 * @returns {any} The new value for the key.
 */
function rmw(map, key, ctor, update) {
  let item = map.get(key);
  if (item === undefined) {
    item = ctor();
  }
  if (update) item = update(item);
  map.set(key, item);
  return item;
}

/** Walks a directory tree, yielding the paths of all files in the tree. */
function* walk(dir) {
  const entries = readdirSync(dir, {withFileTypes: true});
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

/** Read all locale messages from a directory tree.
 * @param {string} tree - The path to the directory tree.
 * @returns {Map<string, Object>} A map from locale to the message JSON.
 */
function readAllMessages(tree) {
  const messages = new Map(); // locale -> message_json
  for (const locale of readdirSync(tree)) {
    const path = join(tree, locale, "messages.json");
    const json = JSON.parse(readFileSync(path, "utf-8"));
    messages.set(locale, json);
  }
  return messages;
}

/** Given a locale message key, split it into its stem and plural parts.
 *
 * A singular message is just the stem (i.e. `[stem, ""]`), while a plural
 * message is of the form `[stem, plural]`, where plural is one of "zero",
 * "one", "two", "few", "many", or "other".
 *
 * @param {string} key - The message key to split.
 * @returns {[string, string]} A tuple of [stem, plural], where plural is one of
 * "", "zero", "one", "two", "few", "many", or "other".
 */
function splitMsgKey(key) {
  const match = key.match(/^(.*?)(?:_(zero|one|two|few|many|other))?$/);
  if (!match) {
    throw new Error(`Invalid message key: ${key}`);
  }
  return [match[1], match[2] || ""];
}

const PLACEHOLDER_RE = /\$(\d+)/g;

/** Given a message string, return the number of placeholders it contains.
 * @param {string} msg - The message string to analyze.
 * @returns {number} The number of placeholders in the message.
 */
function arityOfMsg(msg) {
  return (msg.match(PLACEHOLDER_RE) || []).length;
}

/** @typedef {Object} PluralMessage
 * @property {SingularMessage} [''] - The singular message.
 * @property {SingularMessage} [zero] - The message for zero items.
 * @property {SingularMessage} [one] - The message for one item.
 * @property {SingularMessage} [two] - The message for two items.
 * @property {SingularMessage} [few] - The message for few items.
 * @property {SingularMessage} [many] - The message for many items.
 * @property {SingularMessage} [other] - The message for other items.
 */

/** @typedef {Object} SingularMessage
 * @property {string} message - The message string.
 * @property {number} arity - The number of placeholders in the message.
 */

/** Builds an index of message keys out of the message JSON read by `readAllMessages`. The returned value looks like:
 *
 * ```
 * Map<key, Map<locale, PluralMessage>>
 * ```
 *
 * @param {Map<string, Object>} messages - A map from locale to the message JSON.
 * @returns {Map<string, Map<string, PluralMessage>>} An index of message keys.
 */
function buildKeyIndex(messages) {
  const index = new Map();
  for (const [locale, msgs] of messages) {
    for (const [key, value] of Object.entries(msgs)) {
      const [stem, plural] = splitMsgKey(key);

      const locales = rmw(index, stem, () => new Map());
      const plurality = rmw(locales, locale, () => ({}));

      if (typeof value.message !== "string") {
        errors.push(
          `Invalid message for key "${key}" in locale "${locale}": ${JSON.stringify(value)}`,
        );
        continue;
      }

      plurality[plural] = {
        message: value.message,
        arity: arityOfMsg(value.message),
      };
    }
  }
  return index;
}

/** Pass to check for keys which are missing in some locales. */
function checkMissingLocales(allLocales, keyIndex) {
  for (const [key, locales] of keyIndex) {
    if (locales.size !== allLocales.length) {
      const missing = allLocales.filter(l => !locales.has(l));
      errors.push(`Missing locales for key "${key}": ${missing.join(", ")}`);
    }
  }
}
passes.push(checkMissingLocales);

/** Pass to check for keys with inconsistent usage of placeholders. */
function checkInconsistentArities(allLocales, keyIndex) {
  for (const [key, locales] of keyIndex) {
    const arities = new Map();
    for (const [locale, plurality] of locales) {
      for (const [plural, msg] of Object.entries(plurality)) {
        rmw(arities, msg.arity, () => []).push(locale);
      }
    }
    if (arities.size > 1) {
      errors.push(
        `Inconsistent arities for key "${key}":\n  ${[...arities.entries()].map(([arity, locales]) => `${arity}: ${locales.join(", ")}`).join("\n  ")}`,
      );
    }
  }
}
passes.push(checkInconsistentArities);

/** Pass to check for keys which are plural in some locales and singular in
 * others. (Or weirder yet, both in the same locale.) */
function checkInconsistentPlurality(allLocales, keyIndex) {
  for (const [key, locales] of keyIndex) {
    const singularLocales = [];
    const pluralLocales = [];

    for (const [locale, plurality] of locales) {
      const singular = "" in plurality;
      const plural = Object.keys(plurality).filter(k => k !== "").length > 0;

      if (singular && plural) {
        errors.push(
          `Key "${key}" in locale "${locale}" has both singular and plural forms.`,
        );
      }

      if (singular) singularLocales.push(locale);
      if (plural) pluralLocales.push(locale);
    }

    if (singularLocales.length > 0 && pluralLocales.length > 0) {
      errors.push(
        `Inconsistent plurality for key "${key}":\n  Singular locales: ${singularLocales.join(", ")}\n  Plural locales: ${pluralLocales.join(", ")}`,
      );
    }
  }
}
passes.push(checkInconsistentPlurality);

/** Checks for plural form definitions which are consistent with the language's
 * plural rules.
 *
 * @note This pass is disabled until I've had a chance to make the plural
 * conventions consistent with how PluralRules actually works.
 */
function checkIncorrectPluralityForLanguage(allLocales, keyIndex) {
  for (const [key, locales] of keyIndex) {
    for (const [locale, plurality] of locales) {
      if (
        Object.keys(plurality).length === 1 &&
        Object.keys(plurality)[0] === ""
      ) {
        continue; // singular message, no plural forms to check
      }

      const rules = new Intl.PluralRules(locale);
      const expectedPlurals = new Set(rules.resolvedOptions().pluralCategories);
      const actualPlurals = new Set(Object.keys(plurality));
      if (expectedPlurals.symmetricDifference(actualPlurals).size > 0) {
        errors.push(
          `Incorrect plural forms for key "${key}" in locale "${locale}":\n  Expected: ${[...expectedPlurals].join(", ")}\n  Actual: ${[...actualPlurals].join(", ")}`,
        );
      }
    }
  }
}
// passes.push(checkIncorrectPluralityForLanguage);

/** Mega-pass which checks all usage sites for i18n keys, and looks for a few things:
 *
 * - Keys which are used in source code but not defined in any locale.
 * - Keys which are defined in locales but not used in any source code.
 * - Keys which are used as singular messages but have plural forms defined.
 * - Keys which are used as plural messages but have singular forms defined.
 */
function checkUsageSites(allLocales, keyIndex) {
  function positionOf(offset, path, content) {
    const lines = content.slice(0, offset).split("\n");
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    return `${path}:${line}:${column}`;
  }

  const knownUsedKeys = new Set();

  const manifestContent = readFileSync(MANIFEST_PATH, "utf-8");

  for (const match of manifestContent.matchAll(MANIFEST_CALL_RE)) {
    const key = match[1];
    if (!keyIndex.has(key)) {
      const position = positionOf(match.index, MANIFEST_PATH, manifestContent);
      errors.push(`${position}: Key "${key}" is not defined in any locale.`);
    }

    knownUsedKeys.add(key);
  }

  for (const filePath of walk(SRC_PATH)) {
    if (
      !SRC_INCLUDE_RES.some(re => re.test(filePath)) ||
      SRC_EXCLUDE_RES.some(re => re.test(filePath))
    ) {
      continue;
    }

    const content = readFileSync(filePath, "utf-8");

    for (const match of content.matchAll(SINGULAR_CALL_RE)) {
      const key = match[2];
      const index = keyIndex.get(key);
      if (!index) {
        const position = positionOf(match.index, filePath, content);
        errors.push(`${position}: Key "${key}" is not defined in any locale.`);
        continue;
      }

      if (!("" in index.values().next().value)) {
        const position = positionOf(match.index, filePath, content);
        errors.push(
          `${position}: Key "${key}" is used as a singular message, but it has plural forms defined.`,
        );
      }

      knownUsedKeys.add(key);
    }

    for (const match of content.matchAll(PLURAL_CALL_RE)) {
      const key = match[2];
      const index = keyIndex.get(key);
      if (!index) {
        const position = positionOf(match.index, filePath, content);
        errors.push(`${position}: Key "${key}" is not defined in any locale.`);
        continue;
      }

      if ("" in index.values().next().value) {
        const position = positionOf(match.index, filePath, content);
        errors.push(
          `${position}: Key "${key}" is used as a plural message, but it has a singular form defined.`,
        );
      }

      knownUsedKeys.add(key);
    }

    for (const match of content.matchAll(DYNAMIC_CALL_RE)) {
      const position = positionOf(match.index, filePath, content);
      errors.push(
        `${position}: Call to $t() or $ts() with a non-literal key name. Use a hard-coded string instead.`,
      );
    }
  }

  for (const key of keyIndex.keys()) {
    if (!knownUsedKeys.has(key)) {
      errors.push(
        `Key "${key}" is defined in locales, but it is not used in any source file.`,
      );
    }
  }
}
passes.push(checkUsageSites);

//
// Main program.
//

const messages = readAllMessages(MESSAGES_PATH);
const keyIndex = buildKeyIndex(messages);

for (const pass of passes) {
  pass([...messages.keys()], keyIndex);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`${error}\n`);
  }
  process.exit(1);
}
