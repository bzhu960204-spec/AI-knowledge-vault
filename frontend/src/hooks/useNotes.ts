import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { notesApi, tagsApi } from '../api/endpoints';
import type { NoteRequest, NoteSummary } from '../api/types';

export function useNotes(params: { folderId?: number | null; tag?: string; includeSubfolders?: boolean }) {
  return useQuery({
    queryKey: ['notes', params],
    queryFn: () => notesApi.list(params),
  });
}

export function useSearchNotes(query: string) {
  return useQuery({
    queryKey: ['notes', 'search', query],
    queryFn: () => notesApi.search(query),
    enabled: query.trim().length > 0,
  });
}

export function useNote(id: number | null) {
  return useQuery({
    queryKey: ['note', id],
    queryFn: () => notesApi.get(id as number),
    enabled: id != null,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NoteRequest) => notesApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: NoteRequest }) =>
      notesApi.update(id, body),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['note', note.id] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => notesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useMoveNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      folderId,
    }: {
      id: number;
      folderId: number | null;
    }) => notesApi.move(id, folderId),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['note', note.id] });
    },
  });
}

export function useReorderNotes(params: {
  folderId?: number | null;
  tag?: string;
}) {
  const qc = useQueryClient();
  const key = ['notes', params];
  return useMutation({
    mutationFn: (orderedIds: number[]) => notesApi.reorder(orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<NoteSummary[]>(key);
      if (prev) {
        const byId = new Map(prev.map((n) => [n.id, n]));
        const next = orderedIds
          .map((id) => byId.get(id))
          .filter((n): n is NoteSummary => n != null);
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: tagsApi.list });
}

export function useUploadQuestionImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      noteId,
      segmentId,
      file,
    }: {
      noteId: number;
      segmentId: number;
      file: File;
    }) => notesApi.uploadQuestionImage(noteId, segmentId, file),
    onSuccess: (_img, { noteId }) => {
      qc.invalidateQueries({ queryKey: ['note', noteId] });
    },
  });
}

export function useDeleteQuestionImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      noteId,
      segmentId,
      imageId,
    }: {
      noteId: number;
      segmentId: number;
      imageId: number;
    }) => notesApi.deleteQuestionImage(noteId, segmentId, imageId),
    onSuccess: (_v, { noteId }) => {
      qc.invalidateQueries({ queryKey: ['note', noteId] });
    },
  });
}
