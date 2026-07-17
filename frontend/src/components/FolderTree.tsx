import { useMemo, useState } from 'react';
import {
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import type { FolderNode } from '../api/types';
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useUpdateFolder,
} from '../hooks/useFolders';
import { useTags } from '../hooks/useNotes';
import { useSelectionStore } from '../store/useSelectionStore';
import { buildFolderTree } from '../utils/tree';

export function FolderTree({
  onToggleCollapse,
}: {
  onToggleCollapse?: () => void;
}) {
  const { data: folders = [], isLoading } = useFolders();
  const createFolder = useCreateFolder();
  const selectFolder = useSelectionStore((s) => s.selectFolder);
  const selectedFolderId = useSelectionStore((s) => s.selectedFolderId);
  const activeTag = useSelectionStore((s) => s.activeTag);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addRootFolder() {
    const name = window.prompt('New folder name');
    if (name?.trim()) {
      createFolder.mutate({ name: name.trim(), parentId: null });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Folders
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={addRootFolder}
            title="New folder"
            className="rounded-md px-1.5 text-lg leading-none text-muted transition hover:bg-surface-2 hover:text-accent"
          >
            +
          </button>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Hide folders"
              className="rounded-md px-1.5 py-1 text-muted transition hover:bg-surface-2 hover:text-accent"
            >
              ◂
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-3">
        <RootDropZone
          active={selectedFolderId === null && activeTag === null}
          onSelect={() => selectFolder(null)}
        />
        {isLoading ? (
          <p className="px-2 py-2 text-sm text-muted">Loading…</p>
        ) : tree.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted">
            No folders yet. Click + to create one.
          </p>
        ) : (
          tree.map((node) => (
            <FolderRow
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
            />
          ))
        )}
        <FolderListEndZone />
      </div>

      <TagFilterHint activeTag={activeTag} onClear={() => selectFolder(null)} />
      {activeTag == null && <TagSection />}
    </div>
  );
}

function RootDropZone({
  active,
  onSelect,
}: {
  active: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'root' });
  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onSelect}
      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
        active ? 'bg-surface-2 text-accent' : 'text-text hover:bg-surface-2'
      } ${isOver ? 'ring-1 ring-accent' : ''}`}
    >
      <span>🏠</span>
      <span>All Notes (root)</span>
    </button>
  );
}

function FolderListEndZone() {
  const { setNodeRef } = useDroppable({ id: 'folder-list-end' });
  const active = useSelectionStore((s) => s.folderDropRootEnd);
  return (
    <div ref={setNodeRef} className="relative min-h-[48px] flex-1">
      {active && (
        <span className="pointer-events-none absolute inset-x-1 top-1 h-0.5 rounded bg-accent" />
      )}
    </div>
  );
}

interface FolderRowProps {
  node: FolderNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
}

function FolderRow({ node, depth, expanded, onToggle }: FolderRowProps) {
  const selectFolder = useSelectionStore((s) => s.selectFolder);
  const selectedFolderId = useSelectionStore((s) => s.selectedFolderId);
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();

  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedFolderId === node.id;
  const dropTargetId = useSelectionStore((s) => s.folderDropTargetId);
  const dropPosition = useSelectionStore((s) => s.folderDropPosition);
  const dropHere = dropTargetId === node.id ? dropPosition : null;

  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({
    id: `folder:${node.id}`,
    data: { type: 'folder', name: node.name, parentId: node.parentId },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder:${node.id}`,
  });

  function addChild() {
    const name = window.prompt(`New folder inside "${node.name}"`);
    if (name?.trim()) {
      createFolder.mutate({ name: name.trim(), parentId: node.id });
      if (!isOpen) onToggle(node.id);
    }
  }

  function rename() {
    const name = window.prompt('Rename folder', node.name);
    if (name?.trim() && name.trim() !== node.name) {
      updateFolder.mutate({
        id: node.id,
        body: { name: name.trim(), parentId: node.parentId },
      });
    }
  }

  function remove() {
    if (
      window.confirm(
        `Delete "${node.name}" and its subfolders? Notes inside move to root.`,
      )
    ) {
      deleteFolder.mutate(node.id);
    }
  }

  return (
    <div>
      <div
        ref={setDropRef}
        className={`group relative flex items-center gap-1 rounded-lg pr-1 transition ${
          isSelected ? 'bg-surface-2' : 'hover:bg-surface-2'
        } ${
          (isOver && dropHere == null) || dropHere === 'into'
            ? 'ring-1 ring-accent'
            : ''
        } ${isDragging ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {dropHere === 'before' && (
          <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 -translate-y-1/2 rounded bg-accent" />
        )}
        {dropHere === 'after' && (
          <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 translate-y-1/2 rounded bg-accent" />
        )}
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className="w-5 shrink-0 text-xs text-muted"
        >
          {hasChildren ? (isOpen ? '▾' : '▸') : ''}
        </button>

        <button
          type="button"
          ref={setDragRef}
          {...listeners}
          {...attributes}
          onClick={() => selectFolder(node.id)}
          title={node.name}
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm ${
            isSelected ? 'text-accent' : 'text-text'
          }`}
        >
          <span className="shrink-0">📁</span>
          <span className="truncate">{node.name}</span>
        </button>

        <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-surface-2 px-0.5 opacity-0 shadow-sm transition group-hover:pointer-events-auto group-hover:opacity-100">
          <IconButton title="New subfolder" onClick={addChild} label="+" />
          <IconButton title="Rename" onClick={rename} label="✎" />
          <IconButton title="Delete" onClick={remove} label="🗑" />
        </div>
      </div>

      {isOpen &&
        node.children.map((child) => (
          <FolderRow
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  label,
}: {
  title: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded px-1 text-xs text-muted transition hover:bg-surface hover:text-accent"
    >
      {label}
    </button>
  );
}

function TagFilterHint({
  activeTag,
  onClear,
}: {
  activeTag: string | null;
  onClear: () => void;
}) {
  if (!activeTag) return null;
  return (
    <div className="mx-2 mb-2 flex items-center justify-between rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
      <span className="text-accent">#{activeTag}</span>
      <button type="button" onClick={onClear} className="text-muted hover:text-text">
        clear
      </button>
    </div>
  );
}

function TagSection() {
  const selectTag = useSelectionStore((s) => s.selectTag);
  const { data: tags = [] } = useTags();
  if (tags.length === 0) return null;
  return (
    <div className="border-t border-border px-3 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Tags
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => selectTag(tag)}
            className="rounded-md border border-border px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:text-accent"
          >
            #{tag}
          </button>
        ))}
      </div>
    </div>
  );
}
