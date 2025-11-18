const { getDatabase } = require("./database");

class BookSearchJob {
    static async create(bookId, searchParams = {}, autoJob = false) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO book_search_jobs (
                    book_id,
                    search_type,
                    status,
                    search_params,
                    auto_job,
                    created_at
                )
                VALUES (?, 'new', 'queued', ?, ?, datetime('now'))
            `;
            const searchParamsJson = JSON.stringify(searchParams);
            db.run(sql, [bookId, searchParamsJson, autoJob ? 1 : 0], function (err) {
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
            db.get("SELECT * FROM book_search_jobs WHERE id = ?", [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (row && row.search_params) {
                        try {
                            row.search_params = JSON.parse(row.search_params);
                        } catch (e) {
                            row.search_params = {};
                        }
                    }
                    if (row && row.results) {
                        try {
                            row.results = JSON.parse(row.results);
                        } catch (e) {
                            row.results = null;
                        }
                    }
                    resolve(row);
                }
            });
        });
    }

    static async findByBookId(bookId, limit = 10) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM book_search_jobs WHERE book_id = ? ORDER BY created_at DESC LIMIT ?",
                [bookId, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const results = rows.map(row => {
                            if (row.search_params) {
                                try {
                                    row.search_params = JSON.parse(row.search_params);
                                } catch (e) {
                                    row.search_params = {};
                                }
                            }
                            if (row.results) {
                                try {
                                    row.results = JSON.parse(row.results);
                                } catch (e) {
                                    row.results = null;
                                }
                            }
                            return row;
                        });
                        resolve(results);
                    }
                }
            );
        });
    }

    static async findAllByStatus(status, limit = 50) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM book_search_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                [status, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const results = rows.map(row => {
                            if (row.search_params) {
                                try {
                                    row.search_params = JSON.parse(row.search_params);
                                } catch (e) {
                                    row.search_params = {};
                                }
                            }
                            if (row.results) {
                                try {
                                    row.results = JSON.parse(row.results);
                                } catch (e) {
                                    row.results = null;
                                }
                            }
                            return row;
                        });
                        resolve(results);
                    }
                }
            );
        });
    }

    static async update(id, updates) {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (updates.status !== undefined) {
            fields.push("status = ?");
            values.push(updates.status);
        }
        if (updates.results !== undefined) {
            fields.push("results = ?");
            values.push(JSON.stringify(updates.results));
        }
        if (updates.search_result_id !== undefined) {
            fields.push("search_result_id = ?");
            values.push(updates.search_result_id);
        }
        if (updates.error_message !== undefined) {
            fields.push("error_message = ?");
            values.push(updates.error_message);
        }
        if (updates.started_at !== undefined) {
            fields.push("started_at = ?");
            values.push(updates.started_at);
        }
        if (updates.completed_at !== undefined) {
            fields.push("completed_at = ?");
            values.push(updates.completed_at);
        }

        if (fields.length === 0) {
            return Promise.resolve(0);
        }

        values.push(id);

        const sql = `UPDATE book_search_jobs SET ${fields.join(", ")} WHERE id = ?`;
        return new Promise((resolve, reject) => {
            db.run(sql, values, function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    static async delete(id) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM book_search_jobs WHERE id = ?", [id], function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }
}

module.exports = BookSearchJob;

