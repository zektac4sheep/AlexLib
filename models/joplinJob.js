const { getDatabase } = require("./database");

class JoplinJob {
    static async create(jobType, apiUrl, apiToken, configData = {}) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO joplin_jobs (
                    job_type,
                    status,
                    api_url,
                    api_token,
                    config_data,
                    created_at
                )
                VALUES (?, 'queued', ?, ?, ?, datetime('now'))
            `;
            const configDataJson = JSON.stringify(configData);
            db.run(sql, [jobType, apiUrl, apiToken, configDataJson], function (err) {
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
            db.get("SELECT * FROM joplin_jobs WHERE id = ?", [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (row) {
                        row.config_data = row.config_data ? JSON.parse(row.config_data) : null;
                        row.progress_data = row.progress_data ? JSON.parse(row.progress_data) : null;
                    }
                    resolve(row);
                }
            });
        });
    }

    static async findAll(limit = 50) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM joplin_jobs ORDER BY created_at DESC LIMIT ?",
                [limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const jobs = rows.map((row) => ({
                            ...row,
                            config_data: row.config_data ? JSON.parse(row.config_data) : null,
                            progress_data: row.progress_data ? JSON.parse(row.progress_data) : null,
                        }));
                        resolve(jobs);
                    }
                }
            );
        });
    }

    static async findByStatus(status) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM joplin_jobs WHERE status = ? ORDER BY created_at DESC",
                [status],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const jobs = rows.map((row) => ({
                            ...row,
                            config_data: row.config_data ? JSON.parse(row.config_data) : null,
                            progress_data: row.progress_data ? JSON.parse(row.progress_data) : null,
                        }));
                        resolve(jobs);
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
        if (updates.progress_data !== undefined) {
            fields.push("progress_data = ?");
            values.push(JSON.stringify(updates.progress_data));
        }
        if (updates.total_items !== undefined) {
            fields.push("total_items = ?");
            values.push(updates.total_items);
        }
        if (updates.completed_items !== undefined) {
            fields.push("completed_items = ?");
            values.push(updates.completed_items);
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

        const sql = `UPDATE joplin_jobs SET ${fields.join(", ")} WHERE id = ?`;
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
            db.run("DELETE FROM joplin_jobs WHERE id = ?", [id], function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }
}

module.exports = JoplinJob;

