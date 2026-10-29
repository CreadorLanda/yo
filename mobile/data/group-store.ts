import { useSyncExternalStore } from 'react';

import {
  getGroup,
  listGroups,
  patchGroup as apiPatchGroup,
  type GroupDTO,
  type GroupPermissionsDTO,
} from '@/data/api/groups';
import { GROUPS, type GroupInfo, type GroupMember } from './mock';

/**
 * Group settings store — prefers API data, falls back to mock GROUPS.
 */

let groups: Record<string, GroupInfo> = { ...GROUPS };
let booted = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function mapDTO(g: GroupDTO): GroupInfo {
  const members: GroupMember[] = (g.members ?? []).map((m) => ({
    id: m.user_id,
    name: m.display_name || m.username || 'Member',
    username: m.username ? `@${m.username.replace(/^@/, '')}` : '',
    avatarUri: m.avatar_uri ?? '',
    role: m.role,
  }));
  return {
    id: g.id,
    name: g.title,
    avatarUri: g.avatar_url ?? '',
    description: g.description ?? '',
    members,
    historyEnabled: g.history_enabled,
    historyMode: g.history_mode === 'view-only' ? 'view-only' : 'full',
    historyLimit: g.history_limit < 0 ? Infinity : g.history_limit,
    permissions: g.permissions,
  };
}

/** Pull groups from API and merge into the local map (mock remains as fallback). */
export async function bootstrapGroups(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    const list = await listGroups();
    if (!list?.length) return;
    const next = { ...groups };
    for (const g of list) {
      next[g.id] = mapDTO(g);
    }
    groups = next;
    emit();
  } catch {
    /* keep mock */
  }
}

/** Fetch a single group (e.g. open chat-info) and merge. */
export async function refreshGroup(id: string): Promise<GroupInfo | undefined> {
  try {
    const g = await getGroup(id);
    const mapped = mapDTO(g);
    groups = { ...groups, [id]: mapped };
    emit();
    return mapped;
  } catch {
    return groups[id];
  }
}

export function updateGroup(id: string, patch: Partial<GroupInfo>) {
  const current = groups[id];
  if (!current) return;
  const next = { ...current, ...patch };
  groups = { ...groups, [id]: next };
  emit();

  // Persist history settings when we have a real UUID group.
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const body: {
      title?: string;
      description?: string;
      avatar_url?: string;
      history_enabled?: boolean;
      history_mode?: 'full' | 'view-only';
      history_limit?: number;
      permissions?: GroupPermissionsDTO;
    } = {};
    if (patch.name != null) body.title = patch.name;
    if (patch.description != null) body.description = patch.description;
    if (patch.avatarUri != null) body.avatar_url = patch.avatarUri;
    if (patch.historyEnabled != null) body.history_enabled = patch.historyEnabled;
    if (patch.historyMode != null) body.history_mode = patch.historyMode;
    if (patch.historyLimit != null) {
      body.history_limit = patch.historyLimit === Infinity ? -1 : patch.historyLimit;
    }
    if (patch.permissions != null) body.permissions = patch.permissions;
    if (Object.keys(body).length > 0) {
      apiPatchGroup(id, body)
        .then((g) => {
          groups = { ...groups, [id]: mapDTO(g) };
          emit();
        })
        .catch(() => {
          /* keep optimistic */
        });
    }
  }
}

/** Subscribe a component to a group's settings. Returns `undefined` for non-groups. */
export function useGroup(id: string | undefined): GroupInfo | undefined {
  return useSyncExternalStore(subscribe, () => (id ? groups[id] : undefined));
}

export function getGroupLocal(id: string): GroupInfo | undefined {
  return groups[id];
}

/** Drop cached groups on sign-out — they belong to the account, not the device. */
export function resetGroupStore(): void {
  groups = { ...GROUPS };
  booted = false;
  emit();
}
