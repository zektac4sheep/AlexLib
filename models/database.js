const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../data/books.db");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

function getDatabase() {
    if (!db) {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                logger.error("Error opening database", { err });
            } else {
                logger.info("Connected to SQLite database", { path: DB_PATH });
            }
        });
    }
    return db;
}

function initializeDatabase() {
    const database = getDatabase();

    return new Promise((resolve, reject) => {
        database.serialize(() => {
            // Create books table
            database.run(
                `
        CREATE TABLE IF NOT EXISTS books (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_name_simplified TEXT NOT NULL UNIQUE,
          book_name_traditional TEXT,
          joplin_notebook_id TEXT,
          total_chapters INTEGER DEFAULT 0,
          last_updated DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          author TEXT,
          category TEXT,
          description TEXT,
          source_url TEXT,
          sync_to_joplin INTEGER DEFAULT 0
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating books table", { err });
                        reject(err);
                        return;
                    }
                    // Add new columns if they don't exist (migration)
                    database.run(
                        `ALTER TABLE books ADD COLUMN author TEXT`,
                        () => {}
                    );
                    database.run(
                        `ALTER TABLE books ADD COLUMN category TEXT`,
                        () => {}
                    );
                    database.run(
                        `ALTER TABLE books ADD COLUMN description TEXT`,
                        () => {}
                    );
                    database.run(
                        `ALTER TABLE books ADD COLUMN source_url TEXT`,
                        () => {}
                    );
                    database.run(
                        `ALTER TABLE books ADD COLUMN rating INTEGER DEFAULT 0`,
                        () => {}
                    );
                    database.run(
                        `ALTER TABLE books ADD COLUMN sync_to_joplin INTEGER DEFAULT 0`,
                        () => {}
                    );
                    database.run(
                        `ALTER TABLE books ADD COLUMN auto_search INTEGER DEFAULT 0`,
                        () => {}
                    );
                    database.run(
                        `ALTER TABLE books ADD COLUMN last_search_datetime DATETIME`,
                        () => {}
                    );
                }
            );

            // Create chapters table
            database.run(
                `
        CREATE TABLE IF NOT EXISTS chapters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          chapter_number INTEGER,
          chapter_title TEXT,
          chapter_title_simplified TEXT,
          cool18_url TEXT,
          cool18_thread_id TEXT,
          content TEXT,
          line_start INTEGER,
          line_end INTEGER,
          downloaded_at DATETIME,
          status TEXT DEFAULT 'pending',
          joplin_note_id TEXT,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          UNIQUE(book_id, chapter_number)
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating chapters table", { err });
                        reject(err);
                        return;
                    }
                    // Add chapter_name column if it doesn't exist (migration)
                    database.run(
                        `ALTER TABLE chapters ADD COLUMN chapter_name TEXT`,
                        () => {}
                    );
                    // Add job_id column if it doesn't exist (migration)
                    database.run(
                        `ALTER TABLE chapters ADD COLUMN job_id INTEGER`,
                        (alterErr) => {
                            // Ignore error if column already exists
                            if (
                                alterErr &&
                                !alterErr.message.includes("duplicate column")
                            ) {
                                logger.warn(
                                    "Error adding job_id column to chapters",
                                    {
                                        err: alterErr,
                                    }
                                );
                            }
                        }
                    );
                }
            );

            // Create download_jobs table
            database.run(
                `
        CREATE TABLE IF NOT EXISTS download_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER,
          status TEXT DEFAULT 'queued',
          total_chapters INTEGER,
          completed_chapters INTEGER DEFAULT 0,
          failed_chapters INTEGER DEFAULT 0,
          chapters_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating download_jobs table", {
                            err,
                        });
                        reject(err);
                        return;
                    }
                    // Add chapters_data column if it doesn't exist (migration)
                    database.run(
                        `ALTER TABLE download_jobs ADD COLUMN chapters_data TEXT`,
                        (alterErr) => {
                            // Ignore error if column already exists
                            if (
                                alterErr &&
                                !alterErr.message.includes("duplicate column")
                            ) {
                                logger.warn(
                                    "Error adding chapters_data column",
                                    {
                                        err: alterErr,
                                    }
                                );
                            }
                        }
                    );
                }
            );

            // Create book_tags table
            database.run(
                `
        CREATE TABLE IF NOT EXISTS book_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          tag TEXT NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          UNIQUE(book_id, tag)
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating book_tags table", { err });
                        reject(err);
                        return;
                    }
                }
            );

            // Create book_authors table
            database.run(
                `
        CREATE TABLE IF NOT EXISTS book_authors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          author TEXT NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          UNIQUE(book_id, author)
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating book_authors table", {
                            err,
                        });
                        reject(err);
                        return;
                    }
                    // Migrate existing author data from books.author to book_authors
                    database.all(
                        "SELECT id, author FROM books WHERE author IS NOT NULL AND author != ''",
                        [],
                        (err, rows) => {
                            if (!err && rows) {
                                rows.forEach((row) => {
                                    if (row.author) {
                                        // Insert author into book_authors, ignoring duplicates
                                        database.run(
                                            "INSERT OR IGNORE INTO book_authors (book_id, author) VALUES (?, ?)",
                                            [row.id, row.author],
                                            (insertErr) => {
                                                if (insertErr) {
                                                    logger.warn(
                                                        "Error migrating author to book_authors",
                                                        {
                                                            bookId: row.id,
                                                            author: row.author,
                                                            error: insertErr,
                                                        }
                                                    );
                                                }
                                            }
                                        );
                                    }
                                });
                            }
                        }
                    );
                }
            );

            // Create search_results table
            database.run(
                `
        CREATE TABLE IF NOT EXISTS search_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          keyword TEXT NOT NULL,
          pages INTEGER DEFAULT 3,
          results TEXT NOT NULL,
          total_results INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating search_results table", {
                            err,
                        });
                        reject(err);
                        return;
                    }
                }
            );

            // Create chunk_jobs table
            database.run(
                `
        CREATE TABLE IF NOT EXISTS chunk_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          status TEXT DEFAULT 'queued',
          chunk_size INTEGER DEFAULT 1000,
          chunks_data TEXT,
          total_chunks INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          error_message TEXT,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating chunk_jobs table", {
                            err,
                        });
                        reject(err);
                        return;
                    }
                }
            );

            // Create chunks table
            database.run(
                `
        CREATE TABLE IF NOT EXISTS chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chunk_job_id INTEGER NOT NULL,
          book_id INTEGER NOT NULL,
          chunk_number INTEGER NOT NULL,
          total_chunks INTEGER NOT NULL,
          content TEXT NOT NULL,
          line_start INTEGER NOT NULL,
          line_end INTEGER NOT NULL,
          first_chapter INTEGER,
          last_chapter INTEGER,
          chapter_count INTEGER DEFAULT 0,
          chapters_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (chunk_job_id) REFERENCES chunk_jobs(id) ON DELETE CASCADE,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          UNIQUE(chunk_job_id, chunk_number)
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating chunks table", {
                            err,
                        });
                        reject(err);
                        return;
                    }
                    logger.info("Database initialized successfully");
                    resolve();
                }
            );

            // Create indexes for better performance
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(status)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_chapters_cool18_url ON chapters(cool18_url)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_book_tags_book_id ON book_tags(book_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_book_authors_book_id ON book_authors(book_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_search_results_keyword ON search_results(keyword)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_search_results_created_at ON search_results(created_at)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_chunk_jobs_book_id ON chunk_jobs(book_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_chunk_jobs_status ON chunk_jobs(status)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_chunks_chunk_job_id ON chunks(chunk_job_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_chunks_book_id ON chunks(book_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_chunks_chunk_number ON chunks(chunk_job_id, chunk_number)`
            );

            // Create joplin_folders table for syncing Joplin folder structure
            database.run(
                `
        CREATE TABLE IF NOT EXISTS joplin_folders (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          parent_id TEXT,
          created_time INTEGER,
          updated_time INTEGER,
          user_created_time INTEGER,
          user_updated_time INTEGER,
          encryption_cipher_text TEXT,
          encryption_applied INTEGER DEFAULT 0,
          is_shared INTEGER DEFAULT 0,
          type_ INTEGER DEFAULT 1,
          sync_status INTEGER DEFAULT 0,
          last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating joplin_folders table", {
                            err,
                        });
                    }
                }
            );

            // Create joplin_notes table for syncing Joplin notes
            database.run(
                `
        CREATE TABLE IF NOT EXISTS joplin_notes (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          created_time INTEGER,
          updated_time INTEGER,
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
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating joplin_notes table", {
                            err,
                        });
                    }
                }
            );

            // Create source_joplin_folders table for mirrored source structure
            database.run(
                `
        CREATE TABLE IF NOT EXISTS source_joplin_folders (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          parent_id TEXT,
          created_time INTEGER,
          updated_time INTEGER,
          user_created_time INTEGER,
          user_updated_time INTEGER,
          encryption_cipher_text TEXT,
          encryption_applied INTEGER DEFAULT 0,
          is_shared INTEGER DEFAULT 0,
          type_ INTEGER DEFAULT 1,
          sync_status INTEGER DEFAULT 0,
          note_count INTEGER DEFAULT 0,
          last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating source_joplin_folders table", {
                            err,
                        });
                    }
                }
            );

            // Create source_joplin_notes table for mirrored source notes
            database.run(
                `
        CREATE TABLE IF NOT EXISTS source_joplin_notes (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          created_time INTEGER,
          updated_time INTEGER,
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
          FOREIGN KEY (parent_id) REFERENCES source_joplin_folders(id) ON DELETE CASCADE
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating source_joplin_notes table", {
                            err,
                        });
                    }
                }
            );

            // Create joplin_jobs table for tracking background Joplin operations
            database.run(
                `
        CREATE TABLE IF NOT EXISTS joplin_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_type TEXT NOT NULL,
          status TEXT DEFAULT 'queued',
          api_url TEXT,
          api_token TEXT,
          config_data TEXT,
          progress_data TEXT,
          total_items INTEGER DEFAULT 0,
          completed_items INTEGER DEFAULT 0,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating joplin_jobs table", {
                            err,
                        });
                    }
                }
            );

            // Create app_settings table for storing config values
            database.run(
                `
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          encrypted INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating app_settings table", { err });
                    }
                }
            );

            // Create book_search_jobs table for tracking background book search operations
            database.run(
                `
        CREATE TABLE IF NOT EXISTS book_search_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          search_type TEXT NOT NULL,
          status TEXT DEFAULT 'queued',
          search_params TEXT,
          results TEXT,
          search_result_id INTEGER,
          error_message TEXT,
          auto_job INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          FOREIGN KEY (search_result_id) REFERENCES search_results(id) ON DELETE SET NULL
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating book_search_jobs table", {
                            err,
                        });
                    } else {
                        // Add auto_job column if it doesn't exist (migration)
                        database.run(
                            `ALTER TABLE book_search_jobs ADD COLUMN auto_job INTEGER DEFAULT 0`,
                            () => {}
                        );
                    }
                }
            );

            // Create upload_jobs table for tracking file upload processing
            database.run(
                `
        CREATE TABLE IF NOT EXISTS upload_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          original_name TEXT,
          file_path TEXT,
          file_size INTEGER,
          status TEXT DEFAULT 'waiting_for_input',
          analysis_data TEXT,
          book_id INTEGER,
          book_metadata TEXT,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
        )
      `,
                (err) => {
                    if (err) {
                        logger.error("Error creating upload_jobs table", {
                            err,
                        });
                    }
                }
            );

            // Create indexes for Joplin tables
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_joplin_folders_parent_id ON joplin_folders(parent_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_joplin_notes_parent_id ON joplin_notes(parent_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_joplin_notes_updated_time ON joplin_notes(updated_time)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_source_joplin_folders_parent_id ON source_joplin_folders(parent_id)`
            );
            
            // Add note_count column if it doesn't exist (migration for existing databases)
            database.run(
                `ALTER TABLE source_joplin_folders ADD COLUMN note_count INTEGER DEFAULT 0`,
                (err) => {
                    // Ignore error if column already exists
                    if (err && !err.message.includes("duplicate column")) {
                        logger.error("Error adding note_count column", { err });
                    }
                }
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_source_joplin_notes_parent_id ON source_joplin_notes(parent_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_source_joplin_notes_updated_time ON source_joplin_notes(updated_time)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_joplin_jobs_status ON joplin_jobs(status)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_joplin_jobs_job_type ON joplin_jobs(job_type)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_book_search_jobs_book_id ON book_search_jobs(book_id)`
            );
            database.run(
                `CREATE INDEX IF NOT EXISTS idx_book_search_jobs_status ON book_search_jobs(status)`
            );
        });
    });
}

function closeDatabase() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    db = null;
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

module.exports = {
    getDatabase,
    initializeDatabase,
    closeDatabase,
};
