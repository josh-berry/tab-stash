<template>
    <div v-if="node.children" class="outline">
        <h3 :class="{[$style.folder_title]: true, 'folder-name': true}"
            :title="title">{{friendlyFolderName(node.title)}}</h3>
        <ul>
            <li v-for="child of node.children" :key="child.id">
                <Self :node="child"/>
            </li>
        </ul>
    </div>
    <a v-else target="_blank" :href="node.url" :title="title">
        <span></span>
        <span>{{node.title}}</span>
    </a>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';

import {DeletedBookmarkNode} from '../log';
import {friendlyFolderName} from '../stash';

const Self = Vue.extend({
    name: 'Self',
    inject: ['$model'],
    props: {
        node: Object as PropType<DeletedBookmarkNode>,
        timestamp: Date,
    },
    computed: {
        title() { return this.node.title
                       + (this.timestamp ? `\nDeleted ${this.timestamp}` : ''); }
    },
    methods: {
        friendlyFolderName,
    },
});

export default Self;
</script>

<style module>
h3.folder_title {
    display: inline-block;
    margin: 0;
}
</style>
