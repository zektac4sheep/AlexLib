# Technical Architecture Plan - Cool18 Reborn v3

## 1. Project Structure

```
AlexLib/
├── server.js                 # Main Express server entry point
├── package.json
├── .env                      # Environment configuration
├── public/                   # Static frontend files
│   ├── index.html           # Main UI
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js           # Main frontend logic
│       ├── search.js        # Search functionality
│       ├── download.js      # Download management
│       └── progress.js      # Progress tracking (SSE)
├── routes/                   # API route handlers
│   ├── index.js             # Route aggregator
│   ├── search.js            # Search endpoints
│   ├── download.js          # Download endpoints
│   ├── books.js             # Book management
│   ├── joplin.js            # Joplin integration
│   └── upload.js            # File upload (Entry B)
├── services/                 # Business logic services
│   ├── cool18Scraper.js     # Cool18 forum scraping
│   ├── joplinService.js     # Joplin API client
│   ├── textProcessor.js     # Text cleaning & formatting
│   ├── chapterExtractor.js  # Chapter detection
│   ├── bookDetector.js      # Book name detection
│   ├── chunker.js           # File chunking (1000 lines)
│   ├── converter.js         # opencc-js wrapper (Simplified ↔ Traditional)
│   └── tagExtractor.js      # Tag extraction
├── models/                   # Database models
│   ├── database.js          # SQLite initialization
│   ├── book.js              # Book model
│   ├── chapter.js           # Chapter model
│   └── download.js          # Download job model
├── utils/                    # Utility functions
│   ├── logger.js            # Logging utility
│   └── validators.js        # Input validation
└── data/                     # Data storage
    ├── books.db             # SQLite database
    └── source/              # Raw source files
```

## 2. Database Schema (SQLite)

### books table
- `id` INTEGER PRIMARY KEY
- `book_name_simplified` TEXT NOT NULL UNIQUE  # Stored in Simplified Chinese
- `book_name_traditional` TEXT                 # Cached Traditional Chinese for display
- `joplin_notebook_id` TEXT                    # Joplin notebook ID if exported
- `total_chapters` INTEGER DEFAULT 0
- `last_updated` DATETIME
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

### chapters table
- `id` INTEGER PRIMARY KEY
- `book_id` INTEGER REFERENCES books(id)
- `chapter_number` INTEGER                    # Extracted chapter number
- `chapter_title` TEXT                        # Full chapter title (Traditional Chinese)
- `chapter_title_simplified` TEXT             # Original from Cool18 (Simplified)
- `cool18_url` TEXT                           # Source URL
- `cool18_thread_id` TEXT                     # Thread ID for tracking
- `content` TEXT                              # Full chapter content (Traditional Chinese)
- `line_start` INTEGER                        # Line number in master file
- `line_end` INTEGER                          # Line number in master file
- `downloaded_at` DATETIME
- `status` TEXT DEFAULT 'pending'             # pending, downloaded, failed
- `joplin_note_id` TEXT                       # Joplin note ID if exported

### download_jobs table
- `id` INTEGER PRIMARY KEY
- `book_id` INTEGER REFERENCES books(id)
- `status` TEXT                               # queued, processing, completed, failed
- `total_chapters` INTEGER
- `completed_chapters` INTEGER DEFAULT 0
- `failed_chapters` INTEGER DEFAULT 0
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- `completed_at` DATETIME

### book_tags table
- `id` INTEGER PRIMARY KEY
- `book_id` INTEGER REFERENCES books(id)
- `tag` TEXT                                  # Tag name (e.g., "小說", "成人")

## 3. Backend API Endpoints

### Search & Discovery
- `GET /api/search?keyword=都市&pages=10` - Search Cool18 forum
- `GET /api/books` - List all books in database
- `GET /api/books/:id` - Get book details with chapters
- `GET /api/joplin/notebooks` - List Joplin notebooks (for dropdown)

### Download Management
- `POST /api/download/start` - Start download job
  ```json
  {
    "chapters": [
      {"url": "...", "title": "...", "chapterNum": 126}
    ],
    "bookId": 1,  // or null for new book
    "bookName": "都市猎艳人生"  // Simplified Chinese
  }
  ```
