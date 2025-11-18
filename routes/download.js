const express = require("express");
const router = express.Router();
const DownloadJob = require("../models/download");
const Chapter = require("../models/chapter");
const downloadService = require("../services/downloadService");
const logger = require("../utils/logger");

// Start download job
router.post("/start", async (req, res) => {
    const { chapters, bookId, bookName, bookMetadata } = req.body;

    if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
        return res.status(400).json({ error: "chapters array is required" });
    }

    try {
        // If creating a new book, create it now (synchronously) so it appears immediately
        let finalBookId = bookId;
        if (!finalBookId) {
            const Book = require("../models/book");
            const converter = require("../services/converter");
            
            // Determine book name - use provided bookName or generate from metadata
            let finalBookName = bookName;
            if (!finalBookName && bookMetadata?.bookName) {
                finalBookName = bookMetadata.bookName;
            }
            
            // If still no name, create a dummy name from first chapter URL
            if (!finalBookName && chapters.length > 0) {
                const urlTidMatch = chapters[0].url?.match(/tid=(\d+)/);
                const threadId = urlTidMatch ? urlTidMatch[1] : Date.now();
                finalBookName = `書籍_${threadId}`;
            }
            
            // If still no name, use a timestamp-based name
            if (!finalBookName) {
                finalBookName = `書籍_${Date.now()}`;
            }

            // Check if book exists
            let book = await Book.findBySimplifiedName(finalBookName);
            if (!book) {
                // Create new book with metadata
                const bookNameTraditional =
                    bookMetadata?.bookNameTraditional ||
                    converter.toTraditional(finalBookName);
                const metadata = bookMetadata
                    ? {
                          author: bookMetadata.author || "",
                          category: bookMetadata.category || "",
                          description: bookMetadata.description || "",
                          sourceUrl:
                              bookMetadata.sourceUrl || chapters[0]?.url || "",
                          tags: bookMetadata.tags || [],
                      }
                    : {
                          sourceUrl: chapters[0]?.url || "",
                          tags: [],
                      };
                
                logger.info('Creating new book', { 
                    finalBookName, 
                    bookNameTraditional,
                    hasMetadata: !!bookMetadata 
                });
                
                finalBookId = await Book.create(
                    finalBookName,
                    bookNameTraditional,
                    metadata
                );
                
                logger.info('Book created successfully', { 
                    bookId: finalBookId, 
                    bookName: finalBookName 
                });
            } else {
                finalBookId = book.id;
                logger.info('Using existing book', { 
                    bookId: finalBookId, 
                    bookName: finalBookName 
                });
            }
        }

        // Create download job with the final book ID and chapter data
        const jobId = await DownloadJob.create(finalBookId, chapters.length, chapters);

        // Start processing asynchronously (don't wait for completion)
        processDownloadJobAsync(
            jobId,
            chapters,
            finalBookId,
            bookName,
            bookMetadata
        ).catch((error) => {
            logger.error("Error in async download processing", {
                jobId,
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                },
            });
        });

        res.json({
            jobId,
            status: "queued",
            message: "Download job created and started",
            totalChapters: chapters.length,
            bookId: finalBookId,
        });
    } catch (error) {
        logger.error("Error creating download job", {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        res.status(500).json({
            error: "Failed to create download job",
            message: error.message,
        });
    }
});

// Async function to process download job
async function processDownloadJobAsync(
    jobId,
    chapters,
    bookId,
    bookName,
    bookMetadata
) {
    try {
        await downloadService.processDownloadJob(
            jobId,
            chapters,
            bookId,
            bookName,
            bookMetadata
        );
    } catch (error) {
        logger.error("Error processing download job (async wrapper)", {
            jobId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
    }
}

// Stream download logs (SSE) - must come before /:jobId route
router.get("/:jobId/stream", (req, res) => {
    const jobId = parseInt(req.params.jobId);

    if (isNaN(jobId)) {
        return res.status(400).json({ error: "Invalid job ID" });
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable buffering for nginx

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected", jobId })}\n\n`);

    // Register progress callback
    const progressCallback = (data) => {
        try {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            logger.error("Error writing SSE data", {
                jobId,
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                },
            });
            downloadService.unregisterProgressCallback(jobId);
            res.end();
        }
    };

    downloadService.registerProgressCallback(jobId, progressCallback);

    // Handle client disconnect
    req.on("close", () => {
        downloadService.unregisterProgressCallback(jobId);
        res.end();
    });

    // Send periodic heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        try {
            res.write(`: heartbeat\n\n`);
        } catch (error) {
            clearInterval(heartbeat);
            downloadService.unregisterProgressCallback(jobId);
            res.end();
        }
    }, 30000); // Every 30 seconds

    // Clean up on close
    req.on("close", () => {
        clearInterval(heartbeat);
        downloadService.unregisterProgressCallback(jobId);
    });
});

