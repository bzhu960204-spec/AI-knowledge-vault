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

export type SearchField = 'all' | 'title' | 'question' | 'answer';
export type SearchSort = 'relevance' | 'updated';

export interface SearchParams {
  q: string;
  folderId?: number | null;
  includeSubfolders?: boolean;
  tag?: string | null;
  field?: SearchField;
  sort?: SearchSort;
}

export interface SearchResult {
  id: number;
  title: string;
  folderId: number | null;
  folderPath: string | null;
  sourceModel: string | null;
  tags: string[];
  snippet: string;
  terms: string[];
  matchFields: string[];
  matchSegment: number | null;
  updatedAt: string;
}

export interface QuestionImage {
  id: number;
  url: string;
  originalName?: string | null;
  contentType?: string | null;
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

export type ExportFormat = 'HTML' | 'PDF' | 'ARCHIVE';

export interface ExportRequest {
  noteIds: number[];
  folderId?: number | null;
  includeSubfolders?: boolean;
  includeQuestion: boolean;
  stripLinks?: boolean;
  title?: string;
}

/** Summary returned after importing a .aivault bundle. */
export interface ImportResult {
  folders: number;
  notes: number;
  images: number;
}