- `GET /api/download/:jobId/status` - Get download progress
- `GET /api/download/:jobId/stream` - Get download logs (SSE)
- `POST /api/download/retry-failed` - Retry failed chapters

### File Upload (Entry B)
- `POST /api/upload` - Upload raw files (multipart/form-data)
  - Accepts: html.txt, raw.txt, pre_content_0.md, single HTML files
- `POST /api/upload/process` - Process uploaded file

### Book Management
- `POST /api/books` - Create new book
- `PUT /api/books/:id` - Update book
- `DELETE /api/books/:id` - Delete book
- `POST /api/books/:id/export-joplin` - Export book to Joplin
- `GET /api/books/:id/chapters` - List chapters for a book

## 4. Service Layer Architecture

### cool18Scraper.js
**Responsibilities:**
- Search Cool18 forum with pagination (1-10 pages)
- Extract thread URLs and metadata
- Download individual thread content
- Handle rate limiting and retries
- Concurrent downloads (max 6)

**Key Functions:**
- `searchForum(keyword, maxPages)` → Array of thread objects
- `downloadThread(url)` → {title, content, metadata}
- `extractThreadMetadata(html)` → {title, date, replies}

### chapterExtractor.js
**Responsibilities:**
- Extract chapter numbers from titles (第XXX章/回/集/話/篇)
- Support formats: 第1章, 第126章, 第零一章, etc.
- Return normalized chapter number (integer)

**Key Functions:**
- `extractChapterNumber(title)` → {number: 126, format: "章"}
- `normalizeChapterTitle(title)` → Cleaned title

### bookDetector.js
**Responsibilities:**
- Detect book name from thread title using regex patterns
- Store in Simplified Chinese (as-is from Cool18)
- Patterns: `(都市猎艳.*?)第`, `(.*?)第.*章`

**Key Functions:**
- `detectBookName(threadTitle)` → bookName (Simplified Chinese)
- `matchExistingBook(bookNameSimplified)` → bookId or null

### textProcessor.js
**Responsibilities:**
- Clean HTML content from Cool18 threads
- Apply formatting patterns (from Reference.md)
- Convert to Markdown format
- Preserve chapter headers

**Key Functions:**
- `cleanHtml(html)` → Cleaned text
- `formatContent(text)` → Formatted Markdown
- `applyPatterns(text, patterns)` → Processed text

### converter.js (opencc-js wrapper)
**Responsibilities:**
- Convert Simplified → Traditional Chinese (HK variant)
- Convert Traditional → Simplified (if needed)
- Cache conversions for performance

**Key Functions:**
- `toTraditional(text)` → Traditional Chinese
- `toSimplified(text)` → Simplified Chinese
- `convertBookNameForDisplay(bookNameSimplified)` → Traditional for UI
- `convertBookNameForJoplin(bookNameSimplified)` → Traditional for export

### chunker.js
**Responsibilities:**
- Split master file into chunks (~1000 lines each)
- Preserve TOC and chapter headers in each chunk
- Generate chunk filenames: `書名.md`, `書名_2.md`
- Track line ranges for each chunk

**Key Functions:**
- `chunkContent(masterContent, chunkSize)` → Array of chunks
- `generateTOC(chapters)` → TOC markdown
- `addTOCToChunk(chunk, fullTOC)` → Chunk with TOC

### joplinService.js
**Responsibilities:**
- Joplin API client (REST API)
- Create/update notebooks
- Create/update notes
- Check for duplicates
- Add tags

**Key Functions:**
- `listNotebooks()` → Array of notebooks
- `findNotebook(bookNameTraditional)` → notebookId or null
- `createNotebook(bookNameTraditional)` → notebookId
- `createNote(notebookId, title, content, tags)` → noteId
- `updateNote(noteId, content)` → success
- `checkNoteExists(title)` → boolean

### tagExtractor.js
**Responsibilities:**
- Extract tags from book/chapter titles
- Common tags: 小說, 成人, 後宮, 人妻, NTR, 絲襪, etc.
- Return array of relevant tags

**Key Functions:**
- `extractTags(title, content)` → Array of tags

## 5. Frontend Architecture

