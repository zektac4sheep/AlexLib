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
                    chapters_data
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}

module.exports = Chunk;

