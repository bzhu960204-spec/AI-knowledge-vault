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
  sortOrder: number;
}

export interface QuestionImage {
  id: number;
  url: string;
  originalName?: string | null;
}

export interface NoteSegment {
  id: number;
  position: number;
  question: string | null;
  answerHtml: string;
  images: QuestionImage[];
}

export interface Note {
  id: number;
  title: string;
  folderId: number | null;
  sourceModel: string | null;
  tags: string[];
  segments: NoteSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteSegmentRequest {
  id?: number | null;
  question?: string | null;
  answerHtml: string;
}

export interface NoteRequest {
  title: string;
  folderId?: number | null;
  sourceModel?: string | null;
  tags: string[];
  segments: NoteSegmentRequest[];
}

/** A folder node with its children resolved, for tree rendering. */
export interface FolderNode extends Folder {
  children: FolderNode[];
}

export type ExportFormat = 'HTML' | 'PDF';

export interface ExportRequest {
  noteIds: number[];
  folderId?: number | null;
  includeSubfolders?: boolean;
  includeQuestion: boolean;
  title?: string;
}
