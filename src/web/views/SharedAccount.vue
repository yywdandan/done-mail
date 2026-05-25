<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { loadSharedAccountMailDetail, loadSharedAccountPage, publicErrorMessage, type PublicMailDetail, type PublicMailRow } from '../api/public';
import MailDetailDrawer, { type MailMetaRow } from '../components/MailDetailDrawer.vue';
import McIcon from '../components/McIcon.vue';
import PublicShareShell from '../components/PublicShareShell.vue';
import { useCursorList } from '../composables/cursorList';
import { formatFullTime, formatTime } from '../utils/mail-view';

const route = useRoute();
const token = computed(() => String(route.params.token || ''));
const loading = ref(false);
const refreshing = ref(false);
const listLoaded = ref(false);
const detailLoading = ref(false);
const errorMessage = ref('');
const account = ref<{ mailbox: string } | null>(null);
const selectedMail = ref<PublicMailDetail | null>(null);
const pendingMail = ref<PublicMailRow | null>(null);
const mailList = useCursorList<PublicMailRow>();
const {
  rows,
  hasMore,
  currentPage,
  hasRows,
  recordRowPointer
} = mailList;
const query = reactive({
  perPage: 20,
  keyword: ''
});
let detailLoadRunId = 0;
let refreshRunId = 0;
let listLoadRunId = 0;
let accountActive = false;

const detailDrawerOpen = computed(() => Boolean(selectedMail.value || pendingMail.value));
const activeMail = computed(() => selectedMail.value || pendingMail.value);
const selectedMetaRows = computed<MailMetaRow[]>(() => {
  const mail = activeMail.value;
  if (!mail) return [];
  return [
    { label: '发件人', value: senderLabel(mail) },
    { label: '收件人', value: mail.toAddr },
    { label: '收件时间', value: formatFullTime(mail.receivedAt) },
    { label: '附件', value: `${selectedMail.value?.attachments.length ?? mail.attachmentCount} 个` }
  ];
});

function downloadAttachment(item: { id: string; stored: boolean }) {
  if (!selectedMail.value || !item.stored || !token.value) return;
  window.open(`/api/shared/accounts/${token.value}/mails/${selectedMail.value.id}/attachments/${item.id}`, '_blank', 'noopener,noreferrer');
}

async function loadMails(cursor = mailList.currentCursor(), runId = listLoadRunId) {
  if (!token.value) return;
  try {
    const data = await loadSharedAccountPage(token.value, {
      per_page: query.perPage,
      cursor,
      keyword: query.keyword.trim() || undefined
    });
    if (!data || runId !== listLoadRunId) return;
    errorMessage.value = '';
    account.value = data.account;
    mailList.setPageData(data.items, data.info);
    listLoaded.value = true;
  } catch (error) {
    if (runId === listLoadRunId) {
      account.value = null;
      errorMessage.value = publicErrorMessage(error, '共享账户不存在或已过期');
      mailList.setPageData([], {});
      listLoaded.value = true;
    }
  }
}

async function refreshSharedAccount() {
  if (!token.value || refreshing.value) return;
  const runId = ++refreshRunId;
  const listRunId = ++listLoadRunId;
  refreshing.value = true;
  loading.value = true;
  errorMessage.value = '';
  mailList.resetCursorState();
  closeDetailDrawer();
  try {
    await loadMails('', listRunId);
  } finally {
    if (runId === refreshRunId) {
      refreshing.value = false;
      loading.value = false;
    }
  }
}

async function loadMailDetail(id: string) {
  if (!token.value) return;
  if (selectedMail.value?.id === id) return;
  if (pendingMail.value?.id === id && detailLoading.value) return;
  pendingMail.value = rows.value.find((row) => row.id === id) || null;
  selectedMail.value = null;
  const runId = ++detailLoadRunId;
  detailLoading.value = true;
  try {
    const data = await loadSharedAccountMailDetail(token.value, id);
    if (runId !== detailLoadRunId) return;
    errorMessage.value = '';
    selectedMail.value = data;
  } catch (error) {
    if (runId === detailLoadRunId) {
      pendingMail.value = null;
      errorMessage.value = publicErrorMessage(error, '邮件不存在');
    }
  } finally {
    if (runId === detailLoadRunId) detailLoading.value = false;
  }
}

function closeDetailDrawer() {
  detailLoadRunId += 1;
  selectedMail.value = null;
  pendingMail.value = null;
  detailLoading.value = false;
}

function senderLabel(row: PublicMailRow) {
  return row.fromName ? `${row.fromName} <${row.fromAddr}>` : row.fromAddr || '-';
}

function openMailFromRow(id: string, event: MouseEvent) {
  if (!mailList.shouldOpenRow(event)) return;
  void loadMailDetail(id);
}

function prevPage() {
  const cursor = mailList.previousPageCursor();
  if (cursor === null) return;
  void loadMails(cursor, ++listLoadRunId);
}

function nextPage() {
  const cursor = mailList.nextPageCursor();
  if (cursor === null) return;
  void loadMails(cursor, ++listLoadRunId);
}

