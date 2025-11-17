const { getDatabase } = require("./database");

class Chunk {
    static async create(chunkData) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO chunks (
                    chunk_job_id,
                    book_id,
                    chunk_number,
                    total_chunks,
                    content,
                    line_start,
                    line_end,
                    first_chapter,
                    last_chapter,
                    chapter_count,
                    chapters_data,
                    joplin_note_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            db.run(
                sql,
                [
                    chunkData.chunk_job_id,
                    chunkData.book_id,
                    chunkData.chunk_number,
                    chunkData.total_chunks,
                    chunkData.content,
                    chunkData.line_start,
                    chunkData.line_end,
                    chunkData.first_chapter || null,
                    chunkData.last_chapter || null,
                    chunkData.chapter_count || 0,
                    chunkData.chapters_data ? JSON.stringify(chunkData.chapters_data) : null,
                    chunkData.joplin_note_id || null,
                ],
                function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    static async findByChunkJobId(chunkJobId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM chunks WHERE chunk_job_id = ? ORDER BY chunk_number ASC",
                [chunkJobId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Parse chapters_data JSON
                        const chunks = rows.map((row) => ({
                            ...row,
                            chapters_data: row.chapters_data
                                ? JSON.parse(row.chapters_data)
                                : null,
                        }));
                        resolve(chunks);
                    }
                }
            );
        });
    }

    static async findByBookId(bookId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM chunks WHERE book_id = ? ORDER BY chunk_number ASC",
                [bookId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Parse chapters_data JSON
                        const chunks = rows.map((row) => ({
                            ...row,
                            chapters_data: row.chapters_data
                                ? JSON.parse(row.chapters_data)
                                : null,
                        }));
                        resolve(chunks);
                    }
                }
            );
        });
    }

    static async findByChunkJobIdAndNumber(chunkJobId, chunkNumber) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get(
                "SELECT * FROM chunks WHERE chunk_job_id = ? AND chunk_number = ?",
                [chunkJobId, chunkNumber],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        if (row) {
                            row.chapters_data = row.chapters_data
                                ? JSON.parse(row.chapters_data)
                                : null;
                        }
                        resolve(row);
                    }
                }
            );
        });
    }

    static async findByBookIdAndNumber(bookId, chunkNumber) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get(
                "SELECT * FROM chunks WHERE book_id = ? AND chunk_number = ? ORDER BY created_at DESC LIMIT 1",
                [bookId, chunkNumber],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        if (row) {
                            row.chapters_data = row.chapters_data
                                ? JSON.parse(row.chapters_data)
                                : null;
                        }
                        resolve(row);
                    }
                }
            );
        });
    }

    static async deleteByChunkJobId(chunkJobId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.run(
                "DELETE FROM chunks WHERE chunk_job_id = ?",
                [chunkJobId],
                function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.changes);
                    }
                }
            );
        });
    }

    static async update(id, updates) {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (updates.content !== undefined) {
            fields.push("content = ?");
            values.push(updates.content);
        }
        if (updates.chunk_number !== undefined) {
            fields.push("chunk_number = ?");
            values.push(updates.chunk_number);
        }
        if (updates.total_chunks !== undefined) {
            fields.push("total_chunks = ?");
            values.push(updates.total_chunks);
        }
        if (updates.line_start !== undefined) {
            fields.push("line_start = ?");
            values.push(updates.line_start);
        }
        if (updates.line_end !== undefined) {
            fields.push("line_end = ?");
            values.push(updates.line_end);
        }
        if (updates.first_chapter !== undefined) {
            fields.push("first_chapter = ?");
            values.push(updates.first_chapter);
        }
        if (updates.last_chapter !== undefined) {
            fields.push("last_chapter = ?");
            values.push(updates.last_chapter);
        }
        if (updates.chapter_count !== undefined) {
            fields.push("chapter_count = ?");
            values.push(updates.chapter_count);
        }
        if (updates.chapters_data !== undefined) {
            fields.push("chapters_data = ?");
            values.push(
                updates.chapters_data
                    ? JSON.stringify(updates.chapters_data)
                    : null
            );
        }
        if (updates.joplin_note_id !== undefined) {
            fields.push("joplin_note_id = ?");
            values.push(updates.joplin_note_id || null);
        }

        if (fields.length === 0) {
            return Promise.resolve(0);
        }

        values.push(id);
        const sql = `UPDATE chunks SET ${fields.join(", ")} WHERE id = ?`;

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
}

module.exports = Chunk;

