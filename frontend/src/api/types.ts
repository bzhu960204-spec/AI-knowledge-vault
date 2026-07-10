export interface Folder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface FolderRequest {
  name: string;
  parentId?: number | null;
  sortOrder?: number;
}

export interface NoteSummary {
  id: number;
  title: string;
  folderId: number | null;
  sourceModel: string | null;
  tags: string[];
  excerpt: string;
  updatedAt: string;
}

export interface Note {
  id: number;
  title: string;
  contentMarkdown: string;
  folderId: number | null;
  sourceModel: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteRequest {
  title: string;
  contentMarkdown: string;
  folderId?: number | null;
  sourceModel?: string | null;
  tags: string[];
}

/** A folder node with its children resolved, for tree rendering. */
export interface FolderNode extends Folder {
  children: FolderNode[];
}
