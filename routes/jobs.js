const express = require("express");
const router = express.Router();
const BookSearchJob = require("../models/bookSearchJob");
const DownloadJob = require("../models/download");
const ChunkJob = require("../models/chunkJob");
const JoplinJob = require("../models/joplinJob");
const UploadJob = require("../models/uploadJob");
const Book = require("../models/book");
const logger = require("../utils/logger");

/**
 * Get all jobs across all types
 * Query params: status, type, limit, offset
 */
router.get("/", async (req, res) => {
    try {
        const { status, type, limit = 50, offset = 0 } = req.query;
        const limitNum = parseInt(limit);
        const offsetNum = parseInt(offset);

        const allJobs = [];

        // Fetch jobs from each type
        if (!type || type === "book_search") {
            let bookSearchJobs = [];
            if (status) {
                bookSearchJobs = await BookSearchJob.findAllByStatus(
                    status,
                    limitNum + offsetNum
                );
            } else {
                // Get jobs with different statuses
                const statuses = [
                    "queued",
                    "processing",
                    "waiting_for_input",
                    "completed",
                    "failed",
                ];
                for (const s of statuses) {
                    const jobs = await BookSearchJob.findAllByStatus(
                        s,
                        limitNum
                    );
                    bookSearchJobs.push(...jobs);
                }
            }

            // Enrich with book info
            for (const job of bookSearchJobs) {
                try {
                    const book = await Book.findById(job.book_id);
                    allJobs.push({
                        id: job.id,
                        type: "book_search",
                        status: job.status,
                        bookId: job.book_id,
                        bookName: book
                            ? book.book_name_traditional ||
                              book.book_name_simplified
                            : null,
                        author: book ? book.author : null,
                        searchParams: job.search_params,
                        results: job.results,
                        searchResultId: job.search_result_id,
                        errorMessage: job.error_message,
                        autoJob: job.auto_job === 1,
                        createdAt: job.created_at,
                        startedAt: job.started_at,
                        completedAt: job.completed_at,
                        data: {
                            searchParams: job.search_params,
                            results: job.results,
                        },
                    });
                } catch (err) {
                    logger.error("Error enriching book search job", {
                        jobId: job.id,
                        error: err,
                    });
                }
            }
        }

        if (!type || type === "download") {
            let downloadJobs = [];
            if (status) {
                downloadJobs = await DownloadJob.findAllByStatus(
                    status,
                    limitNum + offsetNum
                );
            } else {
                const statuses = [
                    "queued",
                    "processing",
                    "completed",
                    "failed",
                ];
                for (const s of statuses) {
                    const jobs = await DownloadJob.findAllByStatus(s, limitNum);
                    downloadJobs.push(...jobs);
                }
            }

            for (const job of downloadJobs) {
                try {
                    const book = await Book.findById(job.book_id);
                    allJobs.push({
                        id: job.id,
                        type: "download",
                        status: job.status,
                        bookId: job.book_id,
                        bookName: book
                            ? book.book_name_traditional ||
                              book.book_name_simplified
                            : null,
                        totalChapters: job.total_chapters,
                        completedChapters: job.completed_chapters,
                        failedChapters: job.failed_chapters,
                        errorMessage: job.error_message,
                        createdAt: job.created_at,
                        startedAt: job.started_at,
                        completedAt: job.completed_at,
                        data: {
                            totalChapters: job.total_chapters,
                            completedChapters: job.completed_chapters,
                            failedChapters: job.failed_chapters,
                            chaptersData: job.chapters_data,
                        },
                    });
                } catch (err) {
                    logger.error("Error enriching download job", {
                        jobId: job.id,
                        error: err,
                    });
                }
            }
        }

        if (!type || type === "chunk") {
            // ChunkJob doesn't have findAllByStatus, need to implement or fetch differently
            // For now, we'll skip chunk jobs in unified list or implement a workaround
            // TODO: Add findAllByStatus to ChunkJob model
        }

        if (!type || type === "joplin") {
            let joplinJobs = [];
            if (status) {
                joplinJobs = await JoplinJob.findByStatus(status);
            } else {
                joplinJobs = await JoplinJob.findAll(limitNum + offsetNum);
            }

            for (const job of joplinJobs) {
                allJobs.push({
                    id: job.id,
                    type: "joplin",
                    status: job.status,
                    jobType: job.job_type,
                    totalItems: job.total_items,
                    completedItems: job.completed_items,
                    errorMessage: job.error_message,
                    createdAt: job.created_at,
                    startedAt: job.started_at,
                    completedAt: job.completed_at,
                    data: {
                        jobType: job.job_type,
                        configData: job.config_data,
                        progressData: job.progress_data,
                    },
                });
            }
        }

        if (!type || type === "upload") {
            let uploadJobs = [];
            if (status) {
                uploadJobs = await UploadJob.findAllByStatus(
                    status,
                    limitNum + offsetNum
                );
            } else {
                uploadJobs = await UploadJob.findAll(limitNum + offsetNum);
            }

            for (const job of uploadJobs) {
                try {
                    const book = job.book_id
                        ? await Book.findById(job.book_id)
                        : null;
                    allJobs.push({
                        id: job.id,
                        type: "upload",
                        status: job.status,
                        filename: job.filename,
                        originalName: job.original_name,
                        fileSize: job.file_size,
                        bookId: job.book_id,
                        bookName: book
                            ? book.book_name_traditional ||
                              book.book_name_simplified
                            : null,
                        errorMessage: job.error_message,
                        createdAt: job.created_at,
                        startedAt: job.started_at,
                        completedAt: job.completed_at,
                        data: {
                            analysisData: job.analysis_data,
                            bookMetadata: job.book_metadata,
                        },
                    });
                } catch (err) {
                    logger.error("Error enriching upload job", {
                        jobId: job.id,
                        error: err,
                    });
                }
            }
        }

        // Sort by created_at descending
        allJobs.sort((a, b) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateB - dateA;
        });

        // Apply offset and limit
        const paginatedJobs = allJobs.slice(offsetNum, offsetNum + limitNum);

        res.json({
            jobs: paginatedJobs,
            total: allJobs.length,
            limit: limitNum,
            offset: offsetNum,
        });
    } catch (error) {
        logger.error("Error fetching jobs", { error });
        res.status(500).json({
            error: "Failed to fetch jobs",
            message: error.message,
        });
    }
});

