<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { loadSharedMail, publicErrorMessage, type PublicMailDetail as PublicMailDetailData } from '../api/public';
import McIcon from '../components/McIcon.vue';
import PublicMailDetail from '../components/PublicMailDetail.vue';
import PublicShareShell from '../components/PublicShareShell.vue';

const route = useRoute();
const token = computed(() => String(route.params.token || ''));
const loading = ref(false);
const mail = ref<PublicMailDetailData | null>(null);
const errorMessage = ref('');
let loadRunId = 0;

async function loadMail() {
  if (!token.value) return;
  const runId = ++loadRunId;
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await loadSharedMail(token.value);
    if (runId !== loadRunId) return;
    mail.value = data;
  } catch (error) {
    if (runId === loadRunId) {
      mail.value = null;
      errorMessage.value = publicErrorMessage(error, '共享邮件不存在或已过期');
    }
  } finally {
    if (runId === loadRunId) loading.value = false;
  }
}

function downloadAttachment(item: { id: string; stored: boolean }) {
  if (!item.stored || !token.value) return;
  window.open(`/mail/${token.value}/attachments/${item.id}`, '_blank', 'noopener,noreferrer');
}

watch(token, () => {
  mail.value = null;
  errorMessage.value = '';
  void loadMail();
});

onMounted(() => void loadMail());
</script>

<template>
  <PublicShareShell :loading="loading && !mail">
    <PublicMailDetail v-if="mail" :mail="mail" :loading="loading" @download="downloadAttachment" />
    <div v-else-if="errorMessage" class="mc-empty-state mc-empty-state--public">
      <div class="mc-empty-icon"><McIcon name="mail" :size="26" /></div>
      <h2>{{ errorMessage }}</h2>
    </div>
  </PublicShareShell>
</template>
