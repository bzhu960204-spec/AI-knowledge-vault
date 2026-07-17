# AI Answer Vault

A local, single-user web app to **collect, categorize, and search LLM answers**.
Organize answers in nested folders and tags, and edit them in a rich-text
WYSIWYG editor that handles pasted LLM output (links, code blocks, tables, math)
smoothly.

- **Frontend:** Vite + React + TypeScript, TanStack Query, Zustand, Tailwind CSS,
  TipTap editor (with KaTeX math), dnd-kit
- **Backend:** Spring Boot 3 + Spring Data JPA + H2 (file mode, data persisted to disk)

## Features

- Nested folders (drag a folder onto another to move it) + multi-tag organization
- Milkdown WYSIWYG editor: paste Markdown and it renders instantly
  - Code blocks with syntax highlighting
  - KaTeX math
  - Tables, lists, quotes
- Debounced auto-save
- Full-text search across title, content, and tags (Ctrl/Cmd + K)
- **5 switchable themes** (Light Minimal, Dark Developer, Modern Dashboard,
  Sepia Reading, High Contrast) + 5 accent colors — remembered in `localStorage`

## Prerequisites

- Java 17+
- Maven 3.9+
- Node.js 20+

## Run

Open two terminals.

### 1. Backend (http://localhost:8080)

```powershell
cd backend
mvn spring-boot:run
```

- H2 console: http://localhost:8080/h2-console (JDBC URL `jdbc:h2:file:./data/vault`, user `sa`, empty password)
- Data is stored in `backend/data/` and survives restarts.

### 2. Frontend (http://localhost:5173)

```powershell
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to the backend, so no CORS setup is needed in dev.

## API overview

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET | `/api/folders` | List all folders (flat; the UI builds the tree) |
| POST | `/api/folders` | Create a folder |
| PUT | `/api/folders/{id}` | Rename / move a folder |
| DELETE | `/api/folders/{id}` | Delete a folder (notes inside move to root) |
| GET | `/api/notes?folderId=&tag=` | List notes by folder or tag |
| GET | `/api/notes/search?q=` | Full-text search |
| GET | `/api/notes/{id}` | Get a single note |
| POST | `/api/notes` | Create a note |
| PUT | `/api/notes/{id}` | Update a note |
| DELETE | `/api/notes/{id}` | Delete a note |
| GET | `/api/tags` | List all tag names |

## Production build

```powershell
cd frontend
npm run build      # outputs static assets to frontend/dist

cd ../backend
mvn clean package  # builds an executable jar in backend/target
```
