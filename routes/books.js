const express = require("express");
const router = express.Router();
const Book = require("../models/book");
const Chapter = require("../models/chapter");
const BookSearchJob = require("../models/bookSearchJob");
const SearchResult = require("../models/searchResult");
const cool18Scraper = require("../services/cool18Scraper");
const converter = require("../services/converter");
const { normalizeToHalfWidth } = require("../services/converter");
const textProcessor = require("../services/textProcessor");
const chapterExtractor = require("../services/chapterExtractor");
const { sortChaptersForExport } = require("../services/chunker");
const bookSearchService = require("../services/bookSearchService");
const logger = require("../utils/logger");

// Get all books
router.get("/", async (req, res) => {
    try {
        const books = await Book.findAll();

        // Calculate min_chapter and max_chapter for each book
        const booksWithChapters = await Promise.all(
            books.map(async (book) => {
                const chapters = await Chapter.findByBookId(book.id);

                if (chapters && chapters.length > 0) {
                    const chapterNumbers = chapters
                        .filter(
                            (ch) =>
                                ch.chapter_number !== null &&
                                ch.chapter_number !== undefined
                        )
                        .map((ch) => ch.chapter_number)
                        .sort((a, b) => a - b);

                    if (chapterNumbers.length > 0) {
                        book.min_chapter = Math.min(...chapterNumbers);
                        book.max_chapter = Math.max(...chapterNumbers);
                        book.total_chapters = chapters.length;
                    } else {
                        book.min_chapter = null;
                        book.max_chapter = null;
                        book.total_chapters = chapters.length;
                    }
                } else {
                    book.min_chapter = null;
                    book.max_chapter = null;
                    book.total_chapters = 0;
                }

                return book;
            })
        );

        res.json(booksWithChapters);
    } catch (error) {
        logger.error("Error fetching books", { error });
        res.status(500).json({ error: "Failed to fetch books" });
    }
});

// Extract book metadata from a thread URL
router.post("/extract-metadata", async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: "URL is required" });
        }

        let metadata;
        try {
            metadata = await cool18Scraper.extractBookMetadata(url);
        } catch (error) {
            logger.error("Error extracting book metadata", {
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                },
                url: req.body.url,
            });

            // Return dummy metadata instead of failing
            const urlTidMatch = url.match(/tid=(\d+)/);
            const threadId = urlTidMatch ? urlTidMatch[1] : "unknown";
            metadata = {
                bookName: `書籍_${threadId}`,
                author: "",
                category: "",
                description: "",
                tags: [],
                sourceUrl: url,
                threadId: threadId,
                originalTitle: `書籍_${threadId}`,
            };
        }

        // Convert book name to traditional Chinese
        const bookNameTraditional = converter.toTraditional(
            metadata.bookName || metadata.originalTitle || "未知書籍"
        );

        res.json({
            ...metadata,
            bookNameTraditional,
        });
    } catch (error) {
        logger.error("Error in extract-metadata endpoint", {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
            url: req.body.url,
        });
        // Even if everything fails, return dummy metadata
        const urlTidMatch = req.body.url?.match(/tid=(\d+)/);
        const threadId = urlTidMatch ? urlTidMatch[1] : "unknown";
        const dummyMetadata = {
            bookName: `書籍_${threadId}`,
            author: "",
            category: "",
            description: "",
            tags: [],
            sourceUrl: req.body.url || "",
            threadId: threadId,
            originalTitle: `書籍_${threadId}`,
            bookNameTraditional: converter.toTraditional(`書籍_${threadId}`),
        };
        res.json(dummyMetadata);
    }
});