// Retry a specific job - must come before /:jobId route
router.post("/:jobId/retry", async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const job = await DownloadJob.findById(jobId);
        
        if (!job) {
            return res.status(404).json({ error: "Download job not found" });
        }
        
        if (!job.chapters_data || !Array.isArray(job.chapters_data)) {
            return res.status(400).json({ error: "Job does not have chapter data to retry" });
        }
        
        // Filter to only retry failed chapters
        const failedChapters = await Chapter.findFailedByJobId(jobId);
        const failedUrls = new Set(failedChapters.map(ch => ch.cool18_url));
        
        // Get chapters that failed (either in failed chapters or not completed)
        const chaptersToRetry = job.chapters_data.filter(ch => {
            return failedUrls.has(ch.url) || 
                   (job.status === "failed" || job.failed_chapters > 0);
        });
        
        if (chaptersToRetry.length === 0) {
            return res.json({ message: "No failed chapters to retry for this job" });
        }
        
        // Create new download job for retry
        const newJobId = await DownloadJob.create(job.book_id, chaptersToRetry.length, chaptersToRetry);
        
        // Get book name
        const Book = require("../models/book");
        let bookName = null;
        if (job.book_id) {
            const book = await Book.findById(job.book_id);
            bookName = book ? book.book_name_simplified : null;
        }
        
        // Start processing
        processDownloadJobAsync(newJobId, chaptersToRetry, job.book_id, bookName, null).catch(
            (error) => {
                logger.error("Error in async retry processing", {
                    jobId: newJobId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        name: error.name,
                    },
                });
            }
        );
        
        res.json({
            jobId: newJobId,
            message: `Retrying ${chaptersToRetry.length} chapters from job ${jobId}`,
            totalChapters: chaptersToRetry.length,
        });
    } catch (error) {
        logger.error("Error retrying job", {
            jobId: req.params.jobId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        res.status(500).json({
            error: "Failed to retry job",
            message: error.message,
        });
    }
});

// Get all download jobs
router.get("/", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const jobs = await DownloadJob.findAll(limit, offset);
        
        // Get book names for each job
        const Book = require("../models/book");
        const jobsWithBooks = await Promise.all(
            jobs.map(async (job) => {
                if (job.book_id) {
                    const book = await Book.findById(job.book_id);
                    return {
                        ...job,
                        book_name: book ? (book.book_name_traditional || book.book_name_simplified) : null,
                    };
                }
                return job;
            })
        );
        
        res.json(jobsWithBooks);
    } catch (error) {
        logger.error("Error fetching download jobs", {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        res.status(500).json({ error: "Failed to fetch download jobs" });
    }
});

// Get download job status (legacy endpoint)
router.get("/:jobId/status", async (req, res) => {
    try {
        const job = await DownloadJob.findById(req.params.jobId);
        if (!job) {
            return res.status(404).json({ error: "Download job not found" });
        }
        res.json(job);
    } catch (error) {
        logger.error("Error fetching download job", {
            jobId: req.params.jobId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        res.status(500).json({ error: "Failed to fetch download job" });
    }
});

// Get download job status (must come after more specific routes)
router.get("/:jobId", async (req, res) => {
    try {
        const job = await DownloadJob.findById(req.params.jobId);
        if (!job) {
            return res.status(404).json({ error: "Download job not found" });
        }
        res.json(job);
    } catch (error) {
        logger.error("Error fetching download job", {
            jobId: req.params.jobId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        res.status(500).json({ error: "Failed to fetch download job" });
    }
});

// Retry failed chapters
router.post("/retry-failed", async (req, res) => {
    const { bookId } = req.body;

    if (!bookId) {
        return res.status(400).json({ error: "bookId is required" });
    }

    try {
        const failedChapters = await Chapter.findFailedByBookId(bookId);

        if (failedChapters.length === 0) {
            return res.json({ message: "No failed chapters to retry" });
        }

        // Create new download job for retry
        const jobId = await DownloadJob.create(bookId, failedChapters.length);

        // Convert failed chapters to download format
        const chapters = failedChapters.map((ch) => ({
            url: ch.cool18_url,
            title: ch.chapter_title_simplified || "",
            chapterNum: ch.chapter_number,
        }));

        // Start processing
        processDownloadJobAsync(jobId, chapters, bookId, null).catch(
            (error) => {
                logger.error("Error in async retry processing", {
                    jobId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        name: error.name,
                    },
                });
            }
        );

        res.json({
            jobId,
            message: `Retrying ${failedChapters.length} failed chapters`,
            totalChapters: failedChapters.length,
        });
    } catch (error) {
        logger.error("Error retrying failed chapters", {
            bookId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        res.status(500).json({
            error: "Failed to retry chapters",
            message: error.message,
        });
    }
});

// Export processDownloadJobAsync for use by job resumption service
module.exports = router;
module.exports.processDownloadJobAsync = processDownloadJobAsync;
