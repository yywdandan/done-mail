<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { PublicMailDetail } from '../api/public';
import { formatBytes, formatFullTime, hasRemoteImages, mailBodyText, mailHtmlSrcdoc } from '../utils/mail-view';
import McIcon from './McIcon.vue';

const props = defineProps<{
  mail: PublicMailDetail | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  download: [item: PublicMailDetail['attachments'][number]];
}>();

const allowRemoteImages = ref(false);
let frameDocument: Document | null = null;
const remoteImagesHidden = computed(() => {
  const htmlBody = props.mail?.htmlBody || '';
  return Boolean(htmlBody) && hasRemoteImages(htmlBody) && !allowRemoteImages.value;
});
const sender = computed(() => {
  const mail = props.mail;
  if (!mail) return '-';
  return mail.fromName ? `${mail.fromName} <${mail.fromAddr}>` : mail.fromAddr || '-';
});

function bindFramePointerDown(event: Event) {
  if (frameDocument) frameDocument = null;
  frameDocument = (event.target as HTMLIFrameElement | null)?.contentDocument || null;
}

watch(() => props.mail?.id, () => {
  allowRemoteImages.value = false;
});

onBeforeUnmount(() => {
  frameDocument = null;
});
</script>

<template>
  <article v-if="mail" class="mc-public-mail-detail" :class="{ 'mc-loading-surface': loading }" :aria-busy="loading ? 'true' : 'false'">
    <div v-if="loading" class="mc-loading-overlay" aria-hidden="true">
      <span class="mc-button-spinner"></span>
    </div>
    <header class="mc-public-mail-head">
      <div class="mc-public-mail-meta">
        <h1>{{ mail.subject || '无主题' }}</h1>
        <span class="mc-public-mail-side">
          <span>{{ sender }}</span>
          <time>{{ formatFullTime(mail.receivedAt) }}</time>
        </span>
      </div>
    </header>

    <div v-if="remoteImagesHidden" class="mc-remote-images-note mc-public-mail-remote">
      <McIcon name="globe" :size="14" />
      <span>已隐藏远程图片</span>
      <button type="button" @click="allowRemoteImages = true">显示图片</button>
    </div>

    <section class="mc-body-box mc-public-mail-body">
      <iframe
        v-if="mail.htmlBody"
        class="mail-frame"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        referrerpolicy="no-referrer"
        title="邮件正文"
        :srcdoc="mailHtmlSrcdoc({ htmlBody: mail.htmlBody, allowRemoteImages })"
        @load="bindFramePointerDown"
      ></iframe>
      <pre v-else>{{ mailBodyText({ textBody: mail.textBody, htmlBody: mail.htmlBody }) }}</pre>
    </section>

    <div v-if="mail.attachments.length" class="mc-attach-list mc-public-mail-attachments">
      <button v-for="item in mail.attachments" :key="item.id" type="button" class="mc-attach mc-attach-button" :disabled="!item.stored" @click="emit('download', item)">
        <div class="mc-pdf"><McIcon name="file" :size="22" /></div>
        <div>
          <p>{{ item.filename || '未命名附件' }}</p>
          <span>{{ formatBytes(item.size) }} · {{ item.stored ? '可下载' : '仅保存信息' }}</span>
        </div>
      </button>
    </div>
  </article>
</template>
