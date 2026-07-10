import { api } from './client';
import type {
  Folder,
  FolderRequest,
  Note,
  NoteRequest,
  NoteSummary,
} from './types';

export const foldersApi = {
  list: () => api.get<Folder[]>('/folders').then((r) => r.data),
  create: (body: FolderRequest) =>
    api.post<Folder>('/folders', body).then((r) => r.data),
  update: (id: number, body: FolderRequest) =>
    api.put<Folder>(`/folders/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/folders/${id}`).then(() => undefined),
};

export const notesApi = {
  list: (params: { folderId?: number | null; tag?: string }) =>
    api
      .get<NoteSummary[]>('/notes', {
        params: {
          folderId: params.folderId ?? undefined,
          tag: params.tag ?? undefined,
        },
      })
      .then((r) => r.data),
  search: (q: string) =>
    api
      .get<NoteSummary[]>('/notes/search', { params: { q } })
      .then((r) => r.data),
  get: (id: number) => api.get<Note>(`/notes/${id}`).then((r) => r.data),
  create: (body: NoteRequest) =>
    api.post<Note>('/notes', body).then((r) => r.data),
  update: (id: number, body: NoteRequest) =>
    api.put<Note>(`/notes/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/notes/${id}`).then(() => undefined),
};

export const tagsApi = {
  list: () => api.get<string[]>('/tags').then((r) => r.data),
};
