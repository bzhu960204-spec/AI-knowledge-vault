import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { foldersApi } from '../api/endpoints';
import type { FolderRequest } from '../api/types';

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