/**
 * Get a specific job by type and ID
 */
router.get("/:type/:id", async (req, res) => {
    try {
        const { type, id } = req.params;
        const jobId = parseInt(id);

        let job = null;
        let enrichedJob = null;

        switch (type) {
            case "book_search":
                job = await BookSearchJob.findById(jobId);
                if (job) {
                    const book = await Book.findById(job.book_id);
                    enrichedJob = {
                        ...job,
                        bookName: book
                            ? book.book_name_traditional ||
                              book.book_name_simplified
                            : null,
                        author: book ? book.author : null,
                        autoJob: job.auto_job === 1,
                    };
                }
                break;
            case "download":
                job = await DownloadJob.findById(jobId);
                if (job) {
                    const book = await Book.findById(job.book_id);
                    // Get chapters for this download job
                    const Chapter = require("../models/chapter");
                    const chapters = await Chapter.findByJobId(jobId);
                    enrichedJob = {
                        ...job,
                        bookName: book
                            ? book.book_name_traditional ||
                              book.book_name_simplified
                            : null,
                        chapters: chapters || [],
                    };
                }
                break;
            case "chunk":
                job = await ChunkJob.findById(jobId);
                enrichedJob = job;
                break;
            case "joplin":
                job = await JoplinJob.findById(jobId);
                enrichedJob = job;
                break;
            case "upload":
                job = await UploadJob.findById(jobId);
                if (job && job.book_id) {
                    const book = await Book.findById(job.book_id);
                    enrichedJob = {
                        ...job,
                        bookName: book
                            ? book.book_name_traditional ||
                              book.book_name_simplified
                            : null,
                    };
                } else {
                    enrichedJob = job;
                }
                break;
            default:
                return res.status(400).json({ error: "Invalid job type" });
        }

        if (!enrichedJob) {
            return res.status(404).json({ error: "Job not found" });
        }

        res.json(enrichedJob);
    } catch (error) {
        logger.error("Error fetching job", {
            error,
            type: req.params.type,
            id: req.params.id,
        });
        res.status(500).json({
            error: "Failed to fetch job",
            message: error.message,
        });
    }
});

