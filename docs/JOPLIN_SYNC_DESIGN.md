# Joplin Sync Feature - Design Document

## Overview

The Joplin Sync feature allows books in the Alex Library system to be automatically synchronized to Joplin when chunks are generated. This creates an organized folder structure in Joplin with proper tagging for easy navigation and search.

## Feature Requirements

1. **Book Configuration**: Each book can have a `sync_to_joplin` boolean field that enables/disables automatic syncing
2. **Folder Structure**: Creates a hierarchical structure in Joplin: `Books (root) > author > book`, with chunk notes stored directly under each book notebook
3. **Tagging**: Each chunk note is tagged with the author name for easy filtering
4. **Automatic Sync**: When chunks are generated and `sync_to_joplin` is enabled, chunks are automatically synced to Joplin
5. **Duplicate Prevention**: Checks for existing notes before creating new ones to avoid duplicates

## Database Schema

### Books Table

Added a new column to the `books` table:

```sql
sync_to_joplin INTEGER DEFAULT 0
```

-   `0` = Sync disabled (default)
-   `1` = Sync enabled

### Joplin Folders Table

Tracks Joplin folder/notebook structure locally:

```sql
CREATE TABLE IF NOT EXISTS joplin_folders (
  id TEXT PRIMARY KEY,                    -- Joplin folder ID
  title TEXT NOT NULL,                    -- Folder name
  parent_id TEXT,                         -- Parent folder ID (for hierarchy)
  created_time INTEGER,                   -- Joplin timestamp
  updated_time INTEGER,                   -- Joplin timestamp
  user_created_time INTEGER,
  user_updated_time INTEGER,
  encryption_cipher_text TEXT,
  encryption_applied INTEGER DEFAULT 0,
  is_shared INTEGER DEFAULT 0,
  type_ INTEGER DEFAULT 1,
  sync_status INTEGER DEFAULT 0,
  last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Joplin Notes Table

Tracks Joplin notes (chunks) locally:

```sql
CREATE TABLE IF NOT EXISTS joplin_notes (
  id TEXT PRIMARY KEY,                    -- Joplin note ID
  parent_id TEXT NOT NULL,                -- Parent folder ID
  title TEXT NOT NULL,                    -- Note title
  body TEXT,                              -- Note content (markdown)
  created_time INTEGER,                   -- Joplin timestamp
  updated_time INTEGER,                   -- Joplin timestamp
  user_created_time INTEGER,
  user_updated_time INTEGER,
  encryption_cipher_text TEXT,
  encryption_applied INTEGER DEFAULT 0,
  is_todo INTEGER DEFAULT 0,
  todo_due INTEGER,
  todo_completed INTEGER,
  source_url TEXT,
  source_application TEXT,
  application_data TEXT,
  order_ INTEGER DEFAULT 0,
  latitude REAL,
  longitude REAL,
  altitude REAL,
  author TEXT,
  source TEXT,
  size INTEGER DEFAULT 0,
  last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES joplin_folders(id) ON DELETE CASCADE
)
```

## Joplin Folder Structure

The sync feature now creates notes directly inside each book notebook. The hierarchy is:

```
📁 Books (configurable root, default: "Books")
  └── 📁 Author Name (Traditional Chinese)
      └── 📁 Book Name (Traditional Chinese)
          ├── 📄 Book Name(1-10)
          ├── 📄 Book Name(11-20)
          └── 📄 Book Name(21-25)
```

### Example

```
📁 Books
  └── 📁 金庸
      └── 📁 射鵰英雄傳
          ├── 📄 射鵰英雄傳(1-10)
          ├── 📄 射鵰英雄傳(11-20)
          └── 📄 射鵰英雄傳(21-25)