// Get book by ID with chapters
router.get("/:id", async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        const chapters = await Chapter.findByBookId(req.params.id);
        const tags = await Book.getTags(req.params.id);
        const authors = await Book.getAuthors(req.params.id);

        // Sort chapters: regular chapters first, final chapters (-1) at the end
        const sortedChapters = sortChaptersForExport(
            chapters.map((ch) => ({
                chapterNumber: ch.chapter_number,
                ...ch,
            }))
        ).map((ch) => {
            // Remove chapterNumber if it was added, keep original structure
            const { chapterNumber, ...rest } = ch;
            return rest;
        });

        res.json({
            ...book,
            chapters: sortedChapters,
            tags,
            authors,
        });
    } catch (error) {
        logger.error("Error fetching book", { bookId: req.params.id, error });
        res.status(500).json({ error: "Failed to fetch book" });
    }
});

// Get chapters for a book
router.get("/:id/chapters", async (req, res) => {
    try {
        const chapters = await Chapter.findByBookId(req.params.id);
        // Sort chapters: regular chapters first, final chapters (-1) at the end
        const sortedChapters = sortChaptersForExport(
            chapters.map((ch) => ({
                chapterNumber: ch.chapter_number,
                ...ch,
            }))
        ).map((ch) => {
            // Remove chapterNumber if it was added, keep original structure
            const { chapterNumber, ...rest } = ch;
            return rest;
        });
        res.json(sortedChapters);
    } catch (error) {
        logger.error("Error fetching chapters", {
            bookId: req.params.id,
            error,
        });
        res.status(500).json({ error: "Failed to fetch chapters" });
    }
});

// Create new book
router.post("/", async (req, res) => {
    try {
        let {
            book_name_simplified,
            book_name_traditional,
            author,
            authors,
            category,
            description,
            source_url,
            tags,
            sync_to_joplin,
            auto_search,
        } = req.body;

        if (!book_name_simplified) {
            return res
                .status(400)
                .json({ error: "book_name_simplified is required" });
        }

        // Normalize all text inputs: convert full-width to half-width
        book_name_simplified = normalizeToHalfWidth(
            book_name_simplified.trim()
        );
        if (book_name_traditional) {
            book_name_traditional = normalizeToHalfWidth(
                book_name_traditional.trim()
            );
        }
        if (author) {
            author = normalizeToHalfWidth(author.trim());
        }
        if (category) {
            category = normalizeToHalfWidth(category.trim());
        }
        if (description) {
            description = normalizeToHalfWidth(description.trim());
        }

        // Check if book already exists
        const existing = await Book.findBySimplifiedName(book_name_simplified);
        if (existing) {
            return res.json(existing);
        }

        // Handle authors - support both array and single author for backward compatibility
        let authorsArray = [];
        if (authors && Array.isArray(authors) && authors.length > 0) {
            authorsArray = authors
                .map((a) => normalizeToHalfWidth(a.trim()))
                .filter((a) => a);
        } else if (authors && typeof authors === "string") {
            authorsArray = authors
                .split(",")
                .map((a) => normalizeToHalfWidth(a.trim()))
                .filter((a) => a);
        } else if (author) {
            authorsArray = [normalizeToHalfWidth(author.trim())];
        }

        const metadata = {
            author, // Keep for backward compatibility
            authors: authorsArray.length > 0 ? authorsArray : undefined,
            category,
            description,
            sourceUrl: source_url,
            tags: tags || [],
            sync_to_joplin:
                sync_to_joplin === true ||
                sync_to_joplin === 1 ||
                sync_to_joplin === "true",
            auto_search:
                auto_search === true ||
                auto_search === 1 ||
                auto_search === "true",
        };

        const bookId = await Book.create(
            book_name_simplified,
            book_name_traditional,
            metadata
        );
        const book = await Book.findById(bookId);
        const bookTags = await Book.getTags(bookId);
        const bookAuthors = await Book.getAuthors(bookId);
        res.status(201).json({ ...book, tags: bookTags, authors: bookAuthors });
    } catch (error) {
        logger.error("Error creating book", { error });
        res.status(500).json({ error: "Failed to create book" });
    }
});

