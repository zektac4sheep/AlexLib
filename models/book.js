const { getDatabase } = require("./database");

class Book {
    static async create(
        bookNameSimplified,
        bookNameTraditional = null,
        metadata = {}
    ) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            const sql = `
        INSERT INTO books (
          book_name_simplified, 
          book_name_traditional, 
          author,
          category,
          description,
          source_url,
          last_updated
        )
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `;
            db.run(
                sql,
                [
                    bookNameSimplified,
                    bookNameTraditional,
                    metadata.author || null,
                    metadata.category || null,
                    metadata.description || null,
                    metadata.sourceUrl || null,
                ],
                function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        const bookId = this.lastID;
                        // Add tags if provided
                        if (metadata.tags && metadata.tags.length > 0) {
                            Book.addTags(bookId, metadata.tags).catch((err) => {
                                console.error("Error adding tags:", err);
                            });
                        }
                        resolve(bookId);
                    }
                }
            );
        });
    }

    static async addTags(bookId, tags) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare(
                    "INSERT OR IGNORE INTO book_tags (book_id, tag) VALUES (?, ?)"
                );
                tags.forEach((tag) => {
                    stmt.run([bookId, tag]);
                });
                stmt.finalize((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    static async getTags(bookId) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT tag FROM book_tags WHERE book_id = ?",
                [bookId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows.map((row) => row.tag));
                    }
                }
            );
        });
    }

    static async findById(id) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM books WHERE id = ?", [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    static async findBySimplifiedName(bookNameSimplified) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.get(
                "SELECT * FROM books WHERE book_name_simplified = ?",
                [bookNameSimplified],
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

    static async findAll() {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM books ORDER BY last_updated DESC",
                [],
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

        if (updates.book_name_simplified !== undefined) {
            fields.push("book_name_simplified = ?");
            values.push(updates.book_name_simplified);
        }
        if (updates.book_name_traditional !== undefined) {
            fields.push("book_name_traditional = ?");
            values.push(updates.book_name_traditional);
        }
        if (updates.author !== undefined) {
            fields.push("author = ?");
            values.push(updates.author);
        }
        if (updates.category !== undefined) {
            fields.push("category = ?");
            values.push(updates.category);
        }
        if (updates.description !== undefined) {
            fields.push("description = ?");
            values.push(updates.description);
        }
        if (updates.source_url !== undefined) {
            fields.push("source_url = ?");
            values.push(updates.source_url);
        }
        if (updates.joplin_notebook_id !== undefined) {
            fields.push("joplin_notebook_id = ?");
            values.push(updates.joplin_notebook_id);
        }
        if (updates.total_chapters !== undefined) {
            fields.push("total_chapters = ?");
            values.push(updates.total_chapters);
        }
        if (updates.rating !== undefined) {
            fields.push("rating = ?");
            values.push(updates.rating);
        }

        if (fields.length === 0) {
            return Promise.resolve(0);
        }

        fields.push("last_updated = datetime('now')");
        values.push(id);

        const sql = `UPDATE books SET ${fields.join(", ")} WHERE id = ?`;
        return new Promise((resolve, reject) => {
            db.run(sql, values, function (err) {
                if (err) {
                    reject(err);
                } else {
                    // Update tags if provided
                    if (updates.tags !== undefined) {
                        // Remove old tags
                        db.run(
                            "DELETE FROM book_tags WHERE book_id = ?",
                            [id],
                            () => {
                                // Add new tags
                                if (updates.tags.length > 0) {
                                    Book.addTags(id, updates.tags).catch(
                                        (err) => {
                                            console.error(
                                                "Error updating tags:",
                                                err
                                            );
                                        }
                                    );
                                }
                            }
                        );
                    }
                    resolve(this.changes);
                }
            });
        });
    }

    static async delete(id) {
        const db = getDatabase();
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM books WHERE id = ?", [id], function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }
}

module.exports = Book;