```

## Tagging Strategy

Each chunk note is tagged with:

1. **Author Name** (in Traditional Chinese)
    - Enables filtering all books by a specific author
    - Example: Tag "金庸" on all chunks from books by that author

### Tag Format

-   Tags use the author's name in Traditional Chinese
-   If author is missing or unknown, tag is skipped (not "未知作者")
-   Tags are created automatically if they don't exist

## Service Layer Architecture

### Joplin Service (`services/joplinService.js`)

#### Core Functions

1. **`syncChunksToJoplin(book, chunks)`**

    - Main entry point for syncing chunks
    - Creates/ensures `Books → Author → Book` structure
    - Deletes/recreates chunk notes directly inside the book notebook
    - Adds tags to notes
    - Updates book's `joplin_notebook_id` with the book notebook ID

2. **`createFolderStructure(author, bookName)`**

    - Creates three-level hierarchy: root (`Books`) > author > book
    - Returns IDs for each level (root, author, book)
    - Uses Traditional Chinese for folder names

3. **`findOrCreateNotebook(title, parentId)`**

    - Searches for existing notebook by title and parent
    - Creates new notebook if not found
    - Returns notebook ID

4. **`findOrCreateTag(tagTitle)`**

    - Searches for existing tag by title
    - Creates new tag if not found
    - Returns tag ID

5. **`createNote(title, body, parentId, tags)`**

    - Creates a note in specified notebook
    - Adds tags to the note
    - Returns note ID

6. **`findNoteByTitle(title, parentId)`**
    - Searches for existing note in a notebook
    - Used for duplicate prevention
    - Returns note ID or null

#### API Communication

The service uses Joplin's REST API:

-   **Base URL**: `JOPLIN_API_URL` (default: `http://localhost:41184`)
-   **Authentication**: Bearer token via `JOPLIN_API_TOKEN`
-   **Endpoints**:
    -   `GET /folders` - List all folders
    -   `POST /folders` - Create folder
    -   `GET /folders/{id}/notes` - List notes in folder
    -   `POST /notes` - Create note
    -   `GET /tags` - List all tags
    -   `POST /tags` - Create tag
    -   `POST /tags/{id}/notes` - Add tag to note

## Sync Flow

### Automatic Sync Trigger

1. User enables `sync_to_joplin` on a book (via API or UI)
2. User generates chunks for the book
3. After chunk generation completes successfully:
    - System checks if `sync_to_joplin` is enabled
    - If enabled, automatically triggers sync to Joplin

### Sync Process

```
┌─────────────────────────────────────┐
│  Chunk Generation Completes         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Check sync_to_joplin flag          │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │             │
       Yes           No
        │             │
        ▼             ▼
┌──────────────┐  ┌──────────────┐
│ Start Sync   │  │   Skip Sync  │
└──────┬───────┘  └──────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Convert author/book to Traditional │
│  Chinese                            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Create Folder Structure:           │
│  - Books root folder                │
│  - Author folder (under Books)      │
│  - Book folder (under author)       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  For each chunk:                    │
│  - Check if note exists             │
│  - Create note if not exists        │
│  - Add author tag to note           │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Update book.joplin_notebook_id     │
│  with book folder ID                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Log sync results                   │
└─────────────────────────────────────┘
```

> **Auto chunk build:** If a book is flagged for Joplin sync but has no generated chunks, the sync job automatically queues chunk generation, waits for it to finish, and only then uploads the chunk notes.

### Error Handling

-   **Sync failures do not fail chunk generation**: If sync fails, chunk job still completes successfully
-   **Individual chunk failures**: If one chunk fails to sync, others continue
-   **Tag failures**: If tag creation/addition fails, note is still created (warning logged)
-   **All errors are logged** with context for debugging

## API Endpoints

### Book Creation/Update

**POST `/api/books`**

```json
{
    "book_name_simplified": "射雕英雄传",
    "book_name_traditional": "射鵰英雄傳",
    "author": "金庸",
    "sync_to_joplin": true
}
```

**PUT `/api/books/:id`**

```json
{
    "sync_to_joplin": true
}
```

### Chunk Generation

**POST `/api/chunks/books/:bookId/generate`**

When chunks are generated and `sync_to_joplin` is enabled, sync happens automatically in the background.

## Configuration

### Environment Variables

```env
JOPLIN_API_URL=http://localhost:41184
JOPLIN_API_TOKEN=your_token_here
```

