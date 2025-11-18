/**
 * Joplin Service
 * Handles integration with Joplin API for syncing books and chunks
 */

const axios = require("axios");
const logger = require("../utils/logger");
const converter = require("./converter");
const { getDatabase } = require("../models/database");
const Chunk = require("../models/chunk");
const ChunkJob = require("../models/chunkJob");

const JOPLIN_API_URL = process.env.JOPLIN_API_URL || "http://localhost:41184";
const JOPLIN_API_TOKEN = process.env.JOPLIN_API_TOKEN;
const DEFAULT_CHUNK_SIZE = parseInt(
    process.env.DEFAULT_CHUNK_SIZE || "1000",
    10
);
const CHUNK_BUILD_TIMEOUT_MS = parseInt(
    process.env.CHUNK_BUILD_TIMEOUT_MS || `${10 * 60 * 1000}`,
    10
);
const CHUNK_BUILD_POLL_INTERVAL_MS = parseInt(
    process.env.CHUNK_BUILD_POLL_INTERVAL_MS || "2000",
    10
);

// Helper function to make API requests with configurable port and token
async function apiRequest(method, endpoint, data = null, options = {}) {
    const apiUrl = options.apiUrl || JOPLIN_API_URL;
    const apiToken = options.apiToken || JOPLIN_API_TOKEN;

    if (!apiToken) {
        throw new Error("JOPLIN_API_TOKEN is not configured");
    }

    // Joplin API requires token as query parameter
    // Add token to endpoint URL if not already present
    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${apiUrl}${endpoint}${separator}token=${encodeURIComponent(
        apiToken
    )}`;
    const config = {
        method,
        url,
        headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
        },
    };

    if (data) {
        config.data = data;
    }

    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        logger.error("Joplin API request failed", {
            method,
            endpoint,
            error: error.response?.data || error.message,
            status: error.response?.status,
        });
        throw error;
    }
}

/**
 * Find or create a notebook (folder) by title
 * @param {string} title - Notebook title
 * @param {string} parentId - Parent notebook ID (optional)
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<string>} - Notebook ID
 */
async function findOrCreateNotebook(title, parentId = null, options = {}) {
    try {
        // List all folders and search for matching one
        const allFolders = await apiRequest("GET", "/folders", null, options);

        // Check if notebook exists with exact title and parent
        if (allFolders.items && allFolders.items.length > 0) {
            for (const notebook of allFolders.items) {
                const notebookParentId = notebook.parent_id || "";
                const targetParentId = parentId || "";

                if (
                    notebook.title === title &&
                    notebookParentId === targetParentId
                ) {
                    return notebook.id;
                }
            }
        }

        // Create new notebook
        const newNotebook = await apiRequest(
            "POST",
            "/folders",
            {
                title,
                parent_id: parentId || "",
            },
            options
        );

        return newNotebook.id;
    } catch (error) {
        logger.error("Error finding or creating notebook", {
            title,
            parentId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Create folder structure: Books root > author > book
 * @param {string} author - Author name (in Traditional Chinese)
 * @param {string} bookName - Book name (in Traditional Chinese)
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<{rootNotebookId: string, authorNotebookId: string, bookNotebookId: string}>}
 */
async function createFolderStructure(author, bookName, options = {}) {
    try {
        const rootFolderName =
            process.env.JOPLIN_ROOT_FOLDER?.trim() || "Books";

        // Create or find root folder (default: "Books")
        const rootNotebookId = await findOrCreateNotebook(
            rootFolderName,
            null,
            options
        );

        // Create or find author folder under root
        const authorNotebookId = await findOrCreateNotebook(
            author,
            rootNotebookId,
            options
        );

        // Create or find book folder under author
        const bookNotebookId = await findOrCreateNotebook(
            bookName,
            authorNotebookId,
            options
        );

        return {
            rootNotebookId,
            authorNotebookId,
            bookNotebookId,
        };
    } catch (error) {
        logger.error("Error creating folder structure", {
            author,
            bookName,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Create or update a tag
 * @param {string} tagTitle - Tag title
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<string>} - Tag ID
 */
async function findOrCreateTag(tagTitle, options = {}) {
    try {
        // List all tags and search for matching one
        const allTags = await apiRequest("GET", "/tags", null, options);

        // Check if tag exists with exact title
        if (allTags.items && allTags.items.length > 0) {
            for (const tag of allTags.items) {
                if (tag.title === tagTitle) {
                    return tag.id;
                }
            }
        }

        // Create new tag
        const newTag = await apiRequest(
            "POST",
            "/tags",
            {
                title: tagTitle,
            },
            options
        );

        return newTag.id;
    } catch (error) {
        logger.error("Error finding or creating tag", {
            tagTitle,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Create a note in Joplin
 * @param {string} title - Note title
 * @param {string} body - Note body (markdown)
 * @param {string} parentId - Parent notebook ID
 * @param {Array<string>} tags - Array of tag titles
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<string>} - Note ID
 */
async function createNote(title, body, parentId, tags = [], options = {}) {
    try {
        // Create the note
        const note = await apiRequest(
            "POST",
            "/notes",
            {
                title,
                body,
                parent_id: parentId,
            },
            options
        );

        // Add tags to the note
        if (tags && tags.length > 0) {
            for (const tagTitle of tags) {
                try {
                    const tagId = await findOrCreateTag(tagTitle, options);
                    await apiRequest(
                        "POST",
                        `/tags/${tagId}/notes`,
                        {
                            id: note.id,
                        },
                        options
                    );
                } catch (tagError) {
                    logger.warn("Error adding tag to note", {
                        tagTitle,
                        noteId: note.id,
                        error: tagError.message,
                    });
                    // Continue even if tag fails
                }
            }
        }

        return note.id;
    } catch (error) {
        logger.error("Error creating note", {
            title,
            parentId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Find a note by title in a notebook
 * @param {string} title - Note title
 * @param {string} parentId - Parent notebook ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<string|null>} - Note ID or null if not found
 */
async function findNoteByTitle(title, parentId, options = {}) {
    try {
        // List notes in the parent folder
        const notes = await apiRequest(
            "GET",
            `/folders/${parentId}/notes?fields=id,title,parent_id`,
            null,
            options
        );

        if (notes.items && notes.items.length > 0) {
            for (const note of notes.items) {
                if (note.title === title) {
                    return note.id;
                }
            }
        }

        return null;
    } catch (error) {
        logger.warn("Error finding note by title", {
            title,
            parentId,
            error: error.message,
        });
        return null;
    }
}

/**
 * Delete a note by ID
 * @param {string} noteId - Note ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<void>}
 */
async function deleteNote(noteId, options = {}) {
    try {
        await apiRequest("DELETE", `/notes/${noteId}`, null, options);
    } catch (error) {
        logger.error("Error deleting note", {
            noteId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Delete all notes in a notebook
 * @param {string} notebookId - Notebook ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<number>} - Number of notes deleted
 */
async function deleteAllNotesInNotebook(notebookId, options = {}) {
    try {
        // List all notes in the notebook
        const notes = await apiRequest(
            "GET",
            `/folders/${notebookId}/notes?fields=id,title`,
            null,
            options
        );

        let deletedCount = 0;
        if (notes.items && notes.items.length > 0) {
            for (const note of notes.items) {
                try {
                    await deleteNote(note.id, options);
                    deletedCount++;
                } catch (deleteError) {
                    logger.warn("Error deleting note", {
                        noteId: note.id,
                        noteTitle: note.title,
                        error: deleteError.message,
                    });
                    // Continue with other notes even if one fails
                }
            }
        }

        return deletedCount;
    } catch (error) {
        logger.error("Error deleting notes in notebook", {
            notebookId,
            error: error.message,
        });
        throw error;
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureChunksReadyForBook(book, chunkSize = DEFAULT_CHUNK_SIZE) {
    let chunks = await Chunk.findByBookId(book.id);
    if (chunks && chunks.length > 0) {
        return chunks;
    }

    let chunkJob = await ChunkJob.findByBookId(book.id);
    let jobId = chunkJob ? chunkJob.id : null;
    const effectiveChunkSize =
        (chunkJob && chunkJob.chunk_size) || chunkSize || DEFAULT_CHUNK_SIZE;
    let shouldStartProcessing = false;

    if (!chunkJob) {
        jobId = await ChunkJob.create(book.id, effectiveChunkSize);
        chunkJob = await ChunkJob.findById(jobId);
        shouldStartProcessing = true;
    } else if (
        chunkJob.status === "failed" ||
        chunkJob.status === "ready" ||
        chunkJob.status === "completed"
    ) {
        if (
            chunkJob.status === "ready" ||
            chunkJob.status === "completed"
        ) {
            await Chunk.deleteByChunkJobId(chunkJob.id);
        }
        jobId = await ChunkJob.create(book.id, effectiveChunkSize);
        chunkJob = await ChunkJob.findById(jobId);
        shouldStartProcessing = true;
    } else if (chunkJob.status === "queued") {
        shouldStartProcessing = true;
    }

    if (shouldStartProcessing) {
        const chunkRoutes = require("../routes/chunks");
        if (
            chunkRoutes &&
            typeof chunkRoutes.processChunkJob === "function"
        ) {
            chunkRoutes
                .processChunkJob(jobId, book.id, effectiveChunkSize, {
                    skipJoplinSync: true,
                })
                .catch((error) => {
                    logger.error(
                        "Error processing chunk job before Joplin sync",
                        {
                            bookId: book.id,
                            jobId,
                            error: error.message,
                        }
                    );
                });
        } else {
            throw new Error("processChunkJob not available");
        }
    }

    const startTime = Date.now();
    while (Date.now() - startTime < CHUNK_BUILD_TIMEOUT_MS) {
        chunkJob = await ChunkJob.findByBookId(book.id);
        if (
            chunkJob &&
            (chunkJob.status === "ready" || chunkJob.status === "completed")
        ) {
            chunks = await Chunk.findByBookId(book.id);
            if (chunks && chunks.length > 0) {
                return chunks;
            }
        }

        if (chunkJob && chunkJob.status === "failed") {
            throw new Error(
                `Chunk generation failed for book ${book.id}: ${
                    chunkJob.error_message || "Unknown error"
                }`
            );
        }

        await delay(CHUNK_BUILD_POLL_INTERVAL_MS);
    }

    throw new Error(
        `Timed out waiting for chunk generation for book ${book.id}`
    );
}

/**
 * Sync chunks to Joplin
 * Creates/ensures folder structure: Books root > author > book
 * Creates notes for each chunk with tags including author name
 * @param {Object} book - Book object with id, author, book_name_traditional, etc.
 * @param {Array} chunks - Array of chunk objects
 * @param {Object} options - Options with apiUrl and apiToken
 * @param {boolean} deleteAndRewrite - If true, delete all existing notes and rewrite them (for when chunks change)
 * @returns {Promise<number>} - Number of chunks synced
 */
async function syncChunksToJoplin(
    book,
    chunks,
    options = {},
    deleteAndRewrite = false
) {
    if (!chunks || chunks.length === 0) {
        throw new Error("No chunks provided for sync");
    }

    try {
        // Convert author and book name to Traditional Chinese if needed
        const authorTraditional = book.author
            ? converter.toTraditional(book.author)
            : "未知作者";
        const bookNameTraditional =
            book.book_name_traditional ||
            converter.toTraditional(book.book_name_simplified);

        // Create folder structure: Books root > author > book
        const { bookNotebookId } = await createFolderStructure(
            authorTraditional,
            bookNameTraditional,
            options
        );

        // If deleteAndRewrite is true, delete all existing notes first
        if (deleteAndRewrite) {
            const deletedCount = await deleteAllNotesInNotebook(
                bookNotebookId,
                options
            );
            logger.info("Deleted existing notes in notebook", {
                notebookId: bookNotebookId,
                deletedCount,
            });
        }

        // Prepare tags (include author name)
        const tags = [];
        if (authorTraditional && authorTraditional !== "未知作者") {
            tags.push(authorTraditional);
        }

        let syncedCount = 0;

        // Sync each chunk
        for (const chunk of chunks) {
            try {
                const chapterStart =
                    chunk.first_chapter ??
                    (chunk.chapters_data && chunk.chapters_data.length > 0
                        ? chunk.chapters_data[0].chapter_number
                        : null);
                const chapterEnd =
                    chunk.last_chapter ??
                    (chunk.chapters_data && chunk.chapters_data.length > 0
                        ? chunk.chapters_data[chunk.chapters_data.length - 1]
                              .chapter_number
                        : chapterStart);

                let chapterRangeLabel;
                if (chapterStart && chapterEnd) {
                    chapterRangeLabel =
                        chapterStart === chapterEnd
                            ? `${chapterStart}`
                            : `${chapterStart}-${chapterEnd}`;
                } else {
                    chapterRangeLabel = `第${chunk.chunk_number}部分`;
                }

                const chunkTitle = `${bookNameTraditional}(${chapterRangeLabel})`;

                // If not deleting and rewriting, check if note already exists
                if (!deleteAndRewrite) {
                    const existingNoteId = await findNoteByTitle(
                        chunkTitle,
                        bookNotebookId,
                        options
                    );

                    if (existingNoteId) {
                        logger.info("Chunk note already exists, skipping", {
                            bookId: book.id,
                            chunkNumber: chunk.chunk_number,
                            noteId: existingNoteId,
                        });
                        syncedCount++;
                        continue;
                    }
                }

                // Create note for chunk
                const noteId = await createNote(
                    chunkTitle,
                    chunk.content || "",
                    bookNotebookId,
                    tags,
                    options
                );

                logger.info("Synced chunk to Joplin", {
                    bookId: book.id,
                    chunkNumber: chunk.chunk_number,
                    noteId,
                });

                syncedCount++;
            } catch (chunkError) {
                logger.error("Error syncing chunk to Joplin", {
                    bookId: book.id,
                    chunkNumber: chunk.chunk_number,
                    error: chunkError.message,
                });
                // Continue with next chunk even if one fails
            }
        }

        // Update book's joplin_notebook_id with the chunks notebook ID
        const Book = require("../models/book");
        await Book.update(book.id, {
            joplin_notebook_id: bookNotebookId,
        });

        return syncedCount;
    } catch (error) {
        logger.error("Error syncing chunks to Joplin", {
            bookId: book.id,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Test Joplin API connection with configurable port and token
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<boolean>}
 */
async function testConnection(options = {}) {
    try {
        await apiRequest("GET", "/ping", null, options);
        return true;
    } catch (error) {
        logger.error("Joplin API connection test failed", {
            error: error.message,
        });
        return false;
    }
}

/**
 * Sync Joplin folder structure and notes to database
 * @param {Object} options - Options with apiUrl and apiToken
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<{folders: number, notes: number}>}
 */
async function syncStructureToDatabase(options = {}, progressCallback = null) {
    const db = getDatabase();
    let foldersCount = 0;
    let notesCount = 0;

    try {
        // Sync folders
        const folders = await apiRequest(
            "GET",
            "/folders?fields=id,title,parent_id,created_time,updated_time,user_created_time,user_updated_time,encryption_cipher_text,encryption_applied,is_shared",
            null,
            options
        );

        if (folders.items && folders.items.length > 0) {
            for (const folder of folders.items) {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT OR REPLACE INTO joplin_folders (
                            id, title, parent_id, created_time, updated_time,
                            user_created_time, user_updated_time, encryption_cipher_text,
                            encryption_applied, is_shared, last_synced_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                        [
                            folder.id,
                            folder.title,
                            folder.parent_id || null,
                            folder.created_time || null,
                            folder.updated_time || null,
                            folder.user_created_time || null,
                            folder.user_updated_time || null,
                            folder.encryption_cipher_text || null,
                            folder.encryption_applied || 0,
                            folder.is_shared || 0,
                        ],
                        (err) => {
                            if (err) reject(err);
                            else {
                                foldersCount++;
                                if (progressCallback) {
                                    progressCallback({
                                        folders: foldersCount,
                                        notes: notesCount,
                                    });
                                }
                                resolve();
                            }
                        }
                    );
                });
            }
        }

        // Sync notes (with pagination)
        let page = 1;
        const pageSize = 100;
        let hasMore = true;

        while (hasMore) {
            const notes = await apiRequest(
                "GET",
                `/notes?fields=id,parent_id,title,body,created_time,updated_time,user_created_time,user_updated_time,encryption_cipher_text,encryption_applied,is_todo,todo_due,todo_completed,source_url,source_application,application_data,latitude,longitude,altitude,author,source&page=${page}&limit=${pageSize}`,
                null,
                options
            );

            if (notes.items && notes.items.length > 0) {
                for (const note of notes.items) {
                    const bodySize = note.body
                        ? Buffer.byteLength(note.body, "utf8")
                        : 0;
                    await new Promise((resolve, reject) => {
                        db.run(
                            `INSERT OR REPLACE INTO joplin_notes (
                                id, parent_id, title, body, created_time, updated_time,
                                user_created_time, user_updated_time, encryption_cipher_text,
                                encryption_applied, is_todo, todo_due, todo_completed,
                                source_url, source_application, application_data,
                                latitude, longitude, altitude, author, source, size, last_synced_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                            [
                                note.id,
                                note.parent_id,
                                note.title || "",
                                note.body || null,
                                note.created_time || null,
                                note.updated_time || null,
                                note.user_created_time || null,
                                note.user_updated_time || null,
                                note.encryption_cipher_text || null,
                                note.encryption_applied || 0,
                                note.is_todo || 0,
                                note.todo_due || null,
                                note.todo_completed || null,
                                note.source_url || null,
                                note.source_application || null,
                                note.application_data || null,
                                note.latitude || null,
                                note.longitude || null,
                                note.altitude || null,
                                note.author || null,
                                note.source || null,
                                bodySize,
                            ],
                            (err) => {
                                if (err) reject(err);
                                else {
                                    notesCount++;
                                    if (progressCallback) {
                                        progressCallback({
                                            folders: foldersCount,
                                            notes: notesCount,
                                        });
                                    }
                                    resolve();
                                }
                            }
                        );
                    });
                }
                hasMore = notes.has_more || false;
                page++;
            } else {
                hasMore = false;
            }
        }

        return { folders: foldersCount, notes: notesCount };
    } catch (error) {
        logger.error("Error syncing Joplin structure to database", {
            error: error.message,
        });
        throw error;
    }
}

