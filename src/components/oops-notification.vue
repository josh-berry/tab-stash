<template>
<Notification inactive @dismiss="clearErrorLog">
    <div>Oops!  Something went wrong.  Tab Stash will try to recover
    automatically, but if this keeps happening, here are some options that might
    help:</div>

    <p>
        <button @click.stop="showTroubleshooting">Show Troubleshooting Guide</button>
        <button @click.stop="searchGitHub">Search for Known Issues</button>
        <button @click.stop="copyErrorLog">Copy Crash Details</button>
    </p>

    <details :class="$style.details" ref="err_details_el" @click.stop="">
        <summary>Show Crash Details</summary>
        <output ref="err_log_el" :class="$style.err_details_list">
            <p :class="$style.environment">
                <div>Browser: {{aboutBrowser}} ({{aboutPlatform}})</div>
                <div>Extension: {{aboutExtension}}</div>
            </p>
            <p v-for="err of errorLog">
                <div :class="$style.err_summary">{{err.summary}}</div>
                <div :class="$style.err_details">{{err.details}}</div>
            </p>
        </output>
    </details>
    <details :class="$style.details" @click.stop="">
        <summary>Hide Crash Reports</summary>

        <p>If you're seeing too many crash reports and don't want to be
        disturbed, you can temporarily hide them:</p>

        <p>
            <button @click.stop="hideCrashReports(5*60*1000)">for 5 minutes</button>
            <button @click.stop="hideCrashReports(60*60*1000)">for 1 hour</button>
            <button @click.stop="hideCrashReports(24*60*60*1000)">for 1 day</button>
            <button @click.stop="hideCrashReports(7*24*60*60*1000)">for 1 week</button>
        </p>

        <p>Crash reports can be turned back on again in settings.</p>
    </details>
</Notification>
</template>

<script lang="ts">
import browser from 'webextension-polyfill';
import {Ref, ref, inject} from 'vue';

const TROUBLESHOOTING_URL = "https://josh-berry.github.io/tab-stash/support.html";

const aboutBrowser = ref('<Unknown Browser>');
if (browser.runtime.getBrowserInfo) {
    browser.runtime.getBrowserInfo().then(info => {
        aboutBrowser.value = `${info.vendor} ${info.name} ${info.version} ${info.buildID}`;
    });
}

const aboutPlatform = ref('<Unknown Platform>');
if (browser.runtime.getPlatformInfo) {
    browser.runtime.getPlatformInfo().then(info => {
        aboutPlatform.value = `${info.os} ${info.arch}`;
    });
}

const aboutExtension = ref('<Unknown Extension>');
if (browser.management.getSelf) {
    browser.management.getSelf().then(info => {
        aboutExtension.value = `${info.name} ${info.version} (${info.installType})`;
    });
}
</script>

<script setup lang="ts">
import {errorLog, clearErrorLog, logErrorsFrom} from '../util/oops';
import {Model} from '../model';
const Notification = require('./notification.vue').default;

const model = inject<Model>('$model')!;

const err_log_el: Ref<object | null> = ref(null);
const err_details_el: Ref<object | null> = ref(null);

const showTroubleshooting = () =>
    logErrorsFrom(() => browser.tabs.create({url: TROUBLESHOOTING_URL}));

const searchGitHub = () => {
    const url = `https://github.com/josh-berry/tab-stash/issues?q=is%3Aissue+${
        encodeURIComponent(errorLog[0].summary)}`;
    logErrorsFrom(() => browser.tabs.create({url}));
};

const copyErrorLog = async () => {
    const details_el = <HTMLDetailsElement>err_details_el.value;
    details_el.open = true;

    const el = <HTMLElement>err_log_el.value;

    el.focus();
    window.getSelection()!.selectAllChildren(el);
    document.execCommand('copy');
};

const hideCrashReports = (ms: number) => logErrorsFrom(async () => {
    await model.options.local.set({hide_crash_reports_until: Date.now() + ms});
    clearErrorLog();
});
</script>

<style module>
.details > *:not(summary) {
    margin-left: var(--ctrl-mw);
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

.environment { font-style: italic; }
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
