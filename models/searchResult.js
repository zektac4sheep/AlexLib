const { getDatabase } = require('./database');

class SearchResult {
  /**
   * Create a new search result record
   * @param {string} keyword - Search keyword
   * @param {number} pages - Number of pages searched
   * @param {Array} results - Array of thread results
   * @returns {Promise<number>} - ID of the created record
   */
  static async create(keyword, pages, results) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO search_results (keyword, pages, results, total_results)
        VALUES (?, ?, ?, ?)
      `;
      const resultsJson = JSON.stringify(results);
      db.run(sql, [keyword, pages, resultsJson, results.length], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  /**
   * Find search result by ID
   * @param {number} id - Search result ID
   * @returns {Promise<Object|null>} - Search result object or null
   */
  static async findById(id) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM search_results WHERE id = ?', [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            row.results = JSON.parse(row.results);
          }
          resolve(row);
        }
      });
    });
  }

  /**
   * Find search results by keyword
   * @param {string} keyword - Search keyword
   * @param {number} limit - Maximum number of results to return
   * @returns {Promise<Array>} - Array of search result objects
   */
  static async findByKeyword(keyword, limit = 10) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM search_results WHERE keyword = ? ORDER BY created_at DESC LIMIT ?',
        [keyword, limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const results = rows.map(row => {
              row.results = JSON.parse(row.results);
              return row;
            });
            resolve(results);
          }
        }
      );
    });
  }

  /**
   * Get all search results, ordered by most recent
   * @param {number} limit - Maximum number of results to return
   * @returns {Promise<Array>} - Array of search result objects
   */
  static async findAll(limit = 50) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM search_results ORDER BY created_at DESC LIMIT ?',
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const results = rows.map(row => {
              row.results = JSON.parse(row.results);
              return row;
            });
            resolve(results);
          }
        }
      );
    });
  }

  /**
   * Delete search result by ID
   * @param {number} id - Search result ID
   * @returns {Promise<number>} - Number of rows deleted
   */
  static async delete(id) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM search_results WHERE id = ?', [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * Get recent search keywords (unique)
   * @param {number} limit - Maximum number of keywords to return
   * @returns {Promise<Array>} - Array of unique keywords
   */
  static async getRecentKeywords(limit = 20) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT DISTINCT keyword, MAX(created_at) as last_searched
         FROM search_results 
         GROUP BY keyword 
         ORDER BY last_searched DESC 
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }
}

module.exports = SearchResult;

