<script setup lang="ts">
import McIcon from './McIcon.vue';

withDefaults(
  defineProps<{
    disabled?: boolean;
    copyDisabled?: boolean;
  }>(),
  {
    disabled: false,
    copyDisabled: false
  }
);

const emit = defineEmits<{
  copy: [];
  edit: [];
  delete: [];
}>();
</script>

<template>
  <div class="mc-share-row-actions">
    <button type="button" class="mc-icon-action" :disabled="disabled || copyDisabled" aria-label="复制共享链接" title="复制" @click="emit('copy')">
      <McIcon name="copy" :size="16" />
    </button>
    <button type="button" class="mc-icon-action" :disabled="disabled" aria-label="编辑共享" title="编辑" @click="emit('edit')">
      <McIcon name="edit" :size="16" />
    </button>
    <button type="button" class="mc-icon-action mc-icon-action--danger" :disabled="disabled" aria-label="删除共享" title="删除" @click="emit('delete')">
      <McIcon name="trash" :size="16" />
    </button>
  </div>
</template>
