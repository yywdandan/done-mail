import { queryClient } from '../queryClient';
import { endpoints, type PageResult, type ShareRecord } from '../api/endpoints';
import { queryKeys } from './keys';

export function shareListParams(query: { type: string; keyword?: string }, cursor: string) {
  return {
    type: query.type || undefined,
    cursor,
    per_page: 20,
    keyword: query.keyword?.trim() || undefined
  };
}

export function loadSharesPage(params: Record<string, unknown>, force = false) {
  const options = {
    queryKey: queryKeys.shares(params),
    queryFn: () => endpoints.shares(params),
    staleTime: 60_000
  };
  return force ? queryClient.fetchQuery({ ...options, staleTime: 0 }) : queryClient.ensureQueryData<PageResult<ShareRecord[]>>(options);
}

export function invalidateShares() {
  return queryClient.invalidateQueries({ queryKey: ['shares'] });
}

export async function createShare(payload: Record<string, unknown>) {
  const share = await endpoints.createShare(payload);
  invalidateShares();
  return share;
}

export async function updateShare(id: string, payload: Record<string, unknown>) {
  const share = await endpoints.updateShare(id, payload);
  invalidateShares();
  return share;
}

export async function regenerateShare(id: string) {
  const share = await endpoints.regenerateShare(id);
  invalidateShares();
  return share;
}

export async function deleteShare(id: string) {
  const result = await endpoints.deleteShare(id);
  invalidateShares();
  return result;
}