// Update book
router.put("/:id", async (req, res) => {
    try {
        const updates = { ...req.body };

        // Normalize all text inputs: convert full-width to half-width
        if (updates.book_name_simplified) {
            updates.book_name_simplified = normalizeToHalfWidth(
                updates.book_name_simplified.trim()
            );
        }
        if (updates.book_name_traditional) {
            updates.book_name_traditional = normalizeToHalfWidth(
                updates.book_name_traditional.trim()
            );
        }
        if (updates.author) {
            updates.author = normalizeToHalfWidth(updates.author.trim());
        }
        if (updates.category) {
            updates.category = normalizeToHalfWidth(updates.category.trim());
        }
        if (updates.description) {
            updates.description = normalizeToHalfWidth(
                updates.description.trim()
            );
        }

        // Convert tags array if provided
        if (updates.tags && Array.isArray(updates.tags)) {
            // Tags will be handled in Book.update
        } else if (updates.tags && typeof updates.tags === "string") {
            updates.tags = updates.tags
                .split(",")
                .map((t) => normalizeToHalfWidth(t.trim()))
                .filter((t) => t);
        }

        // Convert authors array if provided
        if (updates.authors && Array.isArray(updates.authors)) {
            // Normalize each author
            updates.authors = updates.authors
                .map((a) => normalizeToHalfWidth(a.trim()))
                .filter((a) => a);
        } else if (updates.authors && typeof updates.authors === "string") {
            updates.authors = updates.authors
                .split(",")
                .map((a) => normalizeToHalfWidth(a.trim()))
                .filter((a) => a);
        }
        await Book.update(req.params.id, updates);
        const book = await Book.findById(req.params.id);
        const tags = await Book.getTags(req.params.id);
        const authors = await Book.getAuthors(req.params.id);
        res.json({ ...book, tags, authors });
    } catch (error) {
        logger.error("Error updating book", { bookId: req.params.id, error });
        res.status(500).json({ error: "Failed to update book" });
    }
});

// Find missing chapters for a book
router.get("/:id/missing-chapters", async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        const chapters = await Chapter.findByBookId(req.params.id);

        // Get all chapter numbers
        const chapterNumbers = chapters
            .filter(
                (ch) =>
                    ch.chapter_number !== null &&
                    ch.chapter_number !== undefined
            )
            .map((ch) => ch.chapter_number)
            .sort((a, b) => a - b);

        if (chapterNumbers.length === 0) {
            return res.json({
                missingChapters: [],
                minChapter: null,
                maxChapter: null,
            });
        }

        const minChapter = Math.min(...chapterNumbers);
        const maxChapter = Math.max(...chapterNumbers);
        const allChapters = new Set(chapterNumbers);
        const missingChapters = [];

        // Find gaps in chapter sequence
        for (let i = minChapter; i <= maxChapter; i++) {
            if (!allChapters.has(i)) {
                missingChapters.push(i);
            }
        }

        res.json({
            missingChapters,
            minChapter,
            maxChapter,
            totalChapters: chapterNumbers.length,
            expectedChapters: maxChapter - minChapter + 1,
        });
    } catch (error) {
        logger.error("Error finding missing chapters", {
            bookId: req.params.id,
            error,
        });
        res.status(500).json({ error: "Failed to find missing chapters" });
    }
});

// Unified search endpoint - creates a job and returns immediately
router.post("/:id/search-chapters", async (req, res) => {
    try {
        const { missingChapters, bookName, pages } = req.body;
        const bookId = parseInt(req.params.id);

        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        // Create search job
        const searchParams = {
            missingChapters,
            bookName,
            pages: pages || 5,
        };

        const jobId = await BookSearchJob.create(bookId, searchParams);

        res.json({
            message: "Search job created",
            jobId,
            status: "queued",
        });
    } catch (error) {
        logger.error("Error creating search job", {
            bookId: req.params.id,
            error,
        });
        res.status(500).json({
            error: "Failed to create search job",
            message: error.message,
        });
    }
});

