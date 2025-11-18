const { getDatabase } = require("./database");

class Chapter {
    static async create(chapterData) {
        const db = getDatabase();
        const {
            book_id,
            chapter_number,
            chapter_title,
            chapter_title_simplified,
            chapter_name,
            cool18_url,
            cool18_thread_id,
            content,
            line_start,
            line_end,
            status = "pending",
            job_id,
        } = chapterData;

        return new Promise((resolve, reject) => {
            const sql = `
        INSERT INTO chapters (
          book_id, chapter_number, chapter_title, chapter_title_simplified, chapter_name,
          cool18_url, cool18_thread_id, content, line_start, line_end,
          status, job_id, downloaded_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `;
            db.run(
                sql,
                [
                    book_id,
                    chapter_number,
                    chapter_title,
                    chapter_title_simplified,
                    chapter_name || null,
                    cool18_url,
                    cool18_thread_id,
                    content,
                    line_start,
                    line_end,
                    status,
                    job_id || null,
                ],
                function (err) {
                    if (err) {
                        // If duplicate, try to update instead
                        if (err.message.includes("UNIQUE constraint")) {
                            Chapter.updateByBookAndNumber(
                                book_id,
                                chapter_number,
                                chapterData
                            )
                                .then(resolve)
                                .catch(reject);
                        } else {
                            reject(err);
                        }
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    static async updateByBookAndNumber(bookId, chapterNumber, updates) {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (updates.chapter_number !== undefined) {
            fields.push("chapter_number = ?");
            values.push(updates.chapter_number);
        }
        if (updates.chapter_title !== undefined) {
            fields.push("chapter_title = ?");
            values.push(updates.chapter_title);
        }
        if (updates.chapter_title_simplified !== undefined) {
            fields.push("chapter_title_simplified = ?");
            values.push(updates.chapter_title_simplified);
        }
        if (updates.chapter_name !== undefined) {
            fields.push("chapter_name = ?");
            values.push(updates.chapter_name);
        }
        if (updates.content !== undefined) {
            fields.push("content = ?");
            values.push(updates.content);
        }
        if (updates.line_start !== undefined) {
            fields.push("line_start = ?");
            values.push(updates.line_start);
        }
        if (updates.line_end !== undefined) {
            fields.push("line_end = ?");
            values.push(updates.line_end);
        }
        if (updates.status !== undefined) {
            fields.push("status = ?");
            values.push(updates.status);
        }
        if (updates.joplin_note_id !== undefined) {
            fields.push("joplin_note_id = ?");
            values.push(updates.joplin_note_id);
        }

        if (fields.length === 0) {
            return Promise.resolve(0);
        }

        values.push(bookId, chapterNumber);
        const sql = `UPDATE chapters SET ${fields.join(
            ", "
        )} WHERE book_id = ? AND chapter_number = ?`;

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

    static async findById(id) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM chapters WHERE id = ?", [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    static async updateById(id, updates) {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (updates.chapter_number !== undefined) {
            fields.push("chapter_number = ?");
            values.push(updates.chapter_number);
        }
        if (updates.chapter_title !== undefined) {
            fields.push("chapter_title = ?");
            values.push(updates.chapter_title);
        }
        if (updates.chapter_title_simplified !== undefined) {
            fields.push("chapter_title_simplified = ?");
            values.push(updates.chapter_title_simplified);
        }
        if (updates.chapter_name !== undefined) {
            fields.push("chapter_name = ?");
            values.push(updates.chapter_name);
        }
        if (updates.content !== undefined) {
            fields.push("content = ?");
            values.push(updates.content);
        }
        if (updates.line_start !== undefined) {
            fields.push("line_start = ?");
            values.push(updates.line_start);
        }
        if (updates.line_end !== undefined) {
            fields.push("line_end = ?");
            values.push(updates.line_end);
        }
        if (updates.status !== undefined) {
            fields.push("status = ?");
            values.push(updates.status);
        }
        if (updates.joplin_note_id !== undefined) {
            fields.push("joplin_note_id = ?");
            values.push(updates.joplin_note_id);
        }

        if (fields.length === 0) {
            return Promise.resolve(0);
        }

        values.push(id);
        const sql = `UPDATE chapters SET ${fields.join(", ")} WHERE id = ?`;

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
            db.run("DELETE FROM chapters WHERE id = ?", [id], function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    static async findByBookId(bookId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM chapters WHERE book_id = ? ORDER BY chapter_number ASC",
                [bookId],
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

    static async findByUrl(cool18Url) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get(
                "SELECT * FROM chapters WHERE cool18_url = ?",
                [cool18Url],
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

    static async findByBookAndNumber(bookId, chapterNumber) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get(
                "SELECT * FROM chapters WHERE book_id = ? AND chapter_number = ?",
                [bookId, chapterNumber],
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

    static async findByJobId(jobId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM chapters WHERE job_id = ? ORDER BY chapter_number ASC",
                [jobId],
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

    static async findFailedByJobId(jobId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM chapters WHERE job_id = ? AND status = 'failed'",
                [jobId],
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

    static async findFailedByBookId(bookId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM chapters WHERE book_id = ? AND status = ? ORDER BY chapter_number ASC",
                [bookId, "failed"],
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

    /**
     * Find the next available chapter number for a book
     * @param {number} bookId - Book ID
     * @param {number} startFrom - Start searching from this number (default: 1)
     * @returns {Promise<number>} - Next available chapter number
     */
    static async findNextAvailableChapterNumber(bookId, startFrom = 1) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT chapter_number FROM chapters WHERE book_id = ? AND chapter_number IS NOT NULL ORDER BY chapter_number ASC",
                [bookId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const existingNumbers = new Set(
                        rows.map((r) => r.chapter_number)
                    );

                    // Find first available number starting from startFrom
                    let nextNumber = startFrom;
                    while (existingNumbers.has(nextNumber)) {
                        nextNumber++;
                    }

                    resolve(nextNumber);
                }
            );
        });
    }
}

module.exports = Chapter;
