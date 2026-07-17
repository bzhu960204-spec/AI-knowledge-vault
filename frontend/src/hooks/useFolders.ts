import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { foldersApi } from '../api/endpoints';
import type { Folder, FolderRequest } from '../api/types';

const KEY = ['folders'];

export function useFolders() {
  return useQuery({ queryKey: KEY, queryFn: foldersApi.list });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FolderRequest) => foldersApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: FolderRequest }) =>
      foldersApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => foldersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}

export function useReorderFolders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: number[]) => foldersApi.reorder(orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Folder[]>(KEY);
      if (prev) {
        const byId = new Map(prev.map((f) => [f.id, f]));
        const next = orderedIds
          .map((id, index) => {
            const folder = byId.get(id);
            return folder ? { ...folder, sortOrder: index } : undefined;
          })
          .filter((f): f is Folder => f != null);
        qc.setQueryData(KEY, next);
      }
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