// Get search job status
router.get("/:id/search-jobs/:jobId", async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const bookId = parseInt(req.params.id);

        const job = await BookSearchJob.findById(jobId);
        if (!job) {
            return res.status(404).json({ error: "Search job not found" });
        }

        if (job.book_id !== bookId) {
            return res
                .status(400)
                .json({ error: "Job does not belong to this book" });
        }

        res.json(job);
    } catch (error) {
        logger.error("Error fetching search job", {
            jobId: req.params.jobId,
            error,
        });
        res.status(500).json({
            error: "Failed to fetch search job",
            message: error.message,
        });
    }
});

// Get all search jobs for a book
router.get("/:id/search-jobs", async (req, res) => {
    try {
        const bookId = parseInt(req.params.id);
        const { limit = 20 } = req.query;

        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        const jobs = await BookSearchJob.findByBookId(bookId, parseInt(limit));
        res.json({
            total: jobs.length,
            jobs,
        });
    } catch (error) {
        logger.error("Error fetching search jobs", {
            bookId: req.params.id,
            error,
        });
        res.status(500).json({
            error: "Failed to fetch search jobs",
            message: error.message,
        });
    }
});

// Get search results from a completed job
router.get("/:id/search-jobs/:jobId/results", async (req, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const bookId = parseInt(req.params.id);

        const job = await BookSearchJob.findById(jobId);
        if (!job) {
            return res.status(404).json({ error: "Search job not found" });
        }

        if (job.book_id !== bookId) {
            return res
                .status(400)
                .json({ error: "Job does not belong to this book" });
        }

        // Allow both "completed" and "waiting_for_input" statuses
        // "waiting_for_input" means the job found results and is waiting for user to review
        if (job.status !== "completed" && job.status !== "waiting_for_input") {
            return res.status(400).json({
                error: "Search job is not ready. Job must be completed or waiting for input.",
                status: job.status,
            });
        }

        // If job has a search_result_id, fetch from SearchResult table
        if (job.search_result_id) {
            const searchResult = await SearchResult.findById(
                job.search_result_id
            );
            if (searchResult) {
                return res.json({
                    keyword: searchResult.keyword,
                    totalResults:
                        searchResult.total_results ||
                        (searchResult.results
                            ? searchResult.results.length
                            : 0),
                    threads: searchResult.results || [],
                    searchResultId: searchResult.id,
                    jobId: job.id,
                });
            }
        }

        // Fallback to job results if available
        if (job.results) {
            return res.json({
                ...job.results,
                jobId: job.id,
            });
        }

        res.status(404).json({ error: "No results found for this job" });
    } catch (error) {
        logger.error("Error fetching search results", {
            jobId: req.params.jobId,
            error,
        });
        res.status(500).json({
            error: "Failed to fetch search results",
            message: error.message,
        });
    }
});

// Delete book
router.delete("/:id", async (req, res) => {
    try {
        await Book.delete(req.params.id);
        res.json({ message: "Book deleted successfully" });
    } catch (error) {
        logger.error("Error deleting book", { bookId: req.params.id, error });
        res.status(500).json({ error: "Failed to delete book" });
    }
});