/**
 * Delete a job
 */
router.delete("/:type/:id", async (req, res) => {
    try {
        const { type, id } = req.params;
        const jobId = parseInt(id);

        let deleted = 0;

        switch (type) {
            case "book_search":
                deleted = await BookSearchJob.delete(jobId);
                break;
            case "download":
                deleted = await DownloadJob.delete(jobId);
                break;
            case "chunk":
                deleted = await ChunkJob.delete(jobId);
                break;
            case "joplin":
                deleted = await JoplinJob.delete(jobId);
                break;
            case "upload":
                deleted = await UploadJob.delete(jobId);
                break;
            default:
                return res.status(400).json({ error: "Invalid job type" });
        }

        if (deleted === 0) {
            return res.status(404).json({ error: "Job not found" });
        }

        res.json({ message: "Job deleted successfully" });
    } catch (error) {
        logger.error("Error deleting job", {
            error,
            type: req.params.type,
            id: req.params.id,
        });
        res.status(500).json({
            error: "Failed to delete job",
            message: error.message,
        });
    }
});

/**
 * Create download job from book search results
 * Checks for existing chapters and returns conflicts if any
 */
router.post("/book_search/:id/create-download", async (req, res) => {
    let searchJob = null;
    try {
        const jobId = parseInt(req.params.id);
        const { selectedChapters, conflictResolutions } = req.body;

        if (
            !selectedChapters ||
            !Array.isArray(selectedChapters) ||
            selectedChapters.length === 0
        ) {
            return res
                .status(400)
                .json({ error: "selectedChapters array is required" });
        }

        // Get the search job
        searchJob = await BookSearchJob.findById(jobId);
        if (!searchJob) {
            return res.status(404).json({ error: "Search job not found" });
        }

        if (
            searchJob.status !== "completed" &&
            searchJob.status !== "waiting_for_input"
        ) {
            return res.status(400).json({
                error: "Search job is not completed",
                status: searchJob.status,
            });
        }

        const Chapter = require("../models/chapter");

        // Check for existing chapters
        const conflicts = [];
        const chaptersToDownload = [];

        const chapterExtractor = require("../services/chapterExtractor");
        
        for (const ch of selectedChapters) {
            const chapterNum = ch.chapterNumber || null;
            if (chapterNum === null) {
                // No chapter number, skip conflict check
                chaptersToDownload.push({
                    url: ch.url,
                    title: ch.title || "",
                    chapterNum: null,
                });
                continue;
            }

            // Extract series from title
            const chapterInfo = chapterExtractor.extractChapterNumber(ch.title || "");
            const series = chapterInfo?.series || "official";

            const existingChapter = await Chapter.findByBookAndNumber(
                searchJob.book_id,
                chapterNum,
                series
            );

            if (existingChapter) {
                // Conflict found - check if user provided resolution
                if (conflictResolutions && conflictResolutions[chapterNum]) {
                    const resolution = conflictResolutions[chapterNum];
                    if (resolution.action === "overwrite") {
                        chaptersToDownload.push({
                            url: ch.url,
                            title: ch.title || "",
                            chapterNum: chapterNum,
                            action: "overwrite",
                        });
                    } else if (resolution.action === "discard") {
                        // Skip this chapter
                        continue;
                    } else if (
                        resolution.action === "new_number" &&
                        resolution.newNumber
                    ) {
                        chaptersToDownload.push({
                            url: ch.url,
                            title: ch.title || "",
                            chapterNum: resolution.newNumber,
                            action: "new_number",
                            originalNumber: chapterNum,
                        });
                    }
                } else {
                    // No resolution provided, return conflict
                    conflicts.push({
                        chapterNumber: chapterNum,
                        title: ch.title || "",
                        url: ch.url,
                        existingChapter: {
                            id: existingChapter.id,
                            chapter_number: existingChapter.chapter_number,
                            chapter_title: existingChapter.chapter_title,
                            chapter_name: existingChapter.chapter_name,
                            cool18_url: existingChapter.cool18_url,
                        },
                    });
                }
            } else {
                // No conflict, add to download list
                chaptersToDownload.push({
                    url: ch.url,
                    title: ch.title || "",
                    chapterNum: chapterNum,
                });
            }
        }

        // If there are unresolved conflicts, return them
        if (conflicts.length > 0) {
            return res.json({
                hasConflicts: true,
                conflicts: conflicts,
                message: `Found ${conflicts.length} chapter(s) that already exist. Please resolve conflicts.`,
            });
        }

        // No conflicts or all resolved - proceed with download
        if (chaptersToDownload.length === 0) {
            return res.status(400).json({
                error: "No chapters to download after resolving conflicts",
            });
        }

        // Validate book_id
        if (!searchJob.book_id) {
            logger.error("Cannot create download job - book_id is missing", {
                jobId: jobId,
                searchJob: searchJob,
            });
            return res.status(400).json({
                error: "Book ID is missing from search job",
                message: "Cannot create download job without a book ID",
            });
        }

        // Verify that the book exists
        const book = await Book.findById(searchJob.book_id);
        if (!book) {
            logger.error("Cannot create download job - book not found", {
                jobId: jobId,
                bookId: searchJob.book_id,
            });
            return res.status(404).json({
                error: "Book not found",
                message: `Cannot create download job - book with ID ${searchJob.book_id} does not exist`,
            });
        }

        // Validate chaptersToDownload format
        for (const ch of chaptersToDownload) {
            if (!ch.url) {
                logger.error("Invalid chapter data - missing URL", {
                    chapter: ch,
                    chaptersToDownload: chaptersToDownload,
                });
                return res.status(400).json({
                    error: "Invalid chapter data",
                    message: "All chapters must have a URL",
                });
            }
        }

        // Create download job
        const downloadService = require("../services/downloadService");
        let downloadJobId;
        try {
            logger.info("Creating download job", {
                bookId: searchJob.book_id,
                chaptersCount: chaptersToDownload.length,
                sampleChapter: chaptersToDownload[0],
            });

            // Validate chapters_data size (SQLite has a limit, but we'll check JSON size)
            try {
                const chaptersDataJson = JSON.stringify(chaptersToDownload);
                if (chaptersDataJson.length > 10000000) {
                    // 10MB limit
                    throw new Error(
                        "Chapter data is too large. Please select fewer chapters."
                    );
                }
            } catch (jsonError) {
                logger.error("Error serializing chapter data", {
                    error: jsonError.message,
                    chaptersCount: chaptersToDownload.length,
                });
                return res.status(400).json({
                    error: "Invalid chapter data",
                    message:
                        "Failed to process chapter data. Please try selecting fewer chapters or check the chapter data format.",
                });
            }

            downloadJobId = await DownloadJob.create(
                searchJob.book_id,
                chaptersToDownload.length,
                chaptersToDownload
            );
            logger.info("Download job created successfully", {
                downloadJobId: downloadJobId,
                bookId: searchJob.book_id,
                chaptersCount: chaptersToDownload.length,
            });
        } catch (createError) {
            logger.error("Error creating download job in database", {
                error: {
                    message: createError.message,
                    stack: createError.stack,
                    name: createError.name,
                },
                bookId: searchJob.book_id,
                chaptersCount: chaptersToDownload.length,
                sampleChapter: chaptersToDownload[0],
            });

            // Provide more specific error messages
            let errorMessage = "Failed to create download job";
            if (createError.message.includes("FOREIGN KEY")) {
                errorMessage =
                    "Invalid book ID - the book does not exist in the database";
            } else if (createError.message.includes("UNIQUE constraint")) {
                errorMessage =
                    "A download job for these chapters already exists";
            } else if (
                createError.message.includes("too large") ||
                createError.message.includes("too big")
            ) {
                errorMessage =
                    "Chapter data is too large. Please select fewer chapters.";
            } else {
                errorMessage =
                    createError.message || "Unknown database error occurred";
            }

            return res.status(500).json({
                error: "Failed to create download job",
                message: errorMessage,
                details:
                    process.env.NODE_ENV !== "production"
                        ? createError.stack
                        : undefined,
            });
        }

        // Start processing download job (book was already fetched above)
        const bookName = book
            ? book.book_name_traditional || book.book_name_simplified
            : null;

        downloadService
            .processDownloadJob(
                downloadJobId,
                chaptersToDownload,
                searchJob.book_id,
                bookName,
                null
            )
            .catch((error) => {
                logger.error("Error in async download processing", {
                    jobId: downloadJobId,
                    error,
                });
            });

        // Update search job status to indicate download was created
        await BookSearchJob.update(jobId, {
            status: "completed", // Change from waiting_for_input to completed
        });

        res.json({
            message: "Download job created successfully",
            downloadJobId,
            searchJobId: jobId,
            chaptersToDownload: chaptersToDownload.length,
        });
    } catch (error) {
        logger.error("Error creating download from search", {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
            jobId: req.params.id,
            bookId: searchJob ? searchJob.book_id : null,
        });
        res.status(500).json({
            error: "Failed to create download job",
            message: error.message || "Unknown error occurred",
            details:
                process.env.NODE_ENV !== "production" ? error.stack : undefined,
        });
    }
});

