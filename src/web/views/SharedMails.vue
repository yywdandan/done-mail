<script setup lang="ts">
import { computed, onActivated, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus/es/components/message/index.mjs';
import { apiErrorMessage } from '../api/client';
import { type ShareRecord } from '../api/endpoints';
import McIcon from '../components/McIcon.vue';
import ShareExpiryDialog from '../components/ShareExpiryDialog.vue';
import ShareRowActions from '../components/ShareRowActions.vue';
import { confirmDialog } from '../composables/confirmDialog';
import { useCursorList } from '../composables/cursorList';
import { useFooterMetrics } from '../composables/footerStatus';
import { usePageRefresh } from '../composables/pageRefresh';
import { deleteShare, loadSharesPage, regenerateShare, shareListParams, updateShare } from '../queries/shares';
import { formatFullTime } from '../utils/mail-view';

const list = useCursorList<ShareRecord>();
const { rows, hasMore, currentPage } = list;
const query = reactive({
  type: 'mail',
  keyword: ''
});
const listParams = computed(() => shareListParams(query, list.currentCursor()));
const loaded = ref(false);
const saving = ref(false);
const editDialogOpen = ref(false);
const editingShare = ref<ShareRecord | null>(null);

useFooterMetrics(() => [
  { label: '本页', value: rows.value.length, unit: '条' },
  { label: '第', value: currentPage.value, unit: '页' }
]);

async function loadShares(cursor = list.currentCursor(), force = false) {
  const data = await loadSharesPage({ ...listParams.value, cursor }, force);
  if (!data) return;
  list.setPageData(data.items, data.info);
  loaded.value = true;
}

async function copyShare(url: string) {
  if (!url) {
    ElMessage.error('无法生成共享链接');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    ElMessage.success('共享链接已复制');
  } catch {
    ElMessage.error('复制失败');
  }
}

function openEdit(row: ShareRecord) {
  editingShare.value = row;
  editDialogOpen.value = true;
}

function closeEdit() {
  editingShare.value = null;
}

async function regenerateCurrent(id = editingShare.value?.id || '') {
  if (!id) return;
  if (saving.value) return;
  saving.value = true;
  try {
    await regenerateShare(id);
    await loadShares(list.currentCursor(), true);
    ElMessage.success('共享链接已重置');
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '重置共享链接失败'));
  } finally {
    saving.value = false;
  }
}

async function updateExpiry(ttl: number | null) {
  const id = editingShare.value?.id || '';
  if (!id) return;
  if (saving.value) return;
  saving.value = true;
  try {
    await updateShare(id, { ttlHours: ttl });
    await loadShares(list.currentCursor(), true);
    editDialogOpen.value = false;
    editingShare.value = null;
    ElMessage.success('有效期已更新');
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '更新有效期失败'));
  } finally {
    saving.value = false;
  }
}

async function deleteCurrent(id: string) {
  if (saving.value) return;
  const confirmed = await confirmDialog({
    title: '删除共享邮件',
    message: '确认删除这个共享链接？',
    confirmText: '删除',
    intent: 'danger'
  });
  if (!confirmed) return;
  saving.value = true;
  try {
    await deleteShare(id);
    await loadShares(list.currentCursor(), true);
    ElMessage.success('已删除');
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '删除失败'));
  } finally {
    saving.value = false;
  }
}

function prevPage() {
  const cursor = list.previousPageCursor();
  if (cursor === null) return;
  void loadShares(cursor);
}

function nextPage() {
  const cursor = list.nextPageCursor();
  if (cursor === null) return;
  void loadShares(cursor);
}

function applySearch() {
  list.resetCursorState();
  void loadShares('');
}

function openShare(url: string) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

onActivated(() => {
  void loadShares(list.currentCursor(), true);
});

usePageRefresh(() => loadShares(list.currentCursor(), true));
</script>

<template>
  <div class="page mc-management-page">
    <section class="mc-panel mc-management-panel">
      <div class="mc-panel-head mc-panel-head--tools">
        <div class="mc-heading-line">
          <h3>共享邮件</h3>
        </div>
        <div class="mc-page-actions mc-panel-head-tools">
          <label class="mc-search mc-search--table mc-panel-head-search">
            <McIcon name="search" :size="18" />
            <input v-model.trim="query.keyword" type="search" placeholder="搜索收件人、发件人或标题" @keyup.enter="applySearch" @change="applySearch" />
          </label>
          <div class="mc-panel-page-controls">
            <button class="mc-square" :class="{ disabled: currentPage <= 1 }" type="button" :disabled="currentPage <= 1" aria-label="上一页" @click="prevPage">
              <McIcon name="left" :size="19" />
            </button>
            <button class="mc-square" :class="{ disabled: !hasMore }" type="button" :disabled="!hasMore" aria-label="下一页" @click="nextPage">
              <McIcon name="right" :size="19" />
            </button>
          </div>
        </div>
      </div>

      <el-table :data="rows" table-layout="fixed" empty-text=" " class="mc-management-table" :class="{ 'mc-el-table-empty': loaded && rows.length === 0 }">
        <el-table-column label="收件人" min-width="220">
          <template #default="{ row }">
            <span class="mc-table-main-text">{{ row.mail?.toAddr || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="发件人" min-width="240">
          <template #default="{ row }">
            <span class="mc-table-text">{{ row.mail?.fromAddr || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="邮件标题" min-width="300">
          <template #default="{ row }">
            <button v-if="row.url" type="button" class="mc-share-link" @click="openShare(row.url)">{{ row.mail?.subject || '未命名共享邮件' }}</button>
            <span v-else class="mc-table-main-text">{{ row.mail?.subject || '未命名共享邮件' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="有效期" width="170">
          <template #default="{ row }">
            <span class="mc-table-text">{{ row.expiresAt ? formatFullTime(row.expiresAt) : '永久' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="right">
          <template #default="{ row }">
            <ShareRowActions :disabled="saving" :copy-disabled="!row.url" @copy="copyShare(row.url)" @edit="openEdit(row)" @delete="deleteCurrent(row.id)" />
          </template>
        </el-table-column>
        <template #empty>
          <div v-if="loaded" class="mc-empty-state mc-empty-state--table-inner">
            <div class="mc-empty-icon"><McIcon name="link" :size="26" /></div>
            <h2>暂无共享邮件</h2>
          </div>
        </template>
      </el-table>
    </section>

    <ShareExpiryDialog
      v-model="editDialogOpen"
      title="编辑共享邮件"
      :saving="saving"
      :expires-at="editingShare?.expiresAt"
      allow-regenerate
      @save="updateExpiry"
      @regenerate="regenerateCurrent()"
      @closed="closeEdit"
    />
  </div>
</template>