### Getting Joplin API Token

1. Open Joplin desktop app
2. Go to Tools > Options > Web Clipper
3. Enable Web Clipper service
4. Copy the authorization token
5. Add to `.env` file

## Data Flow

### Book Creation

```
User creates book with sync_to_joplin=true
  ↓
Book stored in database with sync_to_joplin=1
  ↓
Chunks generated
  ↓
Sync triggered automatically
```

### Chunk Sync

```
Chunk generation completes
  ↓
Fetch chunks from database
  ↓
Ensure `Books → Author → Book` structure exists
  ↓
For each chunk:
  - Create note inside book notebook
  - Add author tag
  ↓
Update book.joplin_notebook_id
```

## Character Encoding

-   **Database**: Stores Simplified Chinese for book names
-   **Joplin**: Uses Traditional Chinese for display
-   **Conversion**: Automatic conversion using `converter.toTraditional()`
-   **Author names**: Converted to Traditional Chinese for folders and tags

## Duplicate Prevention

1. **Folders**: Checks for existing folder by title and parent ID before creating
2. **Notes**: Checks for existing note by title in parent folder before creating
3. **Tags**: Checks for existing tag by title before creating

This ensures idempotent operations - running sync multiple times won't create duplicates.

## Future Enhancements

### Potential Improvements

1. **Manual Sync Endpoint**: Add endpoint to manually trigger sync for existing chunks
2. **Sync Status Tracking**: Track sync status per chunk in database
3. **Incremental Sync**: Only sync new/updated chunks
4. **Sync History**: Log sync operations for audit trail
5. **Conflict Resolution**: Handle cases where Joplin notes are modified externally
6. **Bulk Operations**: Sync multiple books at once
7. **Sync Scheduling**: Schedule periodic syncs
8. **Two-way Sync**: Sync changes from Joplin back to system

### Database Enhancements

The `joplin_folders` and `joplin_notes` tables are created for future use:

-   Track sync status
-   Store Joplin metadata
-   Enable incremental syncs
-   Support two-way synchronization

## Testing Considerations

### Test Scenarios

1. **New Book Sync**: Create book with `sync_to_joplin=true`, generate chunks, verify sync
2. **Existing Book Enable**: Enable sync on existing book, verify chunks sync
3. **Duplicate Prevention**: Run sync twice, verify no duplicates created
4. **Error Handling**: Test with invalid Joplin API token, verify graceful failure
5. **Missing Author**: Test sync with book without author, verify folder structure still works
6. **Large Books**: Test with books having many chunks
7. **Special Characters**: Test with author/book names containing special characters

### Manual Testing

1. Enable `sync_to_joplin` on a test book
2. Generate chunks
3. Check Joplin for folder structure: `Books → author → book`
4. Verify chunk notes are created with correct titles
5. Verify author tag is applied to all chunk notes
6. Verify no duplicates on re-sync

## Troubleshooting

### Common Issues

1. **Sync not happening**

    - Check `sync_to_joplin` is set to `1` in database
    - Check Joplin API is accessible
    - Check API token is valid
    - Check logs for errors

2. **Folders not created**

    - Verify Joplin API token has write permissions
    - Check network connectivity to Joplin
    - Review error logs

3. **Tags not appearing**

    - Tags may take time to appear in Joplin UI
    - Verify tag creation in logs
    - Check Joplin tag list manually

4. **Duplicate notes**
    - Should not happen due to duplicate prevention
    - If occurs, check `findNoteByTitle` logic
    - May need to clean up manually in Joplin

## Related Files

-   `models/database.js` - Database schema and migrations
-   `models/book.js` - Book model with sync_to_joplin support
-   `services/joplinService.js` - Joplin API integration
-   `routes/books.js` - Book API endpoints
-   `routes/chunks.js` - Chunk generation and sync trigger
-   `services/converter.js` - Traditional Chinese conversion

## References

-   [Joplin API Documentation](https://joplinapp.org/api/)
-   [Joplin Web Clipper Setup](https://joplinapp.org/clipper/)