/**
 * Finish/Complete a book search job
 * Marks the job as completed without creating a download job
 */
router.post("/book_search/:id/finish", async (req, res) => {
    try {
        const jobId = parseInt(req.params.id);
        const job = await BookSearchJob.findById(jobId);

        if (!job) {
            return res.status(404).json({ error: "Book search job not found" });
        }

        // Update job status to completed
        await BookSearchJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
        });

        logger.info("Book search job finished", {
            jobId: jobId,
            bookId: job.book_id,
        });

        res.json({
            message: "Book search job has been marked as completed",
            jobId: jobId,
            status: "completed",
        });
    } catch (error) {
        logger.error("Error finishing book search job", {
            error,
            jobId: req.params.id,
        });
        res.status(500).json({
            error: "Failed to finish job",
            message: error.message,
        });
    }
});

/**
 * Retry a job
 * Resets the job status to queued so it can be reprocessed
 */
router.post("/:type/:id/retry", async (req, res) => {
    try {
        const { type, id } = req.params;
        const jobId = parseInt(id);

        switch (type) {
            case "book_search": {
                const job = await BookSearchJob.findById(jobId);
                if (!job) {
                    return res
                        .status(404)
                        .json({ error: "Book search job not found" });
                }

                // Reset job to queued status
                await BookSearchJob.update(jobId, {
                    status: "queued",
                    error_message: null,
                    started_at: null,
                    completed_at: null,
                });

                logger.info("Book search job retried", {
                    jobId: jobId,
                    bookId: job.book_id,
                });

                res.json({
                    message: "Book search job has been reset to queued status",
                    jobId: jobId,
                    status: "queued",
                });
                break;
            }
            case "download": {
                // For download jobs, use the same retry logic as download route
                const job = await DownloadJob.findById(jobId);
                if (!job) {
                    return res
                        .status(404)
                        .json({ error: "Download job not found" });
                }

                if (!job.chapters_data || !Array.isArray(job.chapters_data)) {
                    return res.status(400).json({
                        error: "Job does not have chapter data to retry",
                    });
                }

                // Filter to only retry failed chapters
                const Chapter = require("../models/chapter");
                const failedChapters = await Chapter.findFailedByJobId(jobId);
                const failedUrls = new Set(
                    failedChapters.map((ch) => ch.cool18_url)
                );

                // Get chapters that failed (either in failed chapters or not completed)
                const chaptersToRetry = job.chapters_data.filter((ch) => {
                    return (
                        failedUrls.has(ch.url) ||
                        job.status === "failed" ||
                        job.failed_chapters > 0
                    );
                });

                if (chaptersToRetry.length === 0) {
                    return res.json({
                        message: "No failed chapters to retry for this job",
                    });
                }

                // Create new download job for retry
                const newJobId = await DownloadJob.create(
                    job.book_id,
                    chaptersToRetry.length,
                    chaptersToRetry
                );

                // Get book name
                let bookName = null;
                if (job.book_id) {
                    const book = await Book.findById(job.book_id);
                    bookName = book ? book.book_name_simplified : null;
                }

                // Start processing
                const downloadService = require("../services/downloadService");
                downloadService
                    .processDownloadJobAsync(
                        newJobId,
                        chaptersToRetry,
                        job.book_id,
                        bookName,
                        null
                    )
                    .catch((error) => {
                        logger.error("Error in async retry processing", {
                            jobId: newJobId,
                            error: {
                                message: error.message,
                                stack: error.stack,
                                name: error.name,
                            },
                        });
                    });

                res.json({
                    jobId: newJobId,
                    message: `Retrying ${chaptersToRetry.length} chapters from job ${jobId}`,
                    totalChapters: chaptersToRetry.length,
                });
                break;
            }
            default:
                return res.status(400).json({
                    error: "Retry not supported for this job type",
                    type: type,
                });
        }
    } catch (error) {
        logger.error("Error retrying job", {
            error,
            type: req.params.type,
            id: req.params.id,
        });
        res.status(500).json({
            error: "Failed to retry job",
            message: error.message,
        });
    }
});

