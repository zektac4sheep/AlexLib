const { getDatabase } = require("./database");

class Chapter {
    static async create(chapterData) {
        const db = getDatabase();
        let {
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
            series = "official",
        } = chapterData;

        // Handle "結局" as special case - use separate series instead of numbering
        if (chapter_name && chapter_name.includes("結局")) {
            // Use "結局" as a separate series
            // This allows multiple "結局" chapters with different chapter_numbers
            series = "結局";
            // Keep the original chapter name (don't number it)
            // The series separation handles uniqueness via (book_id, chapter_number, series) constraint
        }

        return new Promise((resolve, reject) => {
            const sql = `
        INSERT INTO chapters (
          book_id, chapter_number, chapter_title, chapter_title_simplified, chapter_name,
          cool18_url, cool18_thread_id, content, line_start, line_end,
          status, job_id, series, downloaded_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
                    series || "official",
                ],
                function (err) {
                    if (err) {
                        // If duplicate, merge chapters (use longer content version)
                        if (err.message.includes("UNIQUE constraint")) {
                            // Fetch existing chapter to merge
                            Chapter.findByBookAndNumber(
                                book_id,
                                chapter_number,
                                series || "official"
                            )
                                .then((existingChapter) => {
                                    if (!existingChapter) {
                                        // If not found, try update anyway
                                        return Chapter.updateByBookSeriesAndNumber(
                                            book_id,
                                            series || "official",
                                            chapter_number,
                                            chapterData
                                        );
                                    }

                                    // Merge: use longer content, prefer new values for other fields
                                    const existingContentLength = (
                                        existingChapter.content || ""
                                    ).length;
                                    const newContentLength = (
                                        chapterData.content || ""
                                    ).length;

                                    // Apply character limits to titles and names
                                    const textProcessor = require("../services/textProcessor");

                                    const mergedData = {
                                        ...chapterData,
                                        // Use longer content
                                        content:
                                            newContentLength >
                                            existingContentLength
                                                ? chapterData.content
                                                : existingChapter.content,
                                        // Apply 20-character limits to titles and names
                                        chapter_title:
                                            textProcessor.truncateToMax(
                                                chapterData.chapter_title ||
                                                    existingChapter.chapter_title ||
                                                    "",
                                                20
                                            ),
                                        chapter_title_simplified:
                                            textProcessor.truncateToMax(
                                                chapterData.chapter_title_simplified ||
                                                    existingChapter.chapter_title_simplified ||
                                                    "",
                                                20
                                            ),
                                        chapter_name:
                                            textProcessor.truncateToMax(
                                                chapterData.chapter_name ||
                                                    existingChapter.chapter_name ||
                                                    "",
                                                20
                                            ),
                                        // Keep existing line_start/line_end if new ones are not provided
                                        line_start:
                                            chapterData.line_start !== undefined
                                                ? chapterData.line_start
                                                : existingChapter.line_start,
                                        line_end:
                                            chapterData.line_end !== undefined
                                                ? chapterData.line_end
                                                : existingChapter.line_end,
                                        // Keep existing cool18_url if new one is not provided
                                        cool18_url:
                                            chapterData.cool18_url ||
                                            existingChapter.cool18_url,
                                        cool18_thread_id:
                                            chapterData.cool18_thread_id ||
                                            existingChapter.cool18_thread_id,
                                    };

                                    return Chapter.updateByBookSeriesAndNumber(
                                        book_id,
                                        series || "official",
                                        chapter_number,
                                        mergedData
                                    ).then(() => existingChapter.id);
                                })
                                .then(resolve)
                                .catch(reject);
                        } else {
                            reject(err);
                        }
                    } else {
                        // Mark book as needing chunk rebuild when new chapter is created
                        const Book = require("./book");
                        Book.update(book_id, { rebuild_chunks: true }).catch(
                            (err) => {
                                console.error(
                                    "Error marking book for chunk rebuild:",
                                    err
                                );
                            }
                        );
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    static async updateByBookAndNumber(bookId, chapterNumber, updates) {
        // For backward compatibility, use 'official' as default series
        return Chapter.updateByBookSeriesAndNumber(
            bookId,
            updates.series || "official",
            chapterNumber,
            updates
        );
    }

    static async updateByBookSeriesAndNumber(
        bookId,
        series,
        chapterNumber,
        updates
    ) {
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
        if (updates.series !== undefined) {
            fields.push("series = ?");
            values.push(updates.series);
        }

        if (fields.length === 0) {
            return Promise.resolve(0);
        }

        values.push(bookId, series || "official", chapterNumber);
        const sql = `UPDATE chapters SET ${fields.join(
            ", "
        )} WHERE book_id = ? AND series = ? AND chapter_number = ?`;

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
        if (updates.series !== undefined) {
            fields.push("series = ?");
            values.push(updates.series);
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
            // Order by series (official first, then alphabetically by series name), then by chapter_number
            db.all(
                `SELECT * FROM chapters WHERE book_id = ? 
                 ORDER BY 
                     CASE WHEN COALESCE(series, 'official') = 'official' THEN 0 ELSE 1 END,
                     COALESCE(series, 'official') ASC,
                     chapter_number ASC`,
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

    static async findByBookAndNumber(
        bookId,
        chapterNumber,
        series = "official"
    ) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get(
                "SELECT * FROM chapters WHERE book_id = ? AND series = ? AND chapter_number = ?",
                [bookId, series || "official", chapterNumber],
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

    /**
     * Find the next available "結局" number for a book
     * Checks for existing chapters with name "結局", "結局1", "結局2", etc.
     * @param {number} bookId - Book ID
     * @param {string} series - Series name (default: "official")
     * @returns {Promise<number>} - Next available "結局" number (0 for "結局", 1 for "結局1", etc.)
     */
    static async findNextAvailableJiejuNumber(bookId, series = "official") {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                //                "SELECT chapter_name FROM chapters WHERE book_id = ? AND series = ? AND (chapter_name = '結局' OR chapter_name LIKE '結局%')",
                "SELECT chapter_name FROM chapters WHERE book_id = ? AND series = ? AND chapter_name LIKE '%結局%'",
                [bookId, series || "official"],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const jiejuNumbers = new Set();

                    // Extract numbers from "結局", "結局1", "結局2", etc.
                    for (const row of rows) {
                        const name = row.chapter_name || "";
                        //                        if (name === "結局") {
                        //                            jiejuNumbers.add(0);
                        if (name.includes("結局")) {
                            const numStr = name.substring(2); // Remove "結局" prefix
                            const num = parseInt(numStr, 10);
                            if (!isNaN(num)) {
                                jiejuNumbers.add(num);
                            }
                        }
                    }

                    // Find first available number starting from 0
                    let nextNumber = 0;
                    while (jiejuNumbers.has(nextNumber)) {
                        nextNumber++;
                    }

                    resolve(nextNumber);
                }
            );
        });
    }
}

module.exports = Chapter;