### Component Structure
- **SearchView** - Search interface (Entry A)
- **ResultsList** - Display search results with checkboxes
- **BookSelector** - Dropdown for existing books + create new
- **DownloadProgress** - Real-time progress bar + logs (SSE)
- **UploadView** - Drag & drop file upload (Entry B)
- **BookList** - List all books in database
- **BookDetail** - View book chapters and status

### Real-time Updates
- Use Server-Sent Events (SSE) for progress updates
- Endpoint: `GET /api/download/:jobId/stream`
- Stream format: `data: {"type":"progress","completed":5,"total":10}`

### State Management
- Simple vanilla JS with event-driven architecture
- No framework required (can add React/Vue later)
- Local state in components
- API calls via fetch()

## 6. Data Flow

### Entry A: Search & Download Flow
1. User enters keyword → `POST /api/search`
2. Backend: cool18Scraper.searchForum() → returns threads
3. Backend: chapterExtractor + bookDetector process each thread
4. Backend: converter.toTraditional() for UI display
5. Frontend: Display results with checkboxes
6. User selects chapters + book → `POST /api/download/start`
7. Backend: Create download_job record
8. Backend: Queue chapters for download (p-limit: 6 concurrent)
9. For each chapter:
   - cool18Scraper.downloadThread()
   - textProcessor.cleanHtml()
   - converter.toTraditional()
   - Save to chapters table
10. After all chapters: chunker.chunkContent()
11. joplinService.createNotebook() or find existing
12. joplinService.createNote() for each chunk
13. Stream progress via SSE to frontend

### Entry B: File Upload Flow
1. User drags file → `POST /api/upload`
2. Save to `source/` folder
3. User clicks "Process" → `POST /api/upload/process`
4. Detect file type (html.txt, raw.txt, etc.)
5. Parse file:
   - If html.txt: parseUrlFromHtmlFile() logic
   - If raw.txt: parseHtml() logic
   - Extract chapters
6. Continue from step 9 of Entry A flow

## 7. Key Design Decisions

### Simplified Chinese Storage
- **Critical:** Book names stored in Simplified Chinese in DB
- UI displays Traditional Chinese (converted on-the-fly)
- Joplin exports use Traditional Chinese
- This ensures accurate matching with Cool18 (which uses Simplified)

### Concurrent Downloads
- Use `p-limit` library to limit to 6 concurrent downloads
- Prevents overwhelming Cool18 server
- Better performance than sequential

### Chunking Strategy
- Split at ~1000 lines (configurable)
- Each chunk includes:
  - Full TOC (all chapters)
  - Book title header
  - Relevant chapter content
- Enables Joplin search across all chunks

### Duplicate Prevention
- Check chapter by cool18_url before downloading
- Check Joplin note by title before creating
- Database unique constraints on (book_id, chapter_number)

### Error Handling
- Failed downloads stored with status="failed"
- Retry mechanism via `/api/download/retry-failed`
- Logs stored in download_jobs table

## 8. Configuration (.env)

```
PORT=3000
JOPLIN_API_TOKEN=your_token_here
JOPLIN_API_URL=http://localhost:41184
DB_PATH=./data/books.db
COOL18_BASE_URL=https://www.cool18.com/bbs4
MAX_CONCURRENT_DOWNLOADS=6
MAX_SEARCH_PAGES=10
CHUNK_SIZE=1000
SOURCE_FOLDER=./source
```

## 9. Implementation Phases

### Phase 1: Core Infrastructure
- Database schema and models
- Basic Express server with routes
- Frontend HTML/CSS structure

### Phase 2: Search & Discovery
- Cool18 scraper service
- Chapter/book detection
- Search API endpoint
- Frontend search UI

### Phase 3: Download Pipeline
- Download job management
- Concurrent download service
- Text processing
- Progress tracking (SSE)

### Phase 4: Joplin Integration
- Joplin API client
- Notebook/note creation
- Export functionality
- Duplicate checking

### Phase 5: File Upload (Entry B)
- File upload endpoint
- File type detection
- Raw file processing
- Integration with download pipeline

### Phase 6: Polish & Optimization
- Error handling improvements
- Performance optimization
- UI/UX enhancements
- Testing

