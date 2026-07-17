import { api } from './client';
import type {
  ExportRequest,
  Folder,
  FolderRequest,
  Note,
  NoteRequest,
  NoteSummary,
  QuestionImage,
} from './types';

export const foldersApi = {
  list: () => api.get<Folder[]>('/folders').then((r) => r.data),
  create: (body: FolderRequest) =>
    api.post<Folder>('/folders', body).then((r) => r.data),
  update: (id: number, body: FolderRequest) =>
    api.put<Folder>(`/folders/${id}`, body).then((r) => r.data),
  reorder: (ids: number[]) =>
    api.patch('/folders/reorder', { ids }).then(() => undefined),
  remove: (id: number) => api.delete(`/folders/${id}`).then(() => undefined),
};

export const notesApi = {
  list: (params: { folderId?: number | null; tag?: string; includeSubfolders?: boolean }) =>
    api
      .get<NoteSummary[]>('/notes', {
        params: {
          folderId: params.folderId ?? undefined,
          tag: params.tag ?? undefined,
          includeSubfolders: params.includeSubfolders ? true : undefined,
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
  move: (id: number, folderId: number | null) =>
    api.patch<Note>(`/notes/${id}/folder`, { folderId }).then((r) => r.data),
  reorder: (ids: number[]) =>
    api.patch('/notes/reorder', { ids }).then(() => undefined),
  remove: (id: number) => api.delete(`/notes/${id}`).then(() => undefined),
  exportHtml: (body: ExportRequest) =>
    api
      .post<string>('/notes/export', body, { responseType: 'text' })
      .then((r) => r.data),
  uploadQuestionImage: (noteId: number, segmentId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<QuestionImage>(
        `/notes/${noteId}/segments/${segmentId}/images`,
        form,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      )
      .then((r) => r.data);
  },
  deleteQuestionImage: (noteId: number, segmentId: number, imageId: number) =>
    api
      .delete(`/notes/${noteId}/segments/${segmentId}/images/${imageId}`)
      .then(() => undefined),
};

export const tagsApi = {
  list: () => api.get<string[]>('/tags').then((r) => r.data),
};