// Rescan chapter content to re-extract chapter information
router.post("/:id/rescan-chapters", async (req, res) => {
    try {
        const bookId = req.params.id;
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        const chapters = await Chapter.findByBookId(bookId);
        if (!chapters || chapters.length === 0) {
            return res.json({ message: "No chapters to rescan", updated: 0 });
        }

        const chapterExtractor = require("../services/chapterExtractor");
        const converter = require("../services/converter");
        const cool18Scraper = require("../services/cool18Scraper");
        let updatedCount = 0;

        for (const chapter of chapters) {
            try {
                let newChapterNumber = chapter.chapter_number;
                let newChapterTitle = chapter.chapter_title;
                let newChapterTitleSimplified =
                    chapter.chapter_title_simplified;

                // Try to extract from chapter content first (might have title in header)
                if (chapter.content) {
                    // Look for chapter title in content (usually in first few lines or as header)
                    const contentLines = chapter.content
                        .split("\n")
                        .slice(0, 20);
                    const contentPreview = contentLines.join("\n");

                    // Try to extract chapter number from content
                    const chapterInfo =
                        chapterExtractor.extractChapterNumber(contentPreview);
                    if (chapterInfo && chapterInfo.number) {
                        newChapterNumber = chapterInfo.number;
                    }

                    // Try to find title in content (look for # headers or lines with chapter info)
                    const titleMatch =
                        contentPreview.match(/^#\s*(.+)$/m) ||
                        contentPreview.match(
                            /第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)[\s：:]*([^\n]+)/
                        );
                    if (titleMatch && titleMatch[1]) {
                        newChapterTitleSimplified = titleMatch[1].trim();
                        newChapterTitle = converter.toTraditional(
                            newChapterTitleSimplified
                        );
                    }
                }

                // If chapter has URL, try to re-download to get fresh metadata
                if (
                    chapter.cool18_url &&
                    (!newChapterNumber || !newChapterTitle)
                ) {
                    try {
                        const threadData = await cool18Scraper.downloadThread(
                            chapter.cool18_url
                        );
                        const chapterInfo =
                            chapterExtractor.extractChapterNumber(
                                threadData.title
                            );

                        if (chapterInfo && chapterInfo.number) {
                            newChapterNumber = chapterInfo.number;
                        }
                        if (threadData.title) {
                            newChapterTitleSimplified = threadData.title;
                            newChapterTitle = converter.toTraditional(
                                newChapterTitleSimplified
                            );
                        }
                    } catch (urlError) {
                        logger.warn("Error re-downloading chapter for rescan", {
                            chapterId: chapter.id,
                            url: chapter.cool18_url,
                            error: urlError.message,
                        });
                    }
                }

                // Update chapter if we found new information
                if (
                    newChapterNumber !== chapter.chapter_number ||
                    newChapterTitle !== chapter.chapter_title ||
                    newChapterTitleSimplified !==
                        chapter.chapter_title_simplified
                ) {
                    // Use updateById to safely update even if chapter_number changes
                    await Chapter.updateById(chapter.id, {
                        chapter_number: newChapterNumber,
                        chapter_title: newChapterTitle,
                        chapter_title_simplified: newChapterTitleSimplified,
                    });
                    updatedCount++;
                }
            } catch (chapterError) {
                logger.error("Error rescanning chapter", {
                    chapterId: chapter.id,
                    error: chapterError.message,
                });
            }
        }

        res.json({
            message: `Rescan completed. Updated ${updatedCount} of ${chapters.length} chapters.`,
            updated: updatedCount,
            total: chapters.length,
        });
    } catch (error) {
        logger.error("Error rescanning chapters", {
            bookId: req.params.id,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        res.status(500).json({
            error: "Failed to rescan chapters",
            message: error.message,
        });
    }
});

// Get a single chapter by ID
router.get("/:bookId/chapters/:chapterId", async (req, res) => {
    try {
        const chapter = await Chapter.findById(req.params.chapterId);
        if (!chapter) {
            return res.status(404).json({ error: "Chapter not found" });
        }
        // Verify chapter belongs to the book
        if (chapter.book_id !== parseInt(req.params.bookId)) {
            return res
                .status(400)
                .json({ error: "Chapter does not belong to this book" });
        }
        res.json(chapter);
    } catch (error) {
        logger.error("Error fetching chapter", {
            chapterId: req.params.chapterId,
            error,
        });
        res.status(500).json({ error: "Failed to fetch chapter" });
    }
});

// Update a chapter
router.put("/:bookId/chapters/:chapterId", async (req, res) => {
    try {
        const chapter = await Chapter.findById(req.params.chapterId);
        if (!chapter) {
            return res.status(404).json({ error: "Chapter not found" });
        }
        // Verify chapter belongs to the book
        if (chapter.book_id !== parseInt(req.params.bookId)) {
            return res
                .status(400)
                .json({ error: "Chapter does not belong to this book" });
        }

        const updates = {};
        if (req.body.chapter_number !== undefined) {
            updates.chapter_number = req.body.chapter_number;
        }
        if (req.body.chapter_title !== undefined) {
            updates.chapter_title = req.body.chapter_title;
        }
        if (req.body.chapter_title_simplified !== undefined) {
            updates.chapter_title_simplified =
                req.body.chapter_title_simplified;
        }
        if (req.body.chapter_name !== undefined) {
            updates.chapter_name = req.body.chapter_name;
        }
        if (req.body.content !== undefined) {
            updates.content = req.body.content;
        }
        if (req.body.status !== undefined) {
            updates.status = req.body.status;
        }
        if (req.body.line_start !== undefined) {
            updates.line_start = req.body.line_start;
        }
        if (req.body.line_end !== undefined) {
            updates.line_end = req.body.line_end;
        }

        await Chapter.updateById(req.params.chapterId, updates);
        const updatedChapter = await Chapter.findById(req.params.chapterId);
        res.json(updatedChapter);
    } catch (error) {
        logger.error("Error updating chapter", {
            chapterId: req.params.chapterId,
            error,
        });
        res.status(500).json({
            error: "Failed to update chapter",
            message: error.message,
        });
    }
});

// Delete a chapter
router.delete("/:bookId/chapters/:chapterId", async (req, res) => {
    try {
        const chapter = await Chapter.findById(req.params.chapterId);
        if (!chapter) {
            return res.status(404).json({ error: "Chapter not found" });
        }
        // Verify chapter belongs to the book
        if (chapter.book_id !== parseInt(req.params.bookId)) {
            return res
                .status(400)
                .json({ error: "Chapter does not belong to this book" });
        }

        await Chapter.delete(req.params.chapterId);
        res.json({ message: "Chapter deleted successfully" });
    } catch (error) {
        logger.error("Error deleting chapter", {
            chapterId: req.params.chapterId,
            error,
        });
        res.status(500).json({
            error: "Failed to delete chapter",
            message: error.message,
        });
    }
});

// Reformat all chapters in a book
router.post("/:bookId/reformat-chapters", async (req, res) => {
    try {
        const bookId = parseInt(req.params.bookId);

        // Verify book exists
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        // Get all chapters for this book
        const chapters = await Chapter.findByBookId(bookId);

        if (!chapters || chapters.length === 0) {
            return res.json({
                message: "No chapters to reformat",
                reformatted: 0,
                total: 0,
            });
        }

        let reformatted = 0;
        let errors = 0;

        // Reformat each chapter
        for (const chapter of chapters) {
            try {
                if (!chapter.content || chapter.content.trim().length === 0) {
                    continue; // Skip empty chapters
                }

                // Check if content contains multiple chapters
                const fileAnalyzer = require("../services/fileAnalyzer");
                const detectedChapters = fileAnalyzer.detectChapters(
                    chapter.content
                );

                // If multiple chapters detected, split and save each separately
                if (detectedChapters && detectedChapters.length > 1) {
                    logger.info(
                        "Multiple chapters detected in chapter content during reformat",
                        {
                            chapterId: chapter.id,
                            chapterNumber: chapter.chapter_number,
                            detectedCount: detectedChapters.length,
                        }
                    );

                    // Delete the original chapter (it will be replaced by split chapters)
                    await Chapter.delete(chapter.id);

                    // Process each detected chapter
                    for (const detectedChapter of detectedChapters) {
                        const detectedChapterNumber = detectedChapter.number;
                        const detectedChapterTitle =
                            detectedChapter.title ||
                            `第${detectedChapterNumber}章`;
                        const detectedChapterName = detectedChapter.name || "";

                        // Reformat each chapter content
                        const reformattedContent =
                            textProcessor.reformatChapterContent(
                                detectedChapter.content,
                                detectedChapterTitle,
                                true // Convert to Traditional Chinese
                            );

                        const chapterData = {
                            book_id: bookId,
                            chapter_number: detectedChapterNumber,
                            chapter_title:
                                converter.toTraditional(detectedChapterTitle),
                            chapter_title_simplified: detectedChapterTitle,
                            chapter_name: detectedChapterName,
                            content: reformattedContent,
                            status: "downloaded",
                        };

                        // Check if chapter already exists
                        const existingChapter =
                            await Chapter.findByBookAndNumber(
                                bookId,
                                detectedChapterNumber
                            );

                        if (existingChapter) {
                            // Update existing chapter
                            await Chapter.updateByBookAndNumber(
                                bookId,
                                detectedChapterNumber,
                                chapterData
                            );
                        } else {
                            // Create new chapter
                            await Chapter.create(chapterData);
                        }
                    }

                    reformatted++;
                    continue;
                }

                // Single chapter - process normally
                // Extract chapter number and name from content
                let detectedChapterNumber = chapter.chapter_number;
                let detectedChapterName = chapter.chapter_name || "";

                // Check first few lines for chapter header
                const contentLines = chapter.content.split("\n").slice(0, 10);
                const contentPreview = contentLines.join("\n");

                // Try to extract chapter number from content
                const chapterInfo =
                    chapterExtractor.extractChapterNumber(contentPreview);
                if (chapterInfo && chapterInfo.number) {
                    detectedChapterNumber = chapterInfo.number;
                }

                // Try to extract chapter name from content
                // Look for patterns like "第X章 章节名" or "## 第X章 章节名"
                const namePatterns = [
                    /^#+\s*第[^章]*章\s+(.+)$/m,
                    /第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)\s+(.+)$/m,
                ];

                for (const pattern of namePatterns) {
                    const match = contentPreview.match(pattern);
                    if (match && match[1]) {
                        detectedChapterName = match[1].trim();
                        break;
                    }
                }

                // Get chapter title
                const chapterTitle =
                    chapter.chapter_title ||
                    chapter.chapter_title_simplified ||
                    (detectedChapterName
                        ? `第${
                              detectedChapterNumber || "未知"
                          }章 ${detectedChapterName}`
                        : `第${detectedChapterNumber || "未知"}章`);

                // Reformat the content
                const reformattedContent = textProcessor.reformatChapterContent(
                    chapter.content,
                    chapterTitle,
                    true // Convert to Traditional Chinese
                );

                // Update the chapter with detected info
                const updates = {
                    content: reformattedContent,
                };

                // Update chapter number if detected and different
                if (
                    detectedChapterNumber &&
                    detectedChapterNumber !== chapter.chapter_number
                ) {
                    updates.chapter_number = detectedChapterNumber;
                }

                // Update chapter name if detected
                if (
                    detectedChapterName &&
                    detectedChapterName !== (chapter.chapter_name || "")
                ) {
                    updates.chapter_name = detectedChapterName;
                }

                await Chapter.updateById(chapter.id, updates);

                reformatted++;
            } catch (error) {
                logger.error("Error reformatting chapter", {
                    chapterId: chapter.id,
                    chapterNumber: chapter.chapter_number,
                    error: {
                        message: error?.message || String(error),
                        stack: error?.stack,
                        name: error?.name,
                        toString: error?.toString?.(),
                    },
                });
                errors++;
            }
        }

        // Update book's last_updated timestamp
        await Book.update(bookId, {});

        res.json({
            message: `Reformatted ${reformatted} chapters`,
            reformatted,
            total: chapters.length,
            errors,
        });
    } catch (error) {
        logger.error("Error reformatting chapters", {
            bookId: req.params.bookId,
            error,
        });
        res.status(500).json({
            error: "Failed to reformat chapters",
            message: error.message,
        });
    }
});

// Extract thread metadata from URL
router.post("/extract-thread", async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: "URL is required" });
        }

        // Extract thread metadata
        const metadata = await cool18Scraper.extractBookMetadata(url);

        res.json(metadata);
    } catch (error) {
        logger.error("Error extracting thread metadata", { error });
        res.status(500).json({
            error: "Failed to extract thread metadata",
            message: error.message,
        });
    }
});

