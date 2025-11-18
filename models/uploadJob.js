const { getDatabase } = require("./database");

class UploadJob {
    static async create(filename, originalName, filePath, fileSize, analysisData = null) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO upload_jobs (
                    filename,
                    original_name,
                    file_path,
                    file_size,
                    status,
                    analysis_data,
                    created_at
                )
                VALUES (?, ?, ?, ?, 'waiting_for_input', ?, datetime('now'))
            `;
            const analysisDataJson = analysisData ? JSON.stringify(analysisData) : null;
            db.run(sql, [filename, originalName, filePath, fileSize, analysisDataJson], function (err) {
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
            db.get("SELECT * FROM upload_jobs WHERE id = ?", [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (row) {
                        if (row.analysis_data) {
                            try {
                                row.analysis_data = JSON.parse(row.analysis_data);
                            } catch (e) {
                                row.analysis_data = null;
                            }
                        }
                        if (row.book_metadata) {
                            try {
                                row.book_metadata = JSON.parse(row.book_metadata);
                            } catch (e) {
                                row.book_metadata = null;
                            }
                        }
                    }
                    resolve(row);
                }
            });
        });
    }

    static async findAllByStatus(status, limit = 50) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM upload_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                [status, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const results = rows.map(row => {
                            if (row.analysis_data) {
                                try {
                                    row.analysis_data = JSON.parse(row.analysis_data);
                                } catch (e) {
                                    row.analysis_data = null;
                                }
                            }
                            if (row.book_metadata) {
                                try {
                                    row.book_metadata = JSON.parse(row.book_metadata);
                                } catch (e) {
                                    row.book_metadata = null;
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

    static async findAll(limit = 50) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM upload_jobs ORDER BY created_at DESC LIMIT ?",
                [limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const results = rows.map(row => {
                            if (row.analysis_data) {
                                try {
                                    row.analysis_data = JSON.parse(row.analysis_data);
                                } catch (e) {
                                    row.analysis_data = null;
                                }
                            }
                            if (row.book_metadata) {
                                try {
                                    row.book_metadata = JSON.parse(row.book_metadata);
                                } catch (e) {
                                    row.book_metadata = null;
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
        if (updates.analysis_data !== undefined) {
            fields.push("analysis_data = ?");
            values.push(JSON.stringify(updates.analysis_data));
        }
        if (updates.book_id !== undefined) {
            fields.push("book_id = ?");
            values.push(updates.book_id);
        }
        if (updates.book_metadata !== undefined) {
            fields.push("book_metadata = ?");
            values.push(JSON.stringify(updates.book_metadata));
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

        const sql = `UPDATE upload_jobs SET ${fields.join(", ")} WHERE id = ?`;
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
            db.run("DELETE FROM upload_jobs WHERE id = ?", [id], function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }
}

module.exports = UploadJob;

