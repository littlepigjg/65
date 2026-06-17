import axios from 'axios';
import { SyncConfig, SyncStatus, SyncRecord, ConflictFile, ConflictDiff } from './types';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000
});

export const configApi = {
  get: () => api.get<SyncConfig>('/config').then(r => r.data),
  update: (config: SyncConfig) => api.put<SyncConfig>('/config', config).then(r => r.data),
  restart: () => api.post('/config/restart').then(r => r.data)
};

export const syncApi = {
  getStatus: () => api.get<SyncStatus>('/sync/status').then(r => r.data),
  start: () => api.post<SyncStatus>('/sync/start').then(r => r.data),
  stop: () => api.post<SyncStatus>('/sync/stop').then(r => r.data),
  syncNow: () => api.post<SyncStatus>('/sync/sync').then(r => r.data)
};

export const conflictsApi = {
  getAll: (all = false) => api.get<ConflictFile[]>(`/conflicts?all=${all}`).then(r => r.data),
  getById: (id: string) => api.get<ConflictFile>(`/conflicts/${id}`).then(r => r.data),
  getDiff: (id: string) => api.get<ConflictDiff>(`/conflicts/${id}/diff`).then(r => r.data),
  resolve: (id: string, resolution: 'source' | 'target' | 'merge', mergedContent?: string) =>
    api.post(`/conflicts/${id}/resolve`, { resolution, mergedContent }).then(r => r.data)
};

export const recordsApi = {
  getAll: (limit?: number) =>
    api.get<SyncRecord[]>(`/records${limit ? `?limit=${limit}` : ''}`).then(r => r.data),
  getRecent: (limit?: number) =>
    api.get<SyncRecord[]>(`/records/recent${limit ? `?limit=${limit}` : ''}`).then(r => r.data)
};

export function createEventSource(): EventSource {
  return new EventSource('/api/sync/events');
}