/**
 * Sync books to Joplin under "Books" root folder
 * Creates structure: Books > Author > BookName
 * @param {Array} books - Array of book objects
 * @param {Object} options - Options with apiUrl and apiToken
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<{syncedBooks: number}>}
 */
async function syncBooksToJoplin(books, options = {}, progressCallback = null) {
    try {
        // Find or create "Books" root folder
        const booksRootId = await findOrCreateNotebook("Books", null, options);
        let syncedCount = 0;

        for (const book of books) {
            try {
                const authorTraditional = book.author
                    ? converter.toTraditional(book.author)
                    : "未知作者";
                const bookNameTraditional =
                    book.book_name_traditional ||
                    converter.toTraditional(book.book_name_simplified);

                // Create or find author folder under Books
                const authorNotebookId = await findOrCreateNotebook(
                    authorTraditional,
                    booksRootId,
                    options
                );

                // Create or find book folder under author
                const bookNotebookId = await findOrCreateNotebook(
                    bookNameTraditional,
                    authorNotebookId,
                    options
                );

                // Update book's joplin_notebook_id
                const Book = require("../models/book");
                await Book.update(book.id, {
                    joplin_notebook_id: bookNotebookId,
                });

                syncedCount++;
                if (progressCallback) {
                    progressCallback({
                        completed: syncedCount,
                        total: books.length,
                    });
                }
            } catch (bookError) {
                logger.error("Error syncing book to Joplin", {
                    bookId: book.id,
                    error: bookError.message,
                });
                // Continue with next book
            }
        }

        return { syncedBooks: syncedCount };
    } catch (error) {
        logger.error("Error syncing books to Joplin", {
            error: error.message,
        });
        throw error;
    }
}

