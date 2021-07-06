<template>
    <Dialog :class="{[$style.dlg]: true, 'export-dialog': true}"
            @close="$emit('close')">
        <form :id="$style.dlg" @submit.prevent.stop="">
            <label :for="$style.format" :class="$style.format">Format:</label>
            <select :id="$style.format" v-model="format">
                <option value="html-noicons">Clickable Links</option>
                <option value="html-icons">Clickable Links with Icons</option>
                <option value="urls-folders">List of URLs</option>
                <option value="urls-nofolders">List of URLs (no stash names)</option>
                <option value="markdown">Markdown</option>
                <option value="onetab">OneTab</option>
            </select>
            <nav>
                <button @click.prevent.stop="select_all">Select All</button>
                <button class="clickme" @click.prevent.stop="copy">Copy</button>
            </nav>
            <label :class="$style.help">
                <a href="https://github.com/josh-berry/tab-stash/wiki/Exporting-Tabs-from-Tab-Stash" target="_blank">About Formats...</a>
            </label>
        </form>

        <!-- HTML format -->
        <output v-if="format.startsWith('html-')" ref="output"
                :for="$style.dlg">
            <div v-for="f of folders" :key="f.id">
                <h3>{{friendlyFolderName(f.title)}}</h3>
                <ul>
                    <li v-for="bm of leaves(f)" :key="bm.id">
                        <img v-if="format.endsWith('-icons')"
                             :src="bm.favicon && bm.favicon.value"
                             :srcset="bm.favicon && bm.favicon.value && `${bm.favicon.value} 2x`"
                             referrerpolicy="no-referrer" alt="" class="icon">
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
                <div v-for="bm of leaves(f)" :key="bm.id">- [{{quote_link_md(bm.title)}}](<a :href="bm.url">{{quote_url_md(bm.url)}}</a>)</div>
                <div><br/></div>
            </div>
        </output>

        <!-- OneTab format -->
        <output v-if="format == 'onetab'" ref="output" :for="$style.dlg"
                :class="$style.plaintext">
            <div v-for="f of folders" :key="f.id">
                <div v-for="bm of leaves(f)" :key="bm.id"><a :href="bm.url">{{bm.url}}</a> | {{bm.title}}</div>
                <div><br/></div>
            </div>
        </output>

        <!-- List of URLs -->
        <output v-if="format.startsWith('urls-')" ref="output" :for="$style.dlg"
                :class="$style.plaintext">
            <div v-for="f of folders" :key="f.id">
                <div v-if="format.endsWith('-folders')">## {{friendlyFolderName(f.title)}}</div>
                <div v-for="bm of leaves(f)" :key="bm.id"><a :href="bm.url">{{bm.url}}</a></div>
                <div><br/></div>
            </div>
        </output>
    </Dialog>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {required} from '../util';
import {Bookmark} from '../model/bookmarks';
import {friendlyFolderName} from '../stash';

const MD_LINK_QUOTABLES_RE = /\\|\[\]|\!\[/g;
const MD_URL_QUOTABLES_RE = /\\|\)/g;

export default defineComponent({
    components: {
        Dialog: require('../components/dialog.vue').default,
    },
    props: {
        stash: required(Array as PropType<Bookmark[]>),
    },
    computed: {
        folders(): Bookmark[] {
            return this.stash.filter((t: any) => t && t.children) as Bookmark[];
        },
    },
    data: () => ({
        format: 'urls-folders',
    }),
    mounted(this: any) { this.$nextTick(() => this.select_all()); },
    watch: {
        format(this: any, val: string) { this.select_all(); },
    },
    methods: {
        friendlyFolderName,
        leaves: function(folder: Bookmark) {
            return (folder.children ?? []).filter(bm => bm && bm.url);
        },

        quote_emphasis_md(text: string): string {
            return text
                .replace(/(^|\s)([*_]+)(\S)/g, (str, ws, emph, rest) =>
                    `${ws}${emph.replace(/./g, '\\$&')}${rest}`)
                .replace(/(\S)([*_]+)(\s|$)/g, (str, rest, emph, ws) =>
                    `${rest}${emph.replace(/./g, '\\$&')}${ws}`);
        },
        quote_link_md(text: string): string {
            return (<any>this).quote_emphasis_md(
                text.replace(MD_LINK_QUOTABLES_RE, x => `\\${x}`));
        },
        quote_url_md(url: string): string {
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
.dlg > * {
    overflow: hidden;
    grid-template-columns: 1fr;
    grid-template-rows: 0fr 1fr;
    width: 60rem;
    min-height: 15rem;
    height: 67%;
}

.dlg > * > form {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
}

.dlg > * > form > nav {
    display: flex;
    flex-direction: row;
    row-gap: inherit;
    column-gap: inherit;
}
.dlg > * > form > select, .dlg > * > form > nav { min-width: max-content; }
.dlg > * > form > .help { flex-grow: 1; text-align: right; }

@media all and (max-width: 20rem) {
    .dlg > * > form > label.format { display: none; }
}

.dlg > * > output {
    display: block;
    overflow-y: auto;
    overflow-wrap: anywhere;
    user-select: text;
    -moz-user-select: text;
    cursor: auto;
    padding: 4px;
}

.plaintext {
    font-family: monospace;
}
</style>
