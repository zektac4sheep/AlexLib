const express = require("express");
const router = express.Router();
const Book = require("../models/book");
const Chapter = require("../models/chapter");
const ChunkJob = require("../models/chunkJob");
const Chunk = require("../models/chunk");
const { createChunksFromChapters } = require("../services/chunker");
const logger = require("../utils/logger");

// Get all books with chunk status
router.get("/books", async (req, res) => {
    try {
        const books = await Book.findAll();
        const booksWithChunkStatus = await Promise.all(
            books.map(async (book) => {
                const chunkJob = await ChunkJob.findByBookId(book.id);
                const chapters = await Chapter.findByBookId(book.id);
                
                return {
                    ...book,
                    chunkStatus: chunkJob ? chunkJob.status : null,
                    chunkJobId: chunkJob ? chunkJob.id : null,
                    hasChapters: chapters && chapters.length > 0,
                    totalChapters: chapters ? chapters.length : 0,
                };
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

        // Prepare chapters for chunking
        const chaptersForChunking = chapters.map((ch) => ({
            chapterNumber: ch.chapter_number,
            chapterTitle: ch.chapter_title || ch.chapter_title_simplified,
            content: ch.content || "",
        }));

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

        // Store chunks in database
        for (const chunk of chunks) {
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
            try {
                const joplinService = require("../services/joplinService");
                
                // Fetch chunks from database for sync
                const dbChunks = await Chunk.findByChunkJobId(jobId);
                
                if (dbChunks && dbChunks.length > 0) {
                    // Format chunks for Joplin sync
                    const chunksForSync = dbChunks.map((ch) => ({
                        chunk_number: ch.chunk_number,
                        total_chunks: ch.total_chunks,
                        content: ch.content,
                    }));

                    const syncResult = await joplinService.syncChunksToJoplin(
                        book,
                        chunksForSync
                    );

                    logger.info("Chunks synced to Joplin", {
                        bookId,
                        jobId,
                        syncedChunks: syncResult.syncedChunks,
                        totalChunks: syncResult.totalChunks,
                        chunksNotebookId: syncResult.chunksNotebookId,
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
module.exports = router;
module.exports.processChunkJob = processChunkJob;

