<script setup lang="ts">
import { computed, useSlots } from 'vue';

const props = defineProps<{
  title?: string;
  loading?: boolean;
}>();

const slots = useSlots();
const hasHead = computed(() => Boolean(slots.head || props.title || slots.actions));
</script>

<template>
  <main class="mc-public-share-shell">
    <a class="mc-public-share-brand" href="https://github.com/lchily/done-mail" target="_blank" rel="noopener noreferrer">
      <img src="/static/logo-mark.svg" alt="DoneMail" />
      <span>DoneMail</span>
    </a>

    <section class="mc-public-share-card" :class="{ 'mc-loading-surface': loading }" :aria-busy="loading ? 'true' : 'false'">
      <div v-if="loading" class="mc-loading-overlay" aria-hidden="true">
        <span class="mc-button-spinner"></span>
      </div>
      <div v-if="hasHead" class="mc-public-share-head">
        <slot name="head">
          <div class="mc-public-share-title">
            <h1>{{ title }}</h1>
          </div>
          <div v-if="$slots.actions" class="mc-public-share-actions">
            <slot name="actions"></slot>
          </div>
        </slot>
      </div>

      <slot></slot>
    </section>
  </main>
</template>