function applySearch() {
  mailList.resetCursorState();
  closeDetailDrawer();
  void loadMails('', ++listLoadRunId);
}

watch(
  token,
  () => {
    account.value = null;
    refreshRunId += 1;
    listLoadRunId += 1;
    refreshing.value = false;
    loading.value = false;
    errorMessage.value = '';
    listLoaded.value = false;
    mailList.resetCursorState();
    closeDetailDrawer();
    if (accountActive) void refreshSharedAccount();
  }
);

async function activateSharedAccount() {
  if (!token.value) return;
  accountActive = true;
  await refreshSharedAccount();
}

onMounted(() => void activateSharedAccount());

onBeforeUnmount(() => {
  accountActive = false;
});
</script>

<template>
  <PublicShareShell :loading="loading && !account">
    <template #head>
      <div class="mc-public-share-title">
        <h1>{{ account?.mailbox || '共享账户' }}</h1>
      </div>
      <div class="mc-public-share-actions">
        <button class="mc-square" :class="{ disabled: loading || refreshing }" type="button" :disabled="loading || refreshing" aria-label="刷新" title="刷新" @click="refreshSharedAccount">
          <McIcon name="refresh" :size="18" />
        </button>
      </div>
    </template>

    <section class="mc-workspace mc-public-share-workspace" :class="{ 'mc-workspace--drawer-open': detailDrawerOpen }">
      <div class="mc-list-pane">
        <div class="mc-toolbar mc-share-toolbar">
          <label class="mc-search mc-search--table">
            <McIcon name="search" :size="18" />
            <input v-model.trim="query.keyword" type="search" placeholder="搜索发件人、收件人、主题或内容" @keyup.enter="applySearch" />
          </label>
          <div class="mc-tools-right mc-public-share-tools">
            <button class="mc-action-primary mc-action-compact" type="button" @click="applySearch">
              <McIcon name="search" :size="15" />筛选
            </button>
            <button class="mc-square" :class="{ disabled: currentPage <= 1 }" type="button" :disabled="currentPage <= 1" aria-label="上一页" @click="prevPage">
              <McIcon name="left" :size="19" />
            </button>
            <button class="mc-square" :class="{ disabled: !hasMore }" type="button" :disabled="!hasMore" aria-label="下一页" @click="nextPage">
              <McIcon name="right" :size="19" />
            </button>
          </div>
        </div>

        <div class="mc-table" :class="{ 'mc-table--empty': !hasRows }">
          <div class="mc-mail-list-tools mc-share-mail-list-tools">
            <div class="mc-mail-list-tools-left">
              <span class="mc-sender">发件人</span>
              <span class="mc-subject">邮件标题</span>
              <span class="mc-time">时间</span>
            </div>
          </div>

          <div class="mc-table-body">
            <div
              v-for="row in rows"
              :key="row.id"
              class="mc-mail-row mc-mail-row--share-account"
              :class="{ selected: activeMail?.id === row.id }"
              role="button"
              tabindex="0"
              @pointerdown="recordRowPointer"
              @click="openMailFromRow(row.id, $event)"
              @keydown.enter="loadMailDetail(row.id)"
            >
              <div class="mc-cell mc-sender">{{ senderLabel(row) }}</div>
              <div class="mc-cell mc-subject" :class="{ strong: row.id === activeMail?.id }" :title="row.bodyPreview ? `${row.subject || '无主题'} - ${row.bodyPreview}` : row.subject || '无主题'">
                <span class="mc-subject-combined">
                  <span class="mc-subject-text">{{ row.subject || '无主题' }}</span>
                  <span v-if="row.bodyPreview" class="mc-body-preview"> - {{ row.bodyPreview }}</span>
                </span>
              </div>
              <div class="mc-cell mc-time" :class="{ strong: row.id === activeMail?.id }">{{ formatTime(row.receivedAt) }}</div>
            </div>

            <div v-if="errorMessage" class="mc-empty-state mc-empty-state--table">
              <div class="mc-empty-icon"><McIcon name="mail" :size="26" /></div>
              <h2>{{ errorMessage }}</h2>
            </div>
            <div v-else-if="listLoaded && rows.length === 0" class="mc-empty-state mc-empty-state--table">
              <div class="mc-empty-icon"><McIcon name="mail" :size="26" /></div>
              <h2>等待第一封邮件</h2>
            </div>
          </div>
        </div>
      </div>

      <MailDetailDrawer
        v-if="detailDrawerOpen"
        :loading="detailLoading"
        :title="activeMail?.subject || ''"
        :summary-time="activeMail ? formatFullTime(activeMail.receivedAt) : ''"
        :summary-recipient="activeMail?.toAddr || '-'"
        :text-body="selectedMail?.textBody || ''"
        :html-body="selectedMail?.htmlBody || ''"
        :attachments="selectedMail?.attachments || []"
        :meta-rows="selectedMetaRows"
        @close="closeDetailDrawer"
        @download="downloadAttachment"
      >
      </MailDetailDrawer>
    </section>
  </PublicShareShell>
</template>
