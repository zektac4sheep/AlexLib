const express = require("express");
const router = express.Router();
const Book = require("../models/book");
const Chapter = require("../models/chapter");
const ChunkJob = require("../models/chunkJob");
const Chunk = require("../models/chunk");
const { createChunksFromChapters } = require("../services/chunker");
const textProcessor = require("../services/textProcessor");
const logger = require("../utils/logger");

// Get all books with chunk status
router.get("/books", async (req, res) => {
    try {
        const books = await Book.findAll();
        const booksWithChunkStatus = await Promise.all(
            books.map(async (book) => {
                const chunkJob = await ChunkJob.findByBookId(book.id);
                const chapters = await Chapter.findByBookId(book.id);
                
                const result = {
                    ...book,
                    chunkStatus: chunkJob ? chunkJob.status : null,
                    chunkJobId: chunkJob ? chunkJob.id : null,
                    hasChapters: chapters && chapters.length > 0,
                    totalChapters: chapters ? chapters.length : 0,
                };
                
                // Add progress information for processing jobs
                if (chunkJob && (chunkJob.status === "processing" || chunkJob.status === "queued")) {
                    result.chunkJobProgress = {
                        completed_items: chunkJob.completed_items || 0,
                        total_items: chunkJob.total_items || 0,
                    };
                }
                
                return result;
            })
        );

        // Separate into waiting (queued/processing) and ready (ready/completed)
        const waiting = booksWithChunkStatus.filter(
            (book) =>
                book.chunkStatus === "queued" ||
                book.chunkStatus === "processing"
        );
        const ready = booksWithChunkStatus.filter(
            (book) =>
                book.chunkStatus === "ready" || book.chunkStatus === "completed"
        );
        const available = booksWithChunkStatus.filter(
            (book) =>
                !book.chunkStatus &&
                book.hasChapters &&
                book.totalChapters > 0
        );

        res.json({
            waiting,
            ready,
            available,
        });
    } catch (error) {
        logger.error("Error fetching books with chunk status", { error });
        res.status(500).json({ error: "Failed to fetch books" });
    }
});

// Get books that need chunks created/rebuilt
router.get("/books-needing-chunks", async (req, res) => {
    try {
        const books = await Book.findAll();
        const booksNeedingChunks = [];

        for (const book of books) {
            const chapters = await Chapter.findByBookId(book.id);
            const chunkJob = await ChunkJob.findByBookId(book.id);
            const chunks = chunkJob ? await Chunk.findByChunkJobId(chunkJob.id) : [];
            
            // A book needs chunks if:
            // 1. It has chapters but no chunk job
            // 2. It has a chunk job but status is not "ready" or "completed"
            // 3. It has the rebuild_chunks flag set
            // 4. It has a failed chunk job
            const hasChapters = chapters && chapters.length > 0;
            const needsRebuild = book.rebuild_chunks === 1 || book.rebuild_chunks === true;
            const hasValidChunks = chunkJob && 
                (chunkJob.status === "ready" || chunkJob.status === "completed") &&
                chunks && chunks.length > 0;
            
            const needsChunks = hasChapters && (
                !chunkJob || 
                needsRebuild ||
                chunkJob.status === "failed" ||
                (!hasValidChunks && chunkJob.status !== "queued" && chunkJob.status !== "processing")
            );

            if (needsChunks) {
                const bookInfo = {
                    id: book.id,
                    book_name_simplified: book.book_name_simplified,
                    book_name_traditional: book.book_name_traditional,
                    author: book.author,
                    total_chapters: chapters ? chapters.length : 0,
                    rebuild_chunks: needsRebuild,
                    chunkStatus: chunkJob ? chunkJob.status : null,
                    chunkJobId: chunkJob ? chunkJob.id : null,
                    totalChunks: chunks ? chunks.length : 0,
                    reason: needsRebuild ? "marked_for_rebuild" : 
                           !chunkJob ? "no_chunk_job" :
                           chunkJob.status === "failed" ? "chunk_job_failed" :
                           !hasValidChunks ? "chunks_incomplete" : "unknown",
                };

                // Add progress information for processing jobs
                if (chunkJob && (chunkJob.status === "processing" || chunkJob.status === "queued")) {
                    bookInfo.chunkJobProgress = {
                        completed_items: chunkJob.completed_items || 0,
                        total_items: chunkJob.total_items || 0,
                    };
                }

                booksNeedingChunks.push(bookInfo);
            }
        }

        // Sort by: rebuild_chunks first, then by status (queued/processing before others), then by book name
        booksNeedingChunks.sort((a, b) => {
            if (a.rebuild_chunks !== b.rebuild_chunks) {
                return b.rebuild_chunks - a.rebuild_chunks; // rebuild_chunks=true first
            }
            const statusOrder = { "queued": 0, "processing": 1, "failed": 2, null: 3 };
            const aOrder = statusOrder[a.chunkStatus] ?? 4;
            const bOrder = statusOrder[b.chunkStatus] ?? 4;
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            const aName = (a.book_name_traditional || a.book_name_simplified || "").toLowerCase();
            const bName = (b.book_name_traditional || b.book_name_simplified || "").toLowerCase();
            return aName.localeCompare(bName);
        });

        res.json({
            books: booksNeedingChunks,
            total: booksNeedingChunks.length,
        });
    } catch (error) {
        logger.error("Error fetching books needing chunks", { error });
        res.status(500).json({ error: "Failed to fetch books needing chunks" });
    }
});

