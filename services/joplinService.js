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
        // Enhanced error logging with full details
        const maskedUrl = url.replace(/token=[^&]+/, "token=***");

        // Extract underlying errors if this is an AggregateError
        let underlyingErrors = null;
        if (
            error.name === "AggregateError" &&
            error.errors &&
            Array.isArray(error.errors)
        ) {
            underlyingErrors = error.errors.map((err, index) => ({
                index: index,
                name: err.name,
                message: err.message,
                code: err.code,
                syscall: err.syscall,
                address: err.address,
                port: err.port,
                errno: err.errno,
                stack: err.stack,
            }));
        }

        // Try to get the actual error code from underlying errors if AggregateError
        const actualErrorCode =
            error.code || (underlyingErrors && underlyingErrors[0]?.code);
        const actualErrorSyscall =
            error.syscall || (underlyingErrors && underlyingErrors[0]?.syscall);
        const actualErrorMessage =
            underlyingErrors && underlyingErrors[0]?.message
                ? underlyingErrors[0].message
                : error.message;

        const errorDetails = {
            method,
            endpoint,
            url: maskedUrl,
            apiUrl: apiUrl,
            hasToken: !!apiToken,
            tokenLength: apiToken ? apiToken.length : 0,
            // Error message details
            errorMessage: actualErrorMessage,
            errorString: String(error),
            error: error.response?.data || actualErrorMessage,
            // AggregateError details
            isAggregateError: error.name === "AggregateError",
            underlyingErrors: underlyingErrors,
            underlyingErrorsCount: underlyingErrors
                ? underlyingErrors.length
                : 0,
            // HTTP response details
            status: error.response?.status,
            statusText: error.response?.statusText,
            responseHeaders: error.response?.headers,
            responseData: error.response?.data,
            responseDataType: typeof error.response?.data,
            // Request details
            requestUrl: error.config?.url?.replace(/token=[^&]+/, "token=***"),
            requestMethod: error.config?.method,
            requestHeaders: error.config?.headers,
            requestData: error.config?.data,
            // Network error details
            errorCode: actualErrorCode,
            errorName: error.name,
            errorSyscall: actualErrorSyscall,
            errorAddress:
                error.address ||
                (underlyingErrors && underlyingErrors[0]?.address),
            errorPort:
                error.port || (underlyingErrors && underlyingErrors[0]?.port),
            // Stack trace
            stack: error.stack,
            // Additional context
            timestamp: new Date().toISOString(),
        };

        // Add network-specific error details
        const networkErrorCode = actualErrorCode || error.code;
        if (
            networkErrorCode === "ECONNREFUSED" ||
            networkErrorCode === "ETIMEDOUT"
        ) {
            errorDetails.networkError = true;
            try {
                const urlObj = new URL(apiUrl);
                errorDetails.connectionDetails = {
                    host: urlObj.hostname,
                    port:
                        urlObj.port ||
                        (urlObj.protocol === "https:" ? 443 : 80),
                    protocol: urlObj.protocol,
                    fullHost: urlObj.host,
                };
            } catch (urlError) {
                errorDetails.urlParseError = {
                    message: urlError.message,
                    apiUrl: apiUrl,
                };
            }
        }

        // Add timeout details
        if (networkErrorCode === "ETIMEDOUT") {
            errorDetails.timeoutDetails = {
                timeout: error.config?.timeout,
                connectTimeout: error.config?.connectTimeout,
            };
        }

        // Add SSL/TLS error details
        if (networkErrorCode === "ECONNRESET" || networkErrorCode === "EPIPE") {
            errorDetails.connectionReset = true;
        }

        // Log full error details
        logger.error("Joplin API request failed", errorDetails);

        // Also log a summary for quick debugging
        logger.error("Joplin API request failed - Summary", {
            method,
            endpoint,
            status: error.response?.status || "N/A",
            errorCode: actualErrorCode || error.code || "N/A",
            errorName: error.name || "N/A",
            errorMessage: actualErrorMessage || error.message || "N/A",
            isAggregateError: error.name === "AggregateError",
            underlyingErrorsCount: underlyingErrors
                ? underlyingErrors.length
                : 0,
            apiUrl: apiUrl,
            hasToken: !!apiToken,
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
 * Find or create the recycle pool notebook
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<string>} - Recycle pool notebook ID
 */
async function findOrCreateRecyclePool(options = {}) {
    try {
        const recyclePoolName = "_RECYCLE_POOL";

        // List all folders and search for recycle pool
        const allFolders = await apiRequest("GET", "/folders", null, options);

        if (allFolders.items && allFolders.items.length > 0) {
            for (const folder of allFolders.items) {
                if (folder.title === recyclePoolName && !folder.parent_id) {
                    return folder.id;
                }
            }
        }

        // Create recycle pool at root level (no parent)
        const newNotebook = await apiRequest(
            "POST",
            "/folders",
            {
                title: recyclePoolName,
                parent_id: "",
            },
            options
        );

        logger.info("Created recycle pool notebook", {
            notebookId: newNotebook.id,
        });

        return newNotebook.id;
    } catch (error) {
        logger.error("Error finding or creating recycle pool", {
            error: error.message,
        });
        throw error;
    }
}

/**
 * Move a note to the recycle pool
 * @param {string} noteId - Note ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<void>}
 */
async function moveNoteToRecyclePool(noteId, options = {}) {
    try {
        const recyclePoolId = await findOrCreateRecyclePool(options);

        // Update note's parent_id to move it to recycle pool
        await apiRequest(
            "PUT",
            `/notes/${noteId}`,
            {
                parent_id: recyclePoolId,
            },
            options
        );
    } catch (error) {
        logger.error("Error moving note to recycle pool", {
            noteId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Get all notes in a notebook
 * @param {string} notebookId - Notebook ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<Array>} - Array of note objects
 */
async function getAllNotesInNotebook(notebookId, options = {}) {
    try {
        const notes = await apiRequest(
            "GET",
            `/folders/${notebookId}/notes?fields=id,title,body,parent_id`,
            null,
            options
        );

        return notes.items || [];
    } catch (error) {
        logger.error("Error getting notes in notebook", {
            notebookId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Update an existing note
 * @param {string} noteId - Note ID
 * @param {string} title - Note title (optional)
 * @param {string} body - Note body (optional)
 * @param {string} parentId - Parent notebook ID (optional)
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<void>}
 */
async function updateNote(
    noteId,
    title = null,
    body = null,
    parentId = null,
    options = {}
) {
    try {
        const updateData = {};

        if (title !== null) {
            updateData.title = title;
        }
        if (body !== null) {
            updateData.body = body;
        }
        if (parentId !== null) {
            updateData.parent_id = parentId;
        }

        await apiRequest("PUT", `/notes/${noteId}`, updateData, options);
    } catch (error) {
        logger.error("Error updating note", {
            noteId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Delete a note by ID (DEPRECATED - use moveNoteToRecyclePool instead)
 * @param {string} noteId - Note ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<void>}
 * @deprecated Use moveNoteToRecyclePool instead
 */
async function deleteNote(noteId, options = {}) {
    logger.warn(
        "deleteNote is deprecated, using moveNoteToRecyclePool instead",
        {
            noteId,
        }
    );
    return moveNoteToRecyclePool(noteId, options);
}

/**
 * Delete all notes in a notebook (DEPRECATED - use moveAllNotesToRecyclePool instead)
 * @param {string} notebookId - Notebook ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<number>} - Number of notes moved to recycle pool
 * @deprecated Use moveAllNotesToRecyclePool instead
 */
async function deleteAllNotesInNotebook(notebookId, options = {}) {
    logger.warn(
        "deleteAllNotesInNotebook is deprecated, using moveAllNotesToRecyclePool instead",
        {
            notebookId,
        }
    );
    return moveAllNotesToRecyclePool(notebookId, options);
}

/**
 * Move all notes in a notebook to the recycle pool
 * @param {string} notebookId - Notebook ID
 * @param {Object} options - Options with apiUrl and apiToken
 * @returns {Promise<number>} - Number of notes moved
 */
async function moveAllNotesToRecyclePool(notebookId, options = {}) {
    try {
        const notes = await getAllNotesInNotebook(notebookId, options);
        const recyclePoolId = await findOrCreateRecyclePool(options);

        let movedCount = 0;
        if (notes && notes.length > 0) {
            for (const note of notes) {
                try {
                    await updateNote(
                        note.id,
                        null,
                        null,
                        recyclePoolId,
                        options
                    );
                    movedCount++;
                } catch (moveError) {
                    logger.warn("Error moving note to recycle pool", {
                        noteId: note.id,
                        noteTitle: note.title,
                        error: moveError.message,
                    });
                    // Continue with other notes even if one fails
                }
            }
        }

        return movedCount;
    } catch (error) {
        logger.error("Error moving notes to recycle pool", {
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
    const Book = require("../models/book");

    // Check if chunks need to be rebuilt
    const needsRebuild =
        book.rebuild_chunks === 1 || book.rebuild_chunks === true;

    let chunks = await Chunk.findByBookId(book.id);
    if (chunks && chunks.length > 0 && !needsRebuild) {
        return chunks;
    }

    let chunkJob = await ChunkJob.findByBookId(book.id);
    let jobId = chunkJob ? chunkJob.id : null;
    const effectiveChunkSize =
        (chunkJob && chunkJob.chunk_size) || chunkSize || DEFAULT_CHUNK_SIZE;
    let shouldStartProcessing = false;

    // If rebuild is needed, delete existing chunks and create new job
    if (needsRebuild && chunks && chunks.length > 0) {
        if (chunkJob) {
            await Chunk.deleteByChunkJobId(chunkJob.id);
        }
        // Clear the rebuild flag after starting rebuild
        await Book.update(book.id, { rebuild_chunks: false });
    }

    if (!chunkJob || needsRebuild) {
        jobId = await ChunkJob.create(book.id, effectiveChunkSize);
        chunkJob = await ChunkJob.findById(jobId);
        shouldStartProcessing = true;
    } else if (
        chunkJob.status === "failed" ||
        chunkJob.status === "ready" ||
        chunkJob.status === "completed"
    ) {
        if (chunkJob.status === "ready" || chunkJob.status === "completed") {
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
        if (chunkRoutes && typeof chunkRoutes.processChunkJob === "function") {
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
 * Sync chunks to Joplin using stored note IDs
 * Creates/ensures folder structure: Books root > author > book
 * Reuses existing note IDs stored in chunks table, only syncs if chunks were rebuilt after last sync
 * @param {Object} book - Book object with id, author, book_name_traditional, etc.
 * @param {Array} chunks - Array of chunk objects
 * @param {Object} options - Options with apiUrl and apiToken
 * @param {boolean} deleteAndRewrite - Deprecated, kept for compatibility but not used
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
        const ChunkJob = require("../models/chunkJob");
        const Book = require("../models/book");
        const Chunk = require("../models/chunk");

        // Check if sync is needed: compare chunk_jobs.completed_at with books.last_synced_to_joplin
        const chunkJob = await ChunkJob.findByBookId(book.id);
        if (!chunkJob || !chunkJob.completed_at) {
            logger.warn("No completed chunk job found, skipping sync", {
                bookId: book.id,
            });
            return 0;
        }

        const needsSync =
            !book.last_synced_to_joplin ||
            new Date(chunkJob.completed_at) >
                new Date(book.last_synced_to_joplin);

        if (!needsSync) {
            logger.info("Chunks not rebuilt since last sync, skipping", {
                bookId: book.id,
                lastSync: book.last_synced_to_joplin,
                chunkJobCompleted: chunkJob.completed_at,
            });
            return 0;
        }

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

        // Get recycle pool ID
        const recyclePoolId = await findOrCreateRecyclePool(options);

        // Prepare tags (include author name)
        const tags = [];
        if (authorTraditional && authorTraditional !== "未知作者") {
            tags.push(authorTraditional);
        }

        let syncedCount = 0;
        const currentChunkIds = new Set(); // Track current chunk IDs

        // Sync each chunk
        for (const chunk of chunks) {
            try {
                currentChunkIds.add(chunk.id);

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
                let noteId = null;

                // If chunk has stored joplin_note_id, try to update that note
                if (chunk.joplin_note_id) {
                    try {
                        await updateNote(
                            chunk.joplin_note_id,
                            chunkTitle,
                            chunk.content || "",
                            bookNotebookId,
                            options
                        );
                        noteId = chunk.joplin_note_id;
                        logger.info("Updated existing note by ID", {
                            bookId: book.id,
                            chunkNumber: chunk.chunk_number,
                            noteId,
                        });
                    } catch (updateError) {
                        // Note doesn't exist, create new one
                        logger.warn("Note ID not found, creating new note", {
                            bookId: book.id,
                            chunkNumber: chunk.chunk_number,
                            oldNoteId: chunk.joplin_note_id,
                            error: updateError.message,
                        });
                        noteId = await createNote(
                            chunkTitle,
                            chunk.content || "",
                            bookNotebookId,
                            tags,
                            options
                        );
                        await Chunk.update(chunk.id, {
                            joplin_note_id: noteId,
                        });
                        logger.info("Created new note after old ID failed", {
                            bookId: book.id,
                            chunkNumber: chunk.chunk_number,
                            noteId,
                        });
                    }
                } else {
                    // No stored ID, create new note
                    noteId = await createNote(
                        chunkTitle,
                        chunk.content || "",
                        bookNotebookId,
                        tags,
                        options
                    );
                    await Chunk.update(chunk.id, { joplin_note_id: noteId });
                    logger.info("Created new note", {
                        bookId: book.id,
                        chunkNumber: chunk.chunk_number,
                        noteId,
                    });
                }

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

        // Handle orphaned chunks: find chunks that exist in DB but not in current chunk list
        // Move their notes to recycle pool and clear joplin_note_id
        const allBookChunks = await Chunk.findByBookId(book.id);
        for (const dbChunk of allBookChunks) {
            if (dbChunk.joplin_note_id && !currentChunkIds.has(dbChunk.id)) {
                try {
                    await moveNoteToRecyclePool(
                        dbChunk.joplin_note_id,
                        options
                    );
                    await Chunk.update(dbChunk.id, { joplin_note_id: null });
                    logger.info("Moved orphaned chunk note to recycle pool", {
                        bookId: book.id,
                        chunkId: dbChunk.id,
                        chunkNumber: dbChunk.chunk_number,
                        noteId: dbChunk.joplin_note_id,
                    });
                } catch (moveError) {
                    logger.warn(
                        "Error moving orphaned chunk note to recycle pool",
                        {
                            bookId: book.id,
                            chunkId: dbChunk.id,
                            noteId: dbChunk.joplin_note_id,
                            error: moveError.message,
                        }
                    );
                }
            }
        }

        // Update book's joplin_notebook_id and last_synced_to_joplin timestamp
        await Book.update(book.id, {
            joplin_notebook_id: bookNotebookId,
            last_synced_to_joplin: new Date().toISOString(),
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
    const startTime = Date.now();
    const apiUrl = options.apiUrl || JOPLIN_API_URL;
    const apiToken = options.apiToken || JOPLIN_API_TOKEN;

    logger.info("Testing Joplin API connection", {
        apiUrl: apiUrl,
        endpoint: "/ping",
        hasToken: !!apiToken,
        tokenLength: apiToken ? apiToken.length : 0,
        timestamp: new Date().toISOString(),
    });

    try {
        const response = await apiRequest("GET", "/ping", null, options);
        const duration = Date.now() - startTime;
        logger.info("Joplin API connection test successful", {
            apiUrl: apiUrl,
            duration: `${duration}ms`,
            response: response,
        });
        return true;
    } catch (error) {
        const duration = Date.now() - startTime;

        // Enhanced error logging for connection test
        const hasToken = !!apiToken;

        // Extract underlying errors if this is an AggregateError
        let underlyingErrors = null;
        if (
            error.name === "AggregateError" &&
            error.errors &&
            Array.isArray(error.errors)
        ) {
            underlyingErrors = error.errors.map((err, index) => ({
                index: index,
                name: err.name,
                message: err.message,
                code: err.code,
                syscall: err.syscall,
                address: err.address,
                port: err.port,
                errno: err.errno,
                stack: err.stack,
            }));
        }

        // Try to get the actual error code from underlying errors if AggregateError
        const actualErrorCode =
            error.code || (underlyingErrors && underlyingErrors[0]?.code);
        const actualErrorSyscall =
            error.syscall || (underlyingErrors && underlyingErrors[0]?.syscall);
        const actualErrorMessage =
            underlyingErrors && underlyingErrors[0]?.message
                ? underlyingErrors[0].message
                : error.message;

        const errorDetails = {
            // Basic error info
            errorMessage: actualErrorMessage,
            errorString: String(error),
            error: error.response?.data || actualErrorMessage,
            errorCode: actualErrorCode,
            errorName: error.name,
            errorSyscall: actualErrorSyscall,
            // AggregateError details
            isAggregateError: error.name === "AggregateError",
            underlyingErrors: underlyingErrors,
            underlyingErrorsCount: underlyingErrors
                ? underlyingErrors.length
                : 0,
            // Connection details
            apiUrl: apiUrl,
            endpoint: "/ping",
            hasToken: hasToken,
            tokenLength: apiToken ? apiToken.length : 0,
            // HTTP response details
            status: error.response?.status,
            statusText: error.response?.statusText,
            responseData: error.response?.data,
            responseHeaders: error.response?.headers,
            // Request details
            requestUrl: error.config?.url?.replace(/token=[^&]+/, "token=***"),
            requestMethod: error.config?.method,
            requestHeaders: error.config?.headers,
            // Timing
            duration: `${duration}ms`,
            // Stack trace
            stack: error.stack,
            // Timestamp
            timestamp: new Date().toISOString(),
        };

        // Add network-specific error details
        // Check both the main error code and underlying error codes
        const networkErrorCode = actualErrorCode || error.code;
        if (networkErrorCode === "ECONNREFUSED") {
            errorDetails.networkError =
                "Connection refused - Joplin may not be running";
            try {
                const urlObj = new URL(apiUrl);
                errorDetails.connectionDetails = {
                    host: urlObj.hostname,
                    port:
                        urlObj.port ||
                        (urlObj.protocol === "https:" ? 443 : 80),
                    protocol: urlObj.protocol,
                    fullHost: urlObj.host,
                };
            } catch (urlError) {
                errorDetails.urlParseError = {
                    message: urlError.message,
                    apiUrl: apiUrl,
                };
            }
        } else if (networkErrorCode === "ETIMEDOUT") {
            errorDetails.networkError =
                "Connection timeout - Joplin may be slow to respond";
            errorDetails.timeoutDetails = {
                timeout: error.config?.timeout,
                connectTimeout: error.config?.connectTimeout,
            };
        } else if (networkErrorCode === "ECONNRESET") {
            errorDetails.networkError =
                "Connection reset - connection was closed unexpectedly";
        } else if (networkErrorCode === "EPIPE") {
            errorDetails.networkError = "Broken pipe - connection was closed";
        } else if (error.response?.status === 401) {
            errorDetails.authError =
                "Authentication failed - invalid API token";
        } else if (error.response?.status === 403) {
            errorDetails.authError =
                "Forbidden - token may not have required permissions";
        } else if (error.response?.status === 404) {
            errorDetails.notFoundError =
                "Endpoint not found - API version mismatch?";
        } else if (error.response?.status >= 500) {
            errorDetails.serverError = `Server error (${error.response?.status}) - Joplin server may be having issues`;
        }

        // Log detailed error
        logger.error("Joplin API connection test failed", errorDetails);

        // Also log a concise summary
        logger.error("Joplin API connection test failed - Summary", {
            apiUrl: apiUrl,
            status: error.response?.status || "N/A",
            errorCode: actualErrorCode || error.code || "N/A",
            errorName: error.name || "N/A",
            errorMessage: actualErrorMessage || error.message || "N/A",
            isAggregateError: error.name === "AggregateError",
            underlyingErrorsCount: underlyingErrors
                ? underlyingErrors.length
                : 0,
            duration: `${duration}ms`,
            networkError: errorDetails.networkError || null,
            authError: errorDetails.authError || null,
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
 * Moves all notes to recycle pool before recreating folder structure
 * Never deletes notebooks per recycle pool policy
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

        // Move all notes from existing folder to recycle pool (never delete)
        if (book.joplin_notebook_id) {
            try {
                const movedCount = await moveAllNotesToRecyclePool(
                    book.joplin_notebook_id,
                    options
                );
                logger.info(
                    "Moved notes to recycle pool before recreating folder",
                    {
                        notebookId: book.joplin_notebook_id,
                        movedCount,
                    }
                );
            } catch (moveError) {
                logger.warn(
                    "Error moving notes to recycle pool (may not exist)",
                    {
                        notebookId: book.joplin_notebook_id,
                        error: moveError.message,
                    }
                );
            }
            // Note: We don't delete the folder per "never delete notebooks" policy
            // The folder will remain empty or be reused if structure matches
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
 * Syncs all books with sync_to_joplin=1 and moves notes to recycle pool for books with sync_to_joplin=0
 * Never deletes notebooks per recycle pool policy
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

                // Sync chunks (only syncs if chunks were rebuilt after last sync)
                let bookSyncedChunks = 0;
                if (chunks && chunks.length > 0) {
                    bookSyncedChunks = await syncChunksToJoplin(
                        book,
                        chunks,
                        options,
                        false // deleteAndRewrite is deprecated, sync logic now handles this automatically
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

        // Move notes to recycle pool for books not marked for sync (never delete notebooks)
        for (const book of booksToRemove) {
            try {
                if (book.joplin_notebook_id) {
                    // Move all notes to recycle pool (never delete notebooks per policy)
                    const movedCount = await moveAllNotesToRecyclePool(
                        book.joplin_notebook_id,
                        options
                    );

                    // Clear the joplin_notebook_id from the book
                    await Book.update(book.id, {
                        joplin_notebook_id: null,
                    });

                    removedNotebooks++;
                    logger.info(
                        "Moved notes to recycle pool for book not marked for sync",
                        {
                            bookId: book.id,
                            notebookId: book.joplin_notebook_id,
                            movedCount,
                        }
                    );
                }

                await JoplinJob.update(jobId, {
                    completed_items: syncedBooks + removedNotebooks,
                });
            } catch (removeError) {
                logger.error("Error moving notes to recycle pool", {
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

                // Sync chunks (only syncs if chunks were rebuilt after last sync)
                let bookSyncedChunks = 0;
                if (chunks && chunks.length > 0) {
                    bookSyncedChunks = await syncChunksToJoplin(
                        book,
                        chunks,
                        options,
                        false // deleteAndRewrite is deprecated, sync logic now handles this automatically
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

// only export the functions that call by external jobs

module.exports = {
    syncChunksToJoplin,
    createFolderStructure,
    findOrCreateNotebook,
    createNote,
    updateNote,
    deleteNote, // Deprecated but kept for backward compatibility
    deleteAllNotesInNotebook, // Deprecated but kept for backward compatibility
    moveNoteToRecyclePool,
    moveAllNotesToRecyclePool,
    findOrCreateRecyclePool,
    getAllNotesInNotebook,
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
