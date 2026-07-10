import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { notesApi, tagsApi } from '../api/endpoints';
import type { NoteRequest } from '../api/types';

export function useNotes(params: { folderId?: number | null; tag?: string }) {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: tagsApi.list });
}