// Start chunk generation for a book (background job)
router.post("/books/:bookId/generate", async (req, res) => {
    try {
        const bookId = parseInt(req.params.bookId);
        const { chunkSize = 1000 } = req.body;

        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        // Check if there's already a job for this book
        const existingJob = await ChunkJob.findByBookId(bookId);
        if (existingJob && (existingJob.status === "queued" || existingJob.status === "processing")) {
            return res.json({
                message: "Chunk generation already in progress",
                jobId: existingJob.id,
            });
        }

        // If there's an existing completed/ready job, delete old chunks before creating new job
        if (existingJob && (existingJob.status === "ready" || existingJob.status === "completed")) {
            await Chunk.deleteByChunkJobId(existingJob.id);
        }

        // Create new job
        const jobId = await ChunkJob.create(bookId, chunkSize);

        // Start processing in background (non-blocking)
        processChunkJob(jobId, bookId, chunkSize).catch((err) => {
            logger.error("Error processing chunk job", {
                jobId,
                bookId,
                error: err,
            });
        });

        res.json({
            message: "Chunk generation started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting chunk generation", { error });
        res.status(500).json({ error: "Failed to start chunk generation" });
    }
});

// Rebuild all chunks for all books that have chunks
router.post("/rebuild-all", async (req, res) => {
    try {
        const { chunkSize = 1000 } = req.body;

        // Get all books that have chunk jobs (ready or completed)
        const books = await Book.findAll();
        const booksWithChunks = [];

        for (const book of books) {
            const chunkJob = await ChunkJob.findByBookId(book.id);
            if (chunkJob && (chunkJob.status === "ready" || chunkJob.status === "completed")) {
                booksWithChunks.push({
                    bookId: book.id,
                    bookName: book.book_name_traditional || book.book_name_simplified,
                    chunkJobId: chunkJob.id,
                });
            }
        }

        if (booksWithChunks.length === 0) {
            return res.json({
                message: "No books with chunks found to rebuild",
                rebuilt: 0,
            });
        }

        let rebuiltCount = 0;
        const errors = [];

        // Rebuild chunks for each book
        for (const { bookId, bookName, chunkJobId } of booksWithChunks) {
            try {
                // Delete old chunks
                await Chunk.deleteByChunkJobId(chunkJobId);

                // Create new job
                const newJobId = await ChunkJob.create(bookId, chunkSize);

                // Start processing in background
                processChunkJob(newJobId, bookId, chunkSize).catch((err) => {
                    logger.error("Error processing chunk job during rebuild", {
                        jobId: newJobId,
                        bookId,
                        error: err,
                    });
                });

                rebuiltCount++;
            } catch (error) {
                logger.error("Error rebuilding chunks for book", {
                    bookId,
                    bookName,
                    error: error.message,
                });
                errors.push({
                    bookId,
                    bookName,
                    error: error.message,
                });
            }
        }

        res.json({
            message: `Rebuild started for ${rebuiltCount} book(s)`,
            rebuilt: rebuiltCount,
            total: booksWithChunks.length,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch (error) {
        logger.error("Error rebuilding all chunks", { error });
        res.status(500).json({
            error: "Failed to rebuild all chunks",
            message: error.message,
        });
    }
});

// Get chunk preview for a book
router.get("/books/:bookId/preview", async (req, res) => {
    try {
        const bookId = parseInt(req.params.bookId);
        const chunkJob = await ChunkJob.findByBookId(bookId);

        if (!chunkJob || (chunkJob.status !== "ready" && chunkJob.status !== "completed")) {
            return res.status(404).json({
                error: "Chunk preview not available. Please generate chunks first.",
            });
        }

        // Fetch chunks from database
        const chunks = await Chunk.findByChunkJobId(chunkJob.id) || [];
        
        // Format chunks for response
        const chunksData = Array.isArray(chunks) 
            ? chunks.map((chunk) => ({
                chunkNumber: chunk.chunk_number,
                totalChunks: chunk.total_chunks,
                lineStart: chunk.line_start,
                lineEnd: chunk.line_end,
                firstChapter: chunk.first_chapter,
                lastChapter: chunk.last_chapter,
                chapterCount: chunk.chapter_count,
                chaptersInChunk: chunk.chapters_data || [],
                content: chunk.content,
            }))
            : [];

        const book = await Book.findById(bookId);

        res.json({
            book: {
                id: book.id,
                book_name_simplified: book.book_name_simplified,
                book_name_traditional: book.book_name_traditional,
                author: book.author,
                category: book.category,
                description: book.description,
            },
            chunks: chunksData,
            totalChunks: chunkJob.total_chunks,
            chunkSize: chunkJob.chunk_size,
            status: chunkJob.status,
        });
    } catch (error) {
        logger.error("Error fetching chunk preview", { error });
        res.status(500).json({ error: "Failed to fetch chunk preview" });
    }
});

// Get a specific chunk content
router.get("/books/:bookId/chunks/:chunkNumber", async (req, res) => {
    try {
        const bookId = parseInt(req.params.bookId);
        const chunkNumber = parseInt(req.params.chunkNumber);
        const chunkJob = await ChunkJob.findByBookId(bookId);

        if (!chunkJob || (chunkJob.status !== "ready" && chunkJob.status !== "completed")) {
            return res.status(404).json({
                error: "Chunks not available. Please generate chunks first.",
            });
        }

        // Fetch chunk from database
        const chunk = await Chunk.findByChunkJobIdAndNumber(chunkJob.id, chunkNumber);

        if (!chunk) {
            return res.status(404).json({ error: "Chunk not found" });
        }

        // Format chunk for response
        res.json({
            chunkNumber: chunk.chunk_number,
            totalChunks: chunk.total_chunks,
            lineStart: chunk.line_start,
            lineEnd: chunk.line_end,
            firstChapter: chunk.first_chapter,
            lastChapter: chunk.last_chapter,
            chapterCount: chunk.chapter_count,
            chaptersInChunk: chunk.chapters_data || [],
            content: chunk.content,
        });
    } catch (error) {
        logger.error("Error fetching chunk", { error });
        res.status(500).json({ error: "Failed to fetch chunk" });
    }
});

// Background job processor
async function processChunkJob(jobId, bookId, chunkSize, options = {}) {
    const skipJoplinSync = options.skipJoplinSync === true;
    try {
        // Update status to processing
        await ChunkJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        // Get book and chapters
        const book = await Book.findById(bookId);
        if (!book) {
            throw new Error("Book not found");
        }

        const chapters = await Chapter.findByBookId(bookId);
        if (!chapters || chapters.length === 0) {
            throw new Error("No chapters found for this book");
        }

        // Prepare chapters for chunking - reformat each chapter content
        const chaptersForChunking = chapters.map((ch) => {
            const chapterTitle = ch.chapter_title || ch.chapter_title_simplified || "";
            // Reformat chapter content when creating chunks
            const reformattedContent = textProcessor.reformatChapterContent(
                ch.content || "",
                chapterTitle,
                true // Convert to Traditional Chinese
            );
            return {
                chapterNumber: ch.chapter_number,
                chapterTitle: chapterTitle,
                series: ch.series || "official",
                content: reformattedContent,
            };
        });

        // Generate chunks
        const bookTitle = book.book_name_traditional || book.book_name_simplified;
        const metadata = {
            author: book.author,
            category: book.category,
            description: book.description,
        };
        const chunks = createChunksFromChapters(
            chaptersForChunking,
            bookTitle,
            chunkSize,
            metadata
        );

        // Delete any existing chunks for this job (in case of regeneration)
        await Chunk.deleteByChunkJobId(jobId);

        // Update job with total items for progress tracking
        await ChunkJob.update(jobId, {
            total_items: chunks.length,
            completed_items: 0,
        });

        // Store chunks in database with progress tracking
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            await Chunk.create({
                chunk_job_id: jobId,
                book_id: bookId,
                chunk_number: chunk.chunkNumber,
                total_chunks: chunk.totalChunks,
                content: chunk.content,
                line_start: chunk.lineStart,
                line_end: chunk.lineEnd,
                first_chapter: chunk.firstChapter,
                last_chapter: chunk.lastChapter,
                chapter_count: chunk.chapterCount,
                chapters_data: chunk.chaptersInChunk,
            });
            
            // Update progress
            await ChunkJob.update(jobId, {
                completed_items: i + 1,
            });
        }

        // Update job with results
        await ChunkJob.update(jobId, {
            status: "ready",
            chunks_data: null, // No longer needed, stored in chunks table
            total_chunks: chunks.length,
            completed_at: new Date().toISOString(),
        });

        logger.info("Chunk job completed", {
            jobId,
            bookId,
            totalChunks: chunks.length,
        });

        // Sync to Joplin if enabled and not explicitly skipped
        if (
            !skipJoplinSync &&
            (book.sync_to_joplin === 1 || book.sync_to_joplin === true)
        ) {
            // Check if chunks need to be rebuilt before syncing
            if (book.rebuild_chunks === 1 || book.rebuild_chunks === true) {
                logger.info("Book marked for chunk rebuild, rebuilding chunks before Joplin sync", {
                    bookId,
                    jobId,
                });
                // Chunks are already rebuilt in this job, so just clear the flag
                await Book.update(bookId, { rebuild_chunks: false });
            }
            
            // Check if Joplin API token is configured before attempting sync
            const joplinApiToken = process.env.JOPLIN_API_TOKEN;
            if (!joplinApiToken) {
                logger.warn("Joplin sync skipped: JOPLIN_API_TOKEN is not configured", {
                    bookId,
                    jobId,
                });
            } else {
                try {
                    const joplinService = require("../services/joplinService");
                    
                    // Fetch chunks from database for sync
                    const dbChunks = await Chunk.findByChunkJobId(jobId);
                    
                    if (dbChunks && dbChunks.length > 0) {
                        // Pass full chunk objects for Joplin sync (includes id, joplin_note_id, etc.)
                        const syncResult = await joplinService.syncChunksToJoplin(
                            book,
                            dbChunks
                        );

                        logger.info("Chunks synced to Joplin", {
                            bookId,
                            jobId,
                            syncedChunks: syncResult,
                        });
                    }
                } catch (syncError) {
                    logger.error("Error syncing chunks to Joplin", {
                        bookId,
                        jobId,
                        error: syncError.message,
                    });
                    // Don't fail the chunk job if sync fails
                }
            }
        }
    } catch (error) {
        logger.error("Error processing chunk job", {
            jobId,
            bookId,
            error,
        });

        await ChunkJob.update(jobId, {
            status: "failed",
            error_message: error.message,
            completed_at: new Date().toISOString(),
        });
    }
}

// Export processChunkJob for use by job resumption service
// Reformat a single chunk (background job)
router.post("/books/:bookId/chunks/:chunkNumber/reformat", async (req, res) => {
    try {
        const bookId = parseInt(req.params.bookId);
        const chunkNumber = parseInt(req.params.chunkNumber);

        const chunkJob = await ChunkJob.findByBookId(bookId);
        if (!chunkJob || (chunkJob.status !== "ready" && chunkJob.status !== "completed")) {
            return res.status(404).json({
                error: "Chunks not available. Please generate chunks first.",
            });
        }

        const chunk = await Chunk.findByChunkJobIdAndNumber(chunkJob.id, chunkNumber);
        if (!chunk) {
            return res.status(404).json({ error: "Chunk not found" });
        }

        // Create a reformat job
        const jobId = await ChunkJob.create(bookId, chunkJob.chunk_size);

        // Start processing in background
        processReformatChunkJob(jobId, bookId, chunkJob.id, chunkNumber).catch(
            (err) => {
                logger.error("Error processing reformat chunk job", {
                    jobId,
                    bookId,
                    chunkNumber,
                    error: err,
                });
            }
        );

        res.json({
            message: "Chunk reformat started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting chunk reformat", { error });
        res.status(500).json({ error: "Failed to start chunk reformat" });
    }
});

// Reformat all chunks for a book (background job)
router.post("/books/:bookId/reformat", async (req, res) => {
    try {
        const bookId = parseInt(req.params.bookId);
        const { chunkSize } = req.body;

        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        const chunkJob = await ChunkJob.findByBookId(bookId);
        if (!chunkJob || (chunkJob.status !== "ready" && chunkJob.status !== "completed")) {
            return res.status(404).json({
                error: "Chunks not available. Please generate chunks first.",
            });
        }

        // Create a reformat job
        const effectiveChunkSize = chunkSize || chunkJob.chunk_size || 1000;
        const jobId = await ChunkJob.create(bookId, effectiveChunkSize);

        // Start processing in background
        processReformatBookChunksJob(jobId, bookId, effectiveChunkSize).catch(
            (err) => {
                logger.error("Error processing reformat book chunks job", {
                    jobId,
                    bookId,
                    error: err,
                });
            }
        );

        res.json({
            message: "Book chunks reformat started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting book chunks reformat", { error });
        res.status(500).json({ error: "Failed to start book chunks reformat" });
    }
});

// Background job processor for reformatting a single chunk
async function processReformatChunkJob(
    jobId,
    bookId,
    originalChunkJobId,
    chunkNumber
) {
    try {
        await ChunkJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        const book = await Book.findById(bookId);
        if (!book) {
            throw new Error("Book not found");
        }

        // Get the original chunk
        const originalChunk = await Chunk.findByChunkJobIdAndNumber(
            originalChunkJobId,
            chunkNumber
        );
        if (!originalChunk) {
            throw new Error("Chunk not found");
        }

        // Get chapters for this book
        const chapters = await Chapter.findByBookId(bookId);
        if (!chapters || chapters.length === 0) {
            throw new Error("No chapters found for this book");
        }

        // Get chapters that are in this chunk
        const chunkChaptersData = originalChunk.chapters_data || [];
        const chunkChapterNumbers = chunkChaptersData.map(
            (ch) => ch.chapterNumber
        );

        // Prepare chapters for chunking - reformat each chapter content
        const chaptersForChunking = chapters.map((ch) => {
            const chapterTitle = ch.chapter_title || ch.chapter_title_simplified || "";
            // Reformat chapter content when creating chunks
            const reformattedContent = textProcessor.reformatChapterContent(
                ch.content || "",
                chapterTitle,
                true // Convert to Traditional Chinese
            );
            return {
                chapterNumber: ch.chapter_number,
                chapterTitle: chapterTitle,
                content: reformattedContent,
            };
        });

        // Filter to only chapters in this chunk
        const filteredChapters = chaptersForChunking.filter((ch) =>
            chunkChapterNumbers.includes(ch.chapterNumber)
        );

        // Generate chunks from these chapters
        const bookTitle = book.book_name_traditional || book.book_name_simplified;
        const metadata = {
            author: book.author,
            category: book.category,
            description: book.description,
        };

        // Get the chunk size from original job
        const originalJob = await ChunkJob.findById(originalChunkJobId);
        const chunkSize = originalJob ? originalJob.chunk_size : 1000;

        // Create chunks - this will create chunks from the filtered chapters
        // We need to get all chunks to find the one that matches our chunk number
        const allChunks = createChunksFromChapters(
            chaptersForChunking,
            bookTitle,
            chunkSize,
            metadata
        );

        // Find the chunk that matches our chunk number
        const reformattedChunk = allChunks.find(
            (ch) => ch.chunkNumber === chunkNumber
        );

        if (!reformattedChunk) {
            throw new Error("Could not find reformatted chunk");
        }

        // Update the original chunk with reformatted content
        await Chunk.update(originalChunk.id, {
            content: reformattedChunk.content,
        });

        await ChunkJob.update(jobId, {
            status: "ready",
            completed_at: new Date().toISOString(),
        });

        logger.info("Chunk reformat completed", {
            jobId,
            bookId,
            chunkNumber,
        });
    } catch (error) {
        logger.error("Error processing reformat chunk job", {
            jobId,
            bookId,
            chunkNumber,
            error: error.message,
        });
        await ChunkJob.update(jobId, {
            status: "failed",
            error_message: error.message,
        });
    }
}

// Background job processor for reformatting all chunks for a book
async function processReformatBookChunksJob(jobId, bookId, chunkSize) {
    try {
        await ChunkJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        const book = await Book.findById(bookId);
        if (!book) {
            throw new Error("Book not found");
        }

        const chapters = await Chapter.findByBookId(bookId);
        if (!chapters || chapters.length === 0) {
            throw new Error("No chapters found for this book");
        }

        // Prepare chapters for chunking - reformat each chapter content
        const chaptersForChunking = chapters.map((ch) => {
            const chapterTitle = ch.chapter_title || ch.chapter_title_simplified || "";
            // Reformat chapter content when creating chunks
            const reformattedContent = textProcessor.reformatChapterContent(
                ch.content || "",
                chapterTitle,
                true // Convert to Traditional Chinese
            );
            return {
                chapterNumber: ch.chapter_number,
                chapterTitle: chapterTitle,
                series: ch.series || "official",
                content: reformattedContent,
            };
        });

        // Generate chunks
        const bookTitle = book.book_name_traditional || book.book_name_simplified;
        const metadata = {
            author: book.author,
            category: book.category,
            description: book.description,
        };
        const chunks = createChunksFromChapters(
            chaptersForChunking,
            bookTitle,
            chunkSize,
            metadata
        );

        // Get the original chunk job
        const originalChunkJob = await ChunkJob.findByBookId(bookId);
        if (!originalChunkJob) {
            throw new Error("Original chunk job not found");
        }

        // Update all chunks
        const originalChunks = await Chunk.findByChunkJobId(originalChunkJob.id);
        for (const originalChunk of originalChunks) {
            const reformattedChunk = chunks.find(
                (ch) => ch.chunkNumber === originalChunk.chunk_number
            );
            if (reformattedChunk) {
                await Chunk.update(originalChunk.id, {
                    content: reformattedChunk.content,
                });
            }
        }

        await ChunkJob.update(jobId, {
            status: "ready",
            total_chunks: chunks.length,
            completed_at: new Date().toISOString(),
        });

        logger.info("Book chunks reformat completed", {
            jobId,
            bookId,
            totalChunks: chunks.length,
        });
    } catch (error) {
        logger.error("Error processing reformat book chunks job", {
            jobId,
            bookId,
            error: error.message,
        });
        await ChunkJob.update(jobId, {
            status: "failed",
            error_message: error.message,
        });
    }
}

module.exports = router;
module.exports.processChunkJob = processChunkJob;

