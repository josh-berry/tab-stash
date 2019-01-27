<template>
  <div>
    <div>
      <div>When saving tabs to the stash:</div>
      <ul>
        <li>
          <input type="radio" name="open_stash_in" id="open_stash_in_sidebar"
                 v-model="open_stash_in" value="sidebar" />
          <label for="open_stash_in_sidebar">Automatically show your stashed tabs in the sidebar</label>
        </li>
        <li>
          <input type="radio" name="open_stash_in" id="open_stash_in_tab"
                 v-model="open_stash_in" value="tab" />
          <label for="open_stash_in_tab">Automatically show your stashed tabs in a new tab</label>
        </li>
        <li>
          <input type="radio" name="open_stash_in" id="open_stash_in_none"
                 v-model="open_stash_in" value="none" />
          <label for="open_stash_in_none">Don't automatically show the stash</label>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
function syncprop(name) {
    return {
        get: function() { return this.sync[name]; },
        set: function(v) { this.sync.set({[name]: v}); },
    };
}

function localprop(name) {
    return {
        get: function() { return this.sync[name]; },
        set: function(v) { this.sync.set({[name]: v}); },
    };
}

export default {
    computed: {
        open_stash_in: syncprop('open_stash_in'),
    },
}
</script>

<style>
</style>
