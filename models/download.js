const { getDatabase } = require('./database');

class DownloadJob {
  static async create(bookId, totalChapters) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO download_jobs (book_id, status, total_chapters, completed_chapters, failed_chapters)
        VALUES (?, 'queued', ?, 0, 0)
      `;
      db.run(sql, [bookId, totalChapters], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  static async findById(id) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM download_jobs WHERE id = ?', [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  static async updateStatus(id, status) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = status === 'completed' || status === 'failed'
        ? `UPDATE download_jobs SET status = ?, completed_at = datetime('now') WHERE id = ?`
        : `UPDATE download_jobs SET status = ? WHERE id = ?`;
      
      db.run(sql, [status, id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  static async updateProgress(id, completed, failed) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE download_jobs 
        SET completed_chapters = ?, failed_chapters = ?
        WHERE id = ?
      `;
      db.run(sql, [completed, failed, id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  static async incrementCompleted(id) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE download_jobs SET completed_chapters = completed_chapters + 1 WHERE id = ?',
        [id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  static async incrementFailed(id) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE download_jobs SET failed_chapters = failed_chapters + 1 WHERE id = ?',
        [id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }
}

module.exports = DownloadJob;

