<template>
  <Notification inactive @dismiss="clearErrorLog">
    <div :class="$style.msg">
      Oops! Something went wrong. Tab Stash will try to recover automatically.
    </div>

    <details :class="$style.details" @click.stop="">
      <summary>Get Help With This Crash</summary>

      <p>
        Here are a few options that might help. Crash details are shown below
        for easy reference&mdash;they will be cleared once you close this
        notification.
      </p>

      <p>
        <button @click.stop="showTroubleshooting">
          Show Troubleshooting Guide
        </button>
        <button @click.stop="searchGitHub">Search for Similar Issues</button>
        <button
          :disabled="!searchedForCrashes"
          :title="
            !searchedForCrashes
              ? `Please search for similar issues before reporting a crash, to be sure you're not about to report a duplicate.`
              : ''
          "
          @click.stop="reportCrash"
        >
          Report Crash
        </button>
      </p>

      <p>
        <output ref="err_log_el" :class="$style.err_details_list">
          <p :class="$style.environment">
            Browser: {{ aboutBrowser }} ({{ aboutPlatform }})<br />
            Extension: {{ aboutExtension }}
          </p>

          <p v-for="err of errorLog">
            <span :class="$style.err_summary">{{ err.summary }}</span>
            <br />
            <span :class="$style.err_details">{{ err.details }}</span>
          </p>
        </output>
      </p>
    </details>

    <details :class="$style.details" @click.stop="">
      <summary>Hide Crash Reports</summary>

      <p>
        If you're seeing too many crash reports, you can temporarily hide them:
      </p>

      <p>
        <button @click.stop="hideCrashReports(5 * 60 * 1000)">
          for 5 minutes
        </button>
        <button @click.stop="hideCrashReports(60 * 60 * 1000)">
          for 1 hour
        </button>
        <button @click.stop="hideCrashReports(24 * 60 * 60 * 1000)">
          for 1 day
        </button>
        <button @click.stop="hideCrashReports(7 * 24 * 60 * 60 * 1000)">
          for 1 week
        </button>
      </p>

      <p>Crash reports can be turned on again in settings.</p>
    </details>
  </Notification>
</template>

<script lang="ts">
import {inject, ref, type Ref} from "vue";
import browser from "webextension-polyfill";

const TROUBLESHOOTING_URL =
  "https://josh-berry.github.io/tab-stash/support.html";

const aboutBrowser = ref("<Unknown Browser>");
if (browser.runtime.getBrowserInfo) {
  browser.runtime.getBrowserInfo().then(info => {
    aboutBrowser.value = `${info.vendor} ${info.name} ${info.version} ${info.buildID}`;
  });
}

const aboutPlatform = ref("<Unknown Platform>");
if (browser.runtime.getPlatformInfo) {
  browser.runtime.getPlatformInfo().then(info => {
    aboutPlatform.value = `${info.os} ${info.arch}`;
  });
}

const aboutExtension = ref("<Unknown Extension>");
if (browser.management.getSelf) {
  browser.management.getSelf().then(info => {
    aboutExtension.value = `${info.name} ${info.version} (${info.installType})`;
  });
}
</script>

<script setup lang="ts">
import type {Model} from "../model";
import {clearErrorLog, errorLog, logErrorsFrom} from "../util/oops";
import Notification from "./notification.vue";

const model = inject<Model>("$model")!;

const err_log_el: Ref<object | null> = ref(null);

const searchedForCrashes = ref(false);

const showTroubleshooting = () =>
  logErrorsFrom(() => browser.tabs.create({url: TROUBLESHOOTING_URL}));

const searchGitHub = () => {
  // Some heuristics to widen the search (and hopefully return better results)
  // by excluding things that look like unique identifiers.
  const terms = errorLog[0].summary
    .replace(/[0-9]+/g, "")
    .replace(/:\s+\S+$/, "")
    .replace(/\S+:\S+/g, "")
    .replace(/\S+\.\S+/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/\S+\@\S+/g, "");
  const url = `https://github.com/josh-berry/tab-stash/issues?q=is%3Aissue+${encodeURIComponent(
    terms,
  )}`;
  searchedForCrashes.value = true;
  logErrorsFrom(() => browser.tabs.create({url}));
};

const reportCrash = () => {
  const el = <HTMLElement>err_log_el.value;
  const crashText = el.innerText;
  const summary = errorLog[0].summary;
  logErrorsFrom(() =>
    browser.tabs.create({
      url: `https://github.com/josh-berry/tab-stash/issues/new?assignees=&labels=&projects=&template=1-crash-report.yml&crash-details=${encodeURIComponent(
        crashText,
      )}&title=${encodeURIComponent(`[Crash] ${summary}`)}`,
    }),
  );
};

const hideCrashReports = (ms: number) =>
  logErrorsFrom(async () => {
    await model.options.local.set({hide_crash_reports_until: Date.now() + ms});
    clearErrorLog();
  });
</script>

<style module>
.msg {
  margin-bottom: 1em;
}

.details > *:not(summary) {
  margin-left: var(--ctrl-mw);
}

.details > summary {
  border-radius: var(--ctrl-border-radius);
}

.details > summary:hover {
  background-color: var(--userlink-hover-fg);
}

.details > summary:active {
  background-color: var(--userlink-active-fg);
}

.err_details_list {
  user-select: text;
  -moz-user-select: text;
}

.error_log {
  user-select: text;
  -moz-user-select: text;
  cursor: text;
  margin: 0;
}

.environment {
  font-style: italic;
}
.err_summary {
  font-weight: bold;
  white-space: pre-wrap;
}
.err_details {
  padding-left: var(--ctrl-pw);
  border-left: 2px solid var(--ctrl-border-clr);
  white-space: pre-wrap;
}
</style>
