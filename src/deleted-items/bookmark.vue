<template>
    <a :href="item.url" target="_blank" class="folder-item action-container">
        <ItemIcon v-if="item.favIconUrl" :src="item.favIconUrl" />
        <span class="text">{{item.title}}</span>
        <ButtonBox v-if="id">
            <button class="action stash one" title="Restore"></button>
            <button class="action remove" title="Delete Permanently"></button>
        </ButtonBox>
        <slot></slot>
    </a>
</template>

<script lang="ts">
import Vue, {PropType} from 'vue';
import {DeletedBookmark} from '../model/deleted-items';

export default Vue.extend({
    components: {
        ButtonBox: require('../components/button-box.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,
    },
    props: {
        id: String,
        item: Object as PropType<DeletedBookmark>,
    },
});
</script>
