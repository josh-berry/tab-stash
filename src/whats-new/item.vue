<template>
  <li :title="subtext">
    <span v-if="v" :class="{[verbClass]: true}"
      >{{ emoji ? `${emoji}&nbsp;` : "" }}{{ v }}</span
    >
    <span v-if="v">&nbsp;</span>
    <span><slot /></span>
    <span v-if="links.length > 0" class="issue">
      [<span v-for="(l, idx) of links" :key="l.text"
        ><a :href="l.href">{{ l.text }}</a
        ><span v-if="idx < links.length - 1">, </span></span
      >]
    </span>
  </li>
</template>

<script lang="ts">
import type {PropType} from "vue";
import {defineComponent} from "vue";

export type Verb =
  | ""
  | CapitalizeWords<DashesToSpaces<NormalizedVerb>>
  | `${CapitalizeWords<DashesToSpaces<NormalizedVerb>>}:`;

export type NormalizedVerb =
  | "new"
  | "added"
  | "improved"
  | "fixed"
  | "removed"
  | "new-experiment"
  | "experiment-released";

type DashesToSpaces<T extends string> = T extends `${infer L}-${infer R}`
  ? `${L} ${DashesToSpaces<R>}`
  : T;
type CapitalizeWords<T extends string> = T extends `${infer L} ${infer R}`
  ? `${Capitalize<L>} ${CapitalizeWords<R>}`
  : Capitalize<T>;

function coerceArray<T>(i: T | T[]): T[] {
  if (i instanceof Array) return i;
  return [i];
}

export default defineComponent({
  props: {
    v: String as PropType<Verb>, // v is for "verb"
    subtext: String,
    issue: [Array, Number] as PropType<number | number[]>,
    pr: [Array, Number] as PropType<number | number[]>,
    thanks: [Array, String] as PropType<string | string[]>,
  },
  computed: {
    verbClass(): NormalizedVerb | "" {
      if (!this.v) return "";
      return this.v
        .toLowerCase()
        .replace(":", "")
        .replace(" ", "-") as NormalizedVerb;
    },

    emoji(): string {
      switch (this.verbClass) {
        case "new":
        case "added":
          return "🚀";
        case "improved":
          return "👍";
        case "fixed":
          return "✅";
        case "removed":
          return "❌";
        case "new-experiment":
        case "experiment-released":
          return "🧪";
        default:
          return "";
      }
    },

    links(): {text: string; href: string}[] {
      const links = [];
      const issues = coerceArray(this.issue || []);
      const prs = coerceArray(this.pr || []);
      const thanks = coerceArray(this.thanks || []);

      links.push(
        ...issues.map(i => ({
          text: `#${i}`,
          href: `https://github.com/josh-berry/tab-stash/issues/${i}`,
        })),
      );

      links.push(
        ...prs.map(pr => ({
          text: `pr#${pr}`,
          href: `https://github.com/josh-berry/tab-stash/pull/${pr}`,
        })),
      );

      links.push(
        ...thanks.map(thx => ({
          text: `🙏 ${thx}`,
          href: `https://github.com/${thx}`,
        })),
      );

      return links;
    },
  },
});
</script>

<style></style>