/**
 * Remove and recreate book folder in Joplin
 * @param {string} bookId - Book ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<{bookNotebookId: string}>}
 */
async function removeAndRecreateBookFolder(bookId, options = {}) {
    try {
        const Book = require("../models/book");
        const book = await Book.findById(bookId);
        if (!book) {
            throw new Error("Book not found");
        }

        // Delete existing folder if it exists
        if (book.joplin_notebook_id) {
            try {
                await apiRequest(
                    "DELETE",
                    `/folders/${book.joplin_notebook_id}`,
                    null,
                    options
                );
            } catch (deleteError) {
                logger.warn("Error deleting existing folder (may not exist)", {
                    notebookId: book.joplin_notebook_id,
                    error: deleteError.message,
                });
            }
        }

        // Recreate folder structure (Books > Author > Book > chunks)
        const authorTraditional = book.author
            ? converter.toTraditional(book.author)
            : "未知作者";
        const bookNameTraditional =
            book.book_name_traditional ||
            converter.toTraditional(book.book_name_simplified);

        const { bookNotebookId } = await createFolderStructure(
            authorTraditional,
            bookNameTraditional,
            options
        );

        // Update book's joplin_notebook_id
        await Book.update(bookId, {
            joplin_notebook_id: bookNotebookId,
        });

        return { bookNotebookId };
    } catch (error) {
        logger.error("Error removing and recreating book folder", {
            bookId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Background job processor for syncing structure
 */
async function processSyncStructureJob(jobId, apiUrl, apiToken) {
    const JoplinJob = require("../models/joplinJob");
    const options = { apiUrl, apiToken };

    try {
        await JoplinJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        const result = await syncStructureToDatabase(options, (progress) => {
            JoplinJob.update(jobId, {
                progress_data: progress,
                completed_items: progress.notes || 0,
                total_items: progress.folders + progress.notes || 0,
            }).catch((err) =>
                logger.error("Error updating job progress", { err })
            );
        });

        await JoplinJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
            progress_data: result,
            completed_items: result.folders + result.notes,
            total_items: result.folders + result.notes,
        });
    } catch (error) {
        let errorMessage = error.message;
        let errorDetails = {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
        };

        // Provide more helpful error messages for common issues
        if (error.response?.status === 403) {
            errorMessage = `認證失敗 (403): Token 可能無效或已過期。請檢查 Joplin 設定中的 API Token，並確保 Web Clipper 服務已啟用。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.response?.status === 401) {
            errorMessage = `未授權 (401): Token 無效。請檢查 Joplin 設定中的 API Token。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.response?.status === 500) {
            errorMessage = `伺服器錯誤 (500): Joplin API 發生內部錯誤。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.code === "ECONNREFUSED") {
            errorMessage = `連線被拒絕: 無法連接到 Joplin API (${options.apiUrl})。請確保 Joplin 應用程式正在運行，並且 Web Clipper 服務已啟用。`;
        } else if (error.response?.data) {
            errorDetails.apiError =
                error.response.data.error ||
                error.response.data.message ||
                JSON.stringify(error.response.data);
        }

        // Include full error details in the message
        const fullErrorMessage = errorDetails.apiError
            ? `${errorMessage}\n\n詳細錯誤: ${
                  typeof errorDetails.apiError === "string"
                      ? errorDetails.apiError
                      : JSON.stringify(errorDetails.apiError, null, 2)
              }`
            : errorMessage;

        logger.error("Joplin sync structure job failed", {
            jobId,
            error: errorMessage,
            details: errorDetails,
        });

        await JoplinJob.update(jobId, {
            status: "failed",
            error_message: fullErrorMessage,
            completed_at: new Date().toISOString(),
        });
    }
}

/**
 * Background job processor for syncing books
 * Syncs all books with sync_to_joplin=1 and removes notebooks for books with sync_to_joplin=0
 * @param {number} jobId - Job ID
 * @param {string} apiUrl - Joplin API URL
 * @param {string} apiToken - Joplin API token
 */
async function processSyncBooksJob(jobId, apiUrl, apiToken) {
    const JoplinJob = require("../models/joplinJob");
    const Book = require("../models/book");
    const Chunk = require("../models/chunk");
    const { getDatabase } = require("../models/database");
    const options = { apiUrl, apiToken };

    try {
        await JoplinJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        const db = getDatabase();

        // Get all books marked for sync (sync_to_joplin = 1)
        const booksToSync = await new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM books WHERE sync_to_joplin = 1",
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

        // Get all books NOT marked for sync but have joplin_notebook_id (need to remove)
        const booksToRemove = await new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM books WHERE sync_to_joplin = 0 AND joplin_notebook_id IS NOT NULL AND joplin_notebook_id != ''",
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

        const totalItems = booksToSync.length + booksToRemove.length;
        await JoplinJob.update(jobId, {
            total_items: totalItems,
        });

        let syncedBooks = 0;
        let syncedChunks = 0;
        let removedNotebooks = 0;
        let errors = [];

        // Sync books marked for sync
        for (const book of booksToSync) {
            try {
                const chunks = await ensureChunksReadyForBook(
                    book,
                    DEFAULT_CHUNK_SIZE
                );

                // Sync chunks (this will delete and rewrite if chunks changed)
                let bookSyncedChunks = 0;
                if (chunks && chunks.length > 0) {
                    bookSyncedChunks = await syncChunksToJoplin(
                        book,
                        chunks,
                        options,
                        true
                    );
                    syncedChunks += bookSyncedChunks;
                }

                syncedBooks++;
                await JoplinJob.update(jobId, {
                    completed_items: syncedBooks + removedNotebooks,
                });
            } catch (bookError) {
                logger.error("Error syncing book to Joplin", {
                    bookId: book.id,
                    error: bookError.message,
                });
                errors.push({
                    bookId: book.id,
                    bookName:
                        book.book_name_traditional || book.book_name_simplified,
                    error: bookError.message,
                    type: "sync",
                });
            }
        }

        // Remove notebooks for books not marked for sync
        for (const book of booksToRemove) {
            try {
                if (book.joplin_notebook_id) {
                    // Delete the notebook (this will also delete all notes inside)
                    await apiRequest(
                        "DELETE",
                        `/folders/${book.joplin_notebook_id}`,
                        null,
                        options
                    );

                    // Clear the joplin_notebook_id from the book
                    await Book.update(book.id, {
                        joplin_notebook_id: null,
                    });

                    removedNotebooks++;
                    logger.info(
                        "Removed notebook for book not marked for sync",
                        {
                            bookId: book.id,
                            notebookId: book.joplin_notebook_id,
                        }
                    );
                }

                await JoplinJob.update(jobId, {
                    completed_items: syncedBooks + removedNotebooks,
                });
            } catch (removeError) {
                logger.error("Error removing notebook from Joplin", {
                    bookId: book.id,
                    notebookId: book.joplin_notebook_id,
                    error: removeError.message,
                });
                errors.push({
                    bookId: book.id,
                    bookName:
                        book.book_name_traditional || book.book_name_simplified,
                    error: removeError.message,
                    type: "remove",
                });
            }
        }

        await JoplinJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
            progress_data: {
                syncedBooks,
                syncedChunks,
                removedNotebooks,
                totalBooksToSync: booksToSync.length,
                totalBooksToRemove: booksToRemove.length,
                errors: errors.length > 0 ? errors : undefined,
            },
            completed_items: syncedBooks + removedNotebooks,
        });
    } catch (error) {
        let errorMessage = error.message;
        let errorDetails = {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
        };

        // Provide more helpful error messages for common issues
        if (error.response?.status === 403) {
            errorMessage = `認證失敗 (403): Token 可能無效或已過期。請檢查 Joplin 設定中的 API Token，並確保 Web Clipper 服務已啟用。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.response?.status === 401) {
            errorMessage = `未授權 (401): Token 無效。請檢查 Joplin 設定中的 API Token。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.response?.status === 500) {
            errorMessage = `伺服器錯誤 (500): Joplin API 發生內部錯誤。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.code === "ECONNREFUSED") {
            errorMessage = `連線被拒絕: 無法連接到 Joplin API (${options.apiUrl})。請確保 Joplin 應用程式正在運行，並且 Web Clipper 服務已啟用。`;
        } else if (error.response?.data) {
            errorDetails.apiError =
                error.response.data.error ||
                error.response.data.message ||
                JSON.stringify(error.response.data);
        }

        // Include full error details in the message
        const fullErrorMessage = errorDetails.apiError
            ? `${errorMessage}\n\n詳細錯誤: ${
                  typeof errorDetails.apiError === "string"
                      ? errorDetails.apiError
                      : JSON.stringify(errorDetails.apiError, null, 2)
              }`
            : errorMessage;

        logger.error("Joplin sync books job failed", {
            jobId,
            error: errorMessage,
            details: errorDetails,
        });

        await JoplinJob.update(jobId, {
            status: "failed",
            error_message: fullErrorMessage,
            completed_at: new Date().toISOString(),
        });
    }
}

/**
 * Background job processor for syncing tagged books
 * Syncs all books that have tags in the book_tags table
 * @param {number} jobId - Job ID
 * @param {string} apiUrl - Joplin API URL
 * @param {string} apiToken - Joplin API token
 */
async function processSyncTaggedBooksJob(jobId, apiUrl, apiToken) {
    const JoplinJob = require("../models/joplinJob");
    const Book = require("../models/book");
    const Chunk = require("../models/chunk");
    const { getDatabase } = require("../models/database");
    const options = { apiUrl, apiToken };

    try {
        await JoplinJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        const db = getDatabase();

        // Get all books that have tags (books with entries in book_tags table)
        const booksToSync = await new Promise((resolve, reject) => {
            db.all(
                `SELECT DISTINCT b.* 
                 FROM books b 
                 INNER JOIN book_tags bt ON b.id = bt.book_id 
                 ORDER BY b.id`,
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

        await JoplinJob.update(jobId, {
            total_items: booksToSync.length,
        });

        let syncedBooks = 0;
        let syncedChunks = 0;
        let errors = [];

        // Sync each tagged book
        for (const book of booksToSync) {
            try {
                const chunks = await ensureChunksReadyForBook(
                    book,
                    DEFAULT_CHUNK_SIZE
                );

                // Sync chunks (this will delete and rewrite if chunks changed)
                let bookSyncedChunks = 0;
                if (chunks && chunks.length > 0) {
                    bookSyncedChunks = await syncChunksToJoplin(
                        book,
                        chunks,
                        options,
                        true
                    );
                    syncedChunks += bookSyncedChunks;
                }

                syncedBooks++;
                await JoplinJob.update(jobId, {
                    completed_items: syncedBooks,
                });
            } catch (bookError) {
                logger.error("Error syncing tagged book to Joplin", {
                    bookId: book.id,
                    error: bookError.message,
                });
                errors.push({
                    bookId: book.id,
                    bookName:
                        book.book_name_traditional || book.book_name_simplified,
                    error: bookError.message,
                });
            }
        }

        await JoplinJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
            progress_data: {
                syncedBooks,
                syncedChunks,
                totalBooks: booksToSync.length,
                errors: errors.length > 0 ? errors : undefined,
            },
            completed_items: syncedBooks,
        });
    } catch (error) {
        let errorMessage = error.message;
        let errorDetails = {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
        };

        // Provide more helpful error messages for common issues
        if (error.response?.status === 403) {
            errorMessage = `認證失敗 (403): Token 可能無效或已過期。請檢查 Joplin 設定中的 API Token，並確保 Web Clipper 服務已啟用。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.response?.status === 401) {
            errorMessage = `未授權 (401): Token 無效。請檢查 Joplin 設定中的 API Token。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.response?.status === 500) {
            errorMessage = `伺服器錯誤 (500): Joplin API 發生內部錯誤。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.code === "ECONNREFUSED") {
            errorMessage = `連線被拒絕: 無法連接到 Joplin API (${options.apiUrl})。請確保 Joplin 應用程式正在運行，並且 Web Clipper 服務已啟用。`;
        } else if (error.response?.data) {
            errorDetails.apiError =
                error.response.data.error ||
                error.response.data.message ||
                JSON.stringify(error.response.data);
        }

        // Include full error details in the message
        const fullErrorMessage = errorDetails.apiError
            ? `${errorMessage}\n\n詳細錯誤: ${
                  typeof errorDetails.apiError === "string"
                      ? errorDetails.apiError
                      : JSON.stringify(errorDetails.apiError, null, 2)
              }`
            : errorMessage;

        logger.error("Joplin sync tagged books job failed", {
            jobId,
            error: errorMessage,
            details: errorDetails,
        });

        await JoplinJob.update(jobId, {
            status: "failed",
            error_message: fullErrorMessage,
            completed_at: new Date().toISOString(),
        });
    }
}

/**
 * Background job processor for removing and recreating book folder
 */
async function processRecreateBookFolderJob(jobId, apiUrl, apiToken, bookId) {
    const JoplinJob = require("../models/joplinJob");
    const options = { apiUrl, apiToken };

    try {
        await JoplinJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
            total_items: 1,
        });

        const result = await removeAndRecreateBookFolder(bookId, options);

        await JoplinJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
            completed_items: 1,
            progress_data: result,
        });
    } catch (error) {
        let errorMessage = error.message;
        let errorDetails = {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
        };

        // Provide more helpful error messages for common issues
        if (error.response?.status === 403) {
            errorMessage = `認證失敗 (403): Token 可能無效或已過期。請檢查 Joplin 設定中的 API Token，並確保 Web Clipper 服務已啟用。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.response?.status === 401) {
            errorMessage = `未授權 (401): Token 無效。請檢查 Joplin 設定中的 API Token。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.response?.status === 500) {
            errorMessage = `伺服器錯誤 (500): Joplin API 發生內部錯誤。`;
            errorDetails.apiError =
                error.response?.data?.error || error.response?.data?.message;
        } else if (error.code === "ECONNREFUSED") {
            errorMessage = `連線被拒絕: 無法連接到 Joplin API (${options.apiUrl})。請確保 Joplin 應用程式正在運行，並且 Web Clipper 服務已啟用。`;
        } else if (error.response?.data) {
            errorDetails.apiError =
                error.response.data.error ||
                error.response.data.message ||
                JSON.stringify(error.response.data);
        }

        // Include full error details in the message
        const fullErrorMessage = errorDetails.apiError
            ? `${errorMessage}\n\n詳細錯誤: ${
                  typeof errorDetails.apiError === "string"
                      ? errorDetails.apiError
                      : JSON.stringify(errorDetails.apiError, null, 2)
              }`
            : errorMessage;

        logger.error("Joplin recreate book folder job failed", {
            jobId,
            bookId,
            error: errorMessage,
            details: errorDetails,
        });

        await JoplinJob.update(jobId, {
            status: "failed",
            error_message: fullErrorMessage,
            completed_at: new Date().toISOString(),
        });
    }
}

module.exports = {
    syncChunksToJoplin,
    createFolderStructure,
    findOrCreateNotebook,
    createNote,
    deleteNote,
    deleteAllNotesInNotebook,
    findNoteByTitle,
    findOrCreateTag,
    testConnection,
    syncStructureToDatabase,
    syncBooksToJoplin,
    removeAndRecreateBookFolder,
    processSyncStructureJob,
    processSyncBooksJob,
    processSyncTaggedBooksJob,
    processRecreateBookFolderJob,
};
