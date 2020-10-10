<template>
<div>
    <a class="folder-item action-container">
        <ItemIcon class="icon-folder" />
        <span class="text">{{item.title}}</span>
        <ButtonBox v-if="id" class="action-container">
            <button class="action stash" title="Restore"></button>
            <button class="action remove" title="Delete Permanently"></button>
        </ButtonBox>
    </a>
    <ul class="folder-item-nesting">
        <Bookmark v-for="child of item.children" :key="child.url"
                  :item="child" class="folder-item">
            <span class="indent indent-spacer"></span>
        </Bookmark>
    </ul>
</div>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';
import {DeletedFolder} from '../model/deleted-items';

export default Vue.extend({
    components: {
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,

        Bookmark: require('./bookmark.vue').default,
    },

    props: {
        id: String,
        item: Object as PropType<DeletedFolder>,
    },
});
</script>
