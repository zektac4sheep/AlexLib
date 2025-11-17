const { getDatabase } = require('./database');

class DownloadJob {
  static async create(bookId, totalChapters, chaptersData = null) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO download_jobs (book_id, status, total_chapters, completed_chapters, failed_chapters, chapters_data)
        VALUES (?, 'queued', ?, 0, 0, ?)
      `;
      const chaptersDataJson = chaptersData ? JSON.stringify(chaptersData) : null;
      db.run(sql, [bookId, totalChapters, chaptersDataJson], function(err) {
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
          if (row) {
            // Parse chapters_data JSON
            row.chapters_data = row.chapters_data ? JSON.parse(row.chapters_data) : null;
          }
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

  static async findAll(limit = 100, offset = 0) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM download_jobs 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `;
      db.all(sql, [limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Parse chapters_data JSON
          const jobs = rows.map(row => ({
            ...row,
            chapters_data: row.chapters_data ? JSON.parse(row.chapters_data) : null
          }));
          resolve(jobs);
        }
      });
    });
  }

  static async findAllByStatus(status, limit = 50) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM download_jobs 
        WHERE status = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `;
      db.all(sql, [status, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Parse chapters_data JSON
          const jobs = rows.map(row => ({
            ...row,
            chapters_data: row.chapters_data ? JSON.parse(row.chapters_data) : null
          }));
          resolve(jobs);
        }
      });
    });
  }

  static async findByBookId(bookId) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM download_jobs 
        WHERE book_id = ? 
        ORDER BY created_at DESC
      `;
      db.all(sql, [bookId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Parse chapters_data JSON
          const jobs = rows.map(row => ({
            ...row,
            chapters_data: row.chapters_data ? JSON.parse(row.chapters_data) : null
          }));
          resolve(jobs);
        }
      });
    });
  }

  static async delete(id) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.run("DELETE FROM download_jobs WHERE id = ?", [id], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }
}

module.exports = DownloadJob;

