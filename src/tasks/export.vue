<template>
    <Dialog :class="{[$style.dlg]: true, 'export-dialog': true}"
            @close="$emit('close')">
        <form :id="$style.dlg" @submit.prevent.stop="">
            <label for="format">Format:</label>
            <select :id="$style.format" v-model="format">
                <option value="html">Formatted List</option>
                <option value="markdown">Markdown</option>
                <option value="onetab">OneTab</option>
                <option value="urls">List of URLs</option>
                <option value="urls-nofolders">List of URLs (no stash names)</option>
            </select>
            <button @click.prevent.stop="select_all">Select All</button>
            <button @click.prevent.stop="copy">Copy</button>
        </form>

        <!-- HTML format -->
        <output v-if="format == 'html'" ref="output" :for="$style.dlg">
            <div v-for="f of folders" :key="f.id">
                <h3>{{friendlyFolderName(f.title)}}</h3>
                <ul>
                    <li v-for="bm of leaves(f)" :key="bm.id">
                        <a :href="bm.url">{{bm.title}}</a>
                    </li>
                </ul>
            </div>
        </output>

        <!-- Markdown format -->
        <output v-if="format == 'markdown'" ref="output" :for="$style.dlg"
                :class="$style.plaintext">
            <div v-for="f of folders" :key="f.id">
                <div>## {{friendlyFolderName(f.title)}}</div>
                <div v-for="bm of leaves(f)" :key="bm.id">- [{{quote_md(bm.title)}}]({{quote_url_md(bm.url)}})</div>
                <div><br/></div>
            </div>
        </output>

        <!-- OneTab format -->
        <output v-if="format == 'onetab'" ref="output" :for="$style.dlg"
                :class="$style.plaintext">
            <div v-for="f of folders" :key="f.id">
                <div v-for="bm of leaves(f)" :key="bm.id">{{bm.url}} | {{bm.title}}</div>
                <div><br/></div>
            </div>
        </output>

        <!-- List of URLs -->
        <output v-if="format == 'urls'" ref="output" :for="$style.dlg"
                :class="$style.plaintext">
            <div v-for="f of folders" :key="f.id">
                <div>## {{friendlyFolderName(f.title)}}</div>
                <div v-for="bm of leaves(f)" :key="bm.id">{{bm.url}}</div>
                <div><br/></div>
            </div>
        </output>

        <!-- List of URLs (no folder names) -->
        <output v-if="format == 'urls-nofolders'" ref="output" :for="$style.dlg"
                :class="$style.plaintext">
            <div v-for="f of folders" :key="f.id">
                <div v-for="bm of leaves(f)" :key="bm.id">{{bm.url}}</div>
                <div><br/></div>
            </div>
        </output>
    </Dialog>
</template>

<script lang="ts">
import Vue from 'vue';

import {Bookmark} from '../model';
import {friendlyFolderName} from '../stash';

const MD_QUOTABLES_RE = /^[-+*#]|\\|[*_|`]|\]\(|\!\[/g;
const MD_URL_QUOTABLES_RE = /\\|\)/g;

export default Vue.extend({
    components: {
        Dialog: require('../components/dialog.vue').default,
    },
    props: {
        stash: Array,
    },
    computed: {
        folders: function() {
            return this.stash.filter((t: any) => t && t.children);
        },
        exported: function() {}
    },
    data: () => ({
        format: 'html',
    }),
    methods: {
        friendlyFolderName,
        leaves: function(folder: Bookmark) {
            return (folder.children ?? []).filter(bm => bm && bm.url);
        },

        quote_md: function(text: string): string {
            return text.replace(MD_QUOTABLES_RE, x => `\\${x}`);
        },
        quote_url_md: function(url: string): string {
            return url.replace(MD_URL_QUOTABLES_RE, x => `\\${x}`);
        },

        copy() { document.execCommand('copy'); },
        select_all() {
            (<HTMLElement>this.$refs.output).focus();
            this.$nextTick(() => window.getSelection()!
                .selectAllChildren(<Element>this.$refs.output));
        }
    },
});
</script>

<style module>
.dlg > :global(.dialog) {
    overflow: hidden;
    grid-template-columns: 1fr;
    grid-template-rows: 0fr 1fr;
    width: 60rem;
    min-height: 15rem;
    height: 67%;
}

.dlg output {
    display: block;
    overflow: auto;
    user-select: text;
    -moz-user-select: text;
    cursor: auto;
}

.plaintext {
    font-family: monospace;
}
</style>
