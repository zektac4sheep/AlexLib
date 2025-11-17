const { getDatabase } = require("./database");

class ChunkJob {
    static async create(bookId, chunkSize = 1000) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO chunk_jobs (
                    book_id,
                    status,
                    chunk_size,
                    created_at
                )
                VALUES (?, 'queued', ?, datetime('now'))
            `;
            db.run(sql, [bookId, chunkSize], function (err) {
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
            db.get("SELECT * FROM chunk_jobs WHERE id = ?", [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    static async findByBookId(bookId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get(
                "SELECT * FROM chunk_jobs WHERE book_id = ? ORDER BY created_at DESC LIMIT 1",
                [bookId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row);
                    }
                }
            );
        });
    }

    static async findAllByStatus(status) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM chunk_jobs WHERE status = ? ORDER BY created_at DESC",
                [status],
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

    static async update(id, updates) {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (updates.status !== undefined) {
            fields.push("status = ?");
            values.push(updates.status);
        }
        if (updates.chunks_data !== undefined) {
            fields.push("chunks_data = ?");
            values.push(JSON.stringify(updates.chunks_data));
        }
        if (updates.total_chunks !== undefined) {
            fields.push("total_chunks = ?");
            values.push(updates.total_chunks);
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
        if (updates.completed_items !== undefined) {
            fields.push("completed_items = ?");
            values.push(updates.completed_items);
        }
        if (updates.total_items !== undefined) {
            fields.push("total_items = ?");
            values.push(updates.total_items);
        }

        if (fields.length === 0) {
            return Promise.resolve(0);
        }

        values.push(id);

        const sql = `UPDATE chunk_jobs SET ${fields.join(", ")} WHERE id = ?`;
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
            db.run("DELETE FROM chunk_jobs WHERE id = ?", [id], function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }
}

module.exports = ChunkJob;

