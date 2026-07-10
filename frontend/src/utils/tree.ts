import type { Folder, FolderNode } from '../api/types';

/** Builds a nested tree from a flat, sorted folder list. */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const byId = new Map<number, FolderNode>();
  folders.forEach((f) => byId.set(f.id, { ...f, children: [] }));

  const roots: FolderNode[] = [];
  byId.forEach((node) => {
    if (node.parentId != null && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}