/**
 * Confirm upload job processing with user input
 */
router.post("/upload/:id/confirm", async (req, res) => {
    try {
        const jobId = parseInt(req.params.id);
        const { bookId, bookName, bookMetadata } = req.body;

        const uploadJob = await UploadJob.findById(jobId);
        if (!uploadJob) {
            return res.status(404).json({ error: "Upload job not found" });
        }

        if (uploadJob.status !== "waiting_for_input") {
            return res.status(400).json({
                error: "Upload job is not waiting for input",
                status: uploadJob.status,
            });
        }

        // Update job with user input
        await UploadJob.update(jobId, {
            status: "queued",
            book_id: bookId || null,
            book_metadata: bookMetadata || null,
            started_at: new Date().toISOString(),
        });

        // Start processing the upload job
        const uploadService = require("../services/uploadService");
        if (uploadService && uploadService.processUploadJobAsync) {
            uploadService.processUploadJobAsync(jobId).catch((error) => {
                logger.error("Error in async upload processing", {
                    jobId,
                    error,
                });
            });
        } else {
            // Fallback: process directly
            const uploadRouter = require("./upload");
            // This will be handled by the upload route's process endpoint
        }

        res.json({
            message: "Upload job confirmed and processing started",
            jobId,
        });
    } catch (error) {
        logger.error("Error confirming upload job", {
            error,
            jobId: req.params.id,
        });
        res.status(500).json({
            error: "Failed to confirm upload job",
            message: error.message,
        });
    }
});

module.exports = router;
