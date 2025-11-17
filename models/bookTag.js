const { getDatabase } = require('./database');

class BookTag {
  static async add(bookId, tag) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = 'INSERT OR IGNORE INTO book_tags (book_id, tag) VALUES (?, ?)';
      db.run(sql, [bookId, tag], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  static async addMultiple(bookId, tags) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag) VALUES (?, ?)');
        
        tags.forEach(tag => {
          stmt.run([bookId, tag]);
        });
        
        stmt.finalize((err) => {
          if (err) {
            db.run('ROLLBACK');
            reject(err);
          } else {
            db.run('COMMIT', (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          }
        });
      });
    });
  }

  static async findByBookId(bookId) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.all('SELECT tag FROM book_tags WHERE book_id = ?', [bookId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(row => row.tag));
        }
      });
    });
  }

  static async remove(bookId, tag) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM book_tags WHERE book_id = ? AND tag = ?', [bookId, tag], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }
}

module.exports = BookTag;

