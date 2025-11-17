const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/books.db');

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
        logger.error('Error opening database', { err });
      } else {
        logger.info('Connected to SQLite database', { path: DB_PATH });
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
      database.run(`
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
          source_url TEXT
        )
      `, (err) => {
        if (err) {
          logger.error('Error creating books table', { err });
          reject(err);
          return;
        }
        // Add new columns if they don't exist (migration)
        database.run(`ALTER TABLE books ADD COLUMN author TEXT`, () => { });
        database.run(`ALTER TABLE books ADD COLUMN category TEXT`, () => { });
        database.run(`ALTER TABLE books ADD COLUMN description TEXT`, () => { });
        database.run(`ALTER TABLE books ADD COLUMN source_url TEXT`, () => { });
      });

      // Create chapters table
      database.run(`
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
      `, (err) => {
        if (err) {
          logger.error('Error creating chapters table', { err });
          reject(err);
          return;
        }
      });

      // Create download_jobs table
      database.run(`
        CREATE TABLE IF NOT EXISTS download_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER,
          status TEXT DEFAULT 'queued',
          total_chapters INTEGER,
          completed_chapters INTEGER DEFAULT 0,
          failed_chapters INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
        )
      `, (err) => {
        if (err) {
          logger.error('Error creating download_jobs table', { err });
          reject(err);
          return;
        }
      });

      // Create book_tags table
      database.run(`
        CREATE TABLE IF NOT EXISTS book_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          tag TEXT NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          UNIQUE(book_id, tag)
        )
      `, (err) => {
        if (err) {
          logger.error('Error creating book_tags table', { err });
          reject(err);
          return;
        }
      });

      // Create search_results table
      database.run(`
        CREATE TABLE IF NOT EXISTS search_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          keyword TEXT NOT NULL,
          pages INTEGER DEFAULT 3,
          results TEXT NOT NULL,
          total_results INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          logger.error('Error creating search_results table', { err });
          reject(err);
          return;
        }
        logger.info('Database initialized successfully');
        resolve();
      });

      // Create indexes for better performance
      database.run(`CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(status)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_chapters_cool18_url ON chapters(cool18_url)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_book_tags_book_id ON book_tags(book_id)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_search_results_keyword ON search_results(keyword)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_search_results_created_at ON search_results(created_at)`);
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
  closeDatabase
};