// Add chapters by URL to a book
router.post("/:id/add-chapters-url", async (req, res) => {
    try {
        const bookId = parseInt(req.params.id);
        const { chapters } = req.body;

        if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
            return res.status(400).json({ error: "chapters array is required" });
        }

        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        // Use the download service to add chapters
        const DownloadJob = require("../models/download");
        const downloadService = require("../services/downloadService");

        // Create download job
        const jobId = await DownloadJob.create(bookId, chapters.length, chapters);

        // Start processing asynchronously
        const processDownloadJobAsync = require("./download").processDownloadJobAsync;
        processDownloadJobAsync(jobId, chapters, bookId, book.book_name_simplified, null).catch(
            (error) => {
                logger.error("Error in async download processing", {
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
            status: "queued",
            message: "Download job created and started",
            totalChapters: chapters.length,
            bookId,
        });
    } catch (error) {
        logger.error("Error adding chapters by URL", {
            bookId: req.params.id,
            error,
        });
        res.status(500).json({
            error: "Failed to add chapters",
            message: error.message,
        });
    }
});

// Add chapters by file to a book
router.post("/add-chapters-file", async (req, res) => {
    try {
        const multer = require("multer");
        const path = require("path");
        const fs = require("fs");
        const uploadService = require("../services/uploadService");
        const UploadJob = require("../models/uploadJob");

        // Setup multer for file upload
        const tempDir = path.join(__dirname, "..", "temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, tempDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
                cb(null, `chapter-${uniqueSuffix}${path.extname(file.originalname)}`);
            },
        });

        const upload = multer({ storage: storage }).single("file");

        // Handle file upload
        upload(req, res, async (err) => {
            if (err) {
                logger.error("Error uploading file", { error: err });
                return res.status(400).json({ error: "File upload failed", message: err.message });
            }

            if (!req.file) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            const bookId = parseInt(req.body.bookId);
            if (!bookId) {
                // Clean up uploaded file
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: "bookId is required" });
            }

            const book = await Book.findById(bookId);
            if (!book) {
                // Clean up uploaded file
                fs.unlinkSync(req.file.path);
                return res.status(404).json({ error: "Book not found" });
            }

            try {
                // Analyze the file
                const fileAnalyzer = require("../services/fileAnalyzer");
                const analysis = await fileAnalyzer.analyzeFile(req.file.path);

                // Create upload job
                const jobId = await UploadJob.create(
                    req.file.filename,
                    req.file.originalname,
                    req.file.path,
                    req.file.size,
                    analysis
                );

                // Update job with book ID and start processing
                await UploadJob.update(jobId, {
                    book_id: bookId,
                    status: "queued",
                    started_at: new Date().toISOString(),
                });

                // Start processing asynchronously
                if (uploadService && uploadService.processUploadJobAsync) {
                    uploadService.processUploadJobAsync(jobId).catch((error) => {
                        logger.error("Error in async upload processing", {
                            jobId,
                            error,
                        });
                    });
                }

                res.json({
                    jobId,
                    status: "queued",
                    message: "File uploaded and processing started",
                    bookId,
                });
            } catch (error) {
                // Clean up uploaded file on error
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                logger.error("Error processing uploaded file", {
                    bookId,
                    error,
                });
                res.status(500).json({
                    error: "Failed to process file",
                    message: error.message,
                });
            }
        });
    } catch (error) {
        logger.error("Error in add-chapters-file endpoint", { error });
        res.status(500).json({
            error: "Failed to add chapters from file",
            message: error.message,
        });
    }
});

module.exports = router;
