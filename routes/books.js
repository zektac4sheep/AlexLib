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
            sync_to_onenote,
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
            sync_to_onenote:
                sync_to_onenote === true ||
                sync_to_onenote === 1 ||
                sync_to_onenote === "true",
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

            // Check if the simplified name already exists (excluding current book)
            // If it exists, append "+" until we find a unique name
            const currentBook = await Book.findById(req.params.id);
            if (
                currentBook &&
                currentBook.book_name_simplified !==
                    updates.book_name_simplified
            ) {
                const originalName = updates.book_name_simplified;
                let candidateName = originalName;
                let existingBook = await Book.findBySimplifiedName(
                    candidateName
                );

                // Keep appending "+" until we find a unique name
                while (
                    existingBook &&
                    existingBook.id !== parseInt(req.params.id)
                ) {
                    candidateName += "+";
                    existingBook = await Book.findBySimplifiedName(
                        candidateName
                    );
                }

                // Update with the unique name
                updates.book_name_simplified = candidateName;

                // Log if we had to modify the name
                if (candidateName !== originalName) {
                    logger.info(
                        `Book name modified to ensure uniqueness: "${originalName}" -> "${candidateName}"`
                    );
                }
            }
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

        // Convert sync_to_joplin to boolean if provided
        if (updates.sync_to_joplin !== undefined) {
            updates.sync_to_joplin =
                updates.sync_to_joplin === true ||
                updates.sync_to_joplin === 1 ||
                updates.sync_to_joplin === "true";
        }

        // Convert sync_to_onenote to boolean if provided
        if (updates.sync_to_onenote !== undefined) {
            updates.sync_to_onenote =
                updates.sync_to_onenote === true ||
                updates.sync_to_onenote === 1 ||
                updates.sync_to_onenote === "true";
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
        if (req.body.series !== undefined) {
            updates.series = req.body.series;
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
                        const detectedChapterName = detectedChapter.name || "";

                        // Build title from number and name, ensuring 20-char limit
                        // Truncate chapter name first (max 20 chars for chapter_name field)
                        const truncatedChapterName = detectedChapterName
                            ? textProcessor.truncateToMax(
                                  detectedChapterName,
                                  20
                              )
                            : "";

                        // Build chapter title (simplified) - format: "第X章 章名" or "第X章"
                        // Total max 20 chars, so we need to account for prefix length
                        let detectedChapterTitleSimplified = "";
                        if (truncatedChapterName) {
                            const prefix = `第${
                                detectedChapterNumber || "未知"
                            }章 `;
                            const prefixLength = prefix.length;
                            const maxNameLength = Math.max(
                                0,
                                20 - prefixLength
                            );
                            // Further truncate name to fit within 20-char title limit
                            const nameForTitle = textProcessor.truncateToMax(
                                truncatedChapterName,
                                maxNameLength
                            );
                            detectedChapterTitleSimplified =
                                prefix + nameForTitle;
                        } else {
                            detectedChapterTitleSimplified = `第${
                                detectedChapterNumber || "未知"
                            }章`;
                        }
                        // Final safety check: ensure total doesn't exceed 20
                        detectedChapterTitleSimplified =
                            textProcessor.truncateToMax(
                                detectedChapterTitleSimplified,
                                20
                            );

                        // Convert to Traditional Chinese for chapter_title
                        let detectedChapterTitle = converter.toTraditional(
                            detectedChapterTitleSimplified
                        );
                        // Ensure Traditional version also doesn't exceed 20
                        detectedChapterTitle = textProcessor.truncateToMax(
                            detectedChapterTitle,
                            20
                        );

                        // Reformat each chapter content using reformatChapterContent (same as check_reformat.js)
                        const reformattedContent =
                            textProcessor.reformatChapterContent(
                                detectedChapter.content,
                                detectedChapterTitle ||
                                    detectedChapterTitleSimplified,
                                true, // Convert to Traditional Chinese
                                true // Enable detailed logging
                            );

                        const detectedSeries =
                            detectedChapter.series || "official";

                        // Handle "結局" as special case - use separate series
                        let finalChapterName = truncatedChapterName;
                        let finalSeries = detectedSeries;
                        if (
                            finalChapterName &&
                            finalChapterName.includes("結局")
                        ) {
                            // Use "結局" as a separate series
                            finalSeries = "結局";
                            // Keep the original chapter name (don't number it)
                            // The series separation handles uniqueness via (book_id, chapter_number, series) constraint
                        }

                        // Rebuild title with final chapter name if it changed
                        if (
                            finalChapterName &&
                            finalChapterName !== truncatedChapterName
                        ) {
                            const prefix = `第${
                                detectedChapterNumber || "未知"
                            }章 `;
                            const prefixLength = prefix.length;
                            const maxNameLength = Math.max(
                                0,
                                20 - prefixLength
                            );
                            const nameForTitle = textProcessor.truncateToMax(
                                finalChapterName,
                                maxNameLength
                            );
                            detectedChapterTitleSimplified =
                                prefix + nameForTitle;
                            detectedChapterTitleSimplified =
                                textProcessor.truncateToMax(
                                    detectedChapterTitleSimplified,
                                    20
                                );
                            detectedChapterTitle = converter.toTraditional(
                                detectedChapterTitleSimplified
                            );
                            detectedChapterTitle = textProcessor.truncateToMax(
                                detectedChapterTitle,
                                20
                            );
                        }

                        const chapterData = {
                            book_id: bookId,
                            chapter_number: detectedChapterNumber,
                            chapter_title: detectedChapterTitle,
                            chapter_title_simplified:
                                detectedChapterTitleSimplified,
                            chapter_name: textProcessor.truncateToMax(
                                finalChapterName,
                                20
                            ),
                            content: reformattedContent,
                            status: "downloaded",
                            series: finalSeries,
                        };

                        // Check if chapter already exists
                        const existingChapter =
                            await Chapter.findByBookAndNumber(
                                bookId,
                                detectedChapterNumber,
                                finalSeries
                            );

                        if (existingChapter) {
                            // Update existing chapter
                            await Chapter.updateByBookSeriesAndNumber(
                                bookId,
                                finalSeries,
                                detectedChapterNumber,
                                chapterData
                            );
                        } else {
                            // Create new chapter
                            try {
                                await Chapter.create(chapterData);
                            } catch (createError) {
                                // If UNIQUE constraint error, fetch the conflicting record
                                if (
                                    createError?.message &&
                                    createError.message.includes(
                                        "UNIQUE constraint failed"
                                    )
                                ) {
                                    const conflictingRecord =
                                        await Chapter.findByBookAndNumber(
                                            bookId,
                                            detectedChapterNumber,
                                            finalSeries
                                        );
                                    logger.error(
                                        "Error creating chapter during reformat (multiple chapters path)",
                                        {
                                            attemptedChapter: {
                                                book_id: bookId,
                                                chapter_number:
                                                    detectedChapterNumber,
                                                chapter_name:
                                                    chapterData.chapter_name,
                                                series: finalSeries,
                                            },
                                            conflictingRecord: conflictingRecord
                                                ? {
                                                      id: conflictingRecord.id,
                                                      book_id:
                                                          conflictingRecord.book_id,
                                                      chapter_number:
                                                          conflictingRecord.chapter_number,
                                                      chapter_name:
                                                          conflictingRecord.chapter_name,
                                                      series:
                                                          conflictingRecord.series ||
                                                          "official",
                                                  }
                                                : null,
                                            error: {
                                                message:
                                                    createError?.message ||
                                                    String(createError),
                                                stack: createError?.stack,
                                            },
                                        }
                                    );
                                }
                                throw createError;
                            }
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

                // Generate new chapter titles from detected information
                // Use detected values or fall back to existing chapter values
                const finalChapterNumber =
                    detectedChapterNumber || chapter.chapter_number;
                let finalChapterName =
                    detectedChapterName || chapter.chapter_name || "";

                // Truncate chapter name first (max 20 chars for chapter_name field)
                const truncatedChapterName = finalChapterName
                    ? textProcessor.truncateToMax(finalChapterName, 20)
                    : "";

                // Build chapter title (simplified) - format: "第X章 章名" or "第X章"
                // Total max 20 chars, so we need to account for prefix length
                let newChapterTitleSimplified = "";
                if (truncatedChapterName) {
                    const prefix = `第${finalChapterNumber || "未知"}章 `;
                    const prefixLength = prefix.length;
                    const maxNameLength = Math.max(0, 20 - prefixLength);
                    // Further truncate name to fit within 20-char title limit
                    const nameForTitle = textProcessor.truncateToMax(
                        truncatedChapterName,
                        maxNameLength
                    );
                    newChapterTitleSimplified = prefix + nameForTitle;
                } else {
                    newChapterTitleSimplified = `第${
                        finalChapterNumber || "未知"
                    }章`;
                }
                // Final safety check: ensure total doesn't exceed 20
                newChapterTitleSimplified = textProcessor.truncateToMax(
                    newChapterTitleSimplified,
                    20
                );

                // Convert to Traditional Chinese for chapter_title
                let newChapterTitle = converter.toTraditional(
                    newChapterTitleSimplified
                );
                // Ensure Traditional version also doesn't exceed 20
                newChapterTitle = textProcessor.truncateToMax(
                    newChapterTitle,
                    20
                );

                // Use the generated title for reformatting content (use longer version for content)
                const chapterTitleForContent =
                    newChapterTitle ||
                    newChapterTitleSimplified ||
                    chapter.chapter_title ||
                    chapter.chapter_title_simplified ||
                    `第${detectedChapterNumber || "未知"}章`;

                // Reformat the content using reformatChapterContent (same as check_reformat.js)
                const reformattedContent = textProcessor.reformatChapterContent(
                    chapter.content,
                    chapterTitleForContent,
                    true, // Convert to Traditional Chinese
                    true // Enable detailed logging
                );

                // Update the chapter with detected info
                const updates = {
                    content: reformattedContent,
                    // Always set titles with truncated versions (max 20 chars each)
                    chapter_title: newChapterTitle,
                    chapter_title_simplified: newChapterTitleSimplified,
                };

                // Update chapter number if detected and different
                if (
                    detectedChapterNumber &&
                    detectedChapterNumber !== chapter.chapter_number
                ) {
                    updates.chapter_number = detectedChapterNumber;
                }

                // Handle "結局" as special case - use separate series
                finalChapterName =
                    truncatedChapterName || chapter.chapter_name || "";
                let finalSeries = chapter.series || "official";
                if (finalChapterName && finalChapterName.includes("結局")) {
                    // Use "結局" as a separate series
                    finalSeries = "結局";
                    // Keep the original chapter name (don't number it)
                    // The series separation handles uniqueness via (book_id, chapter_number, series) constraint
                }

                // Update series if it changed
                if (finalSeries !== (chapter.series || "official")) {
                    updates.series = finalSeries;
                }

                // Always update chapter name with truncated version (max 20 chars)
                if (finalChapterName) {
                    updates.chapter_name = textProcessor.truncateToMax(
                        finalChapterName,
                        20
                    );
                } else {
                    updates.chapter_name = "";
                }

                try {
                    await Chapter.updateById(chapter.id, updates);
                } catch (updateError) {
                    // If UNIQUE constraint error during update, it means the new values conflict
                    if (
                        updateError?.message &&
                        updateError.message.includes("UNIQUE constraint failed")
                    ) {
                        // Fetch the conflicting record
                        const conflictBookId = chapter.book_id;
                        const conflictChapterNumber =
                            updates.chapter_number !== undefined
                                ? updates.chapter_number
                                : chapter.chapter_number;
                        const conflictSeries =
                            updates.series !== undefined
                                ? updates.series
                                : chapter.series || "official";

                        let conflictingRecord = null;
                        try {
                            conflictingRecord =
                                await Chapter.findByBookAndNumber(
                                    conflictBookId,
                                    conflictChapterNumber,
                                    conflictSeries
                                );
                        } catch (fetchError) {
                            // Ignore fetch errors
                        }

                        logger.error(
                            "UNIQUE constraint failed during chapter update",
                            {
                                currentChapter: {
                                    id: chapter.id,
                                    book_id: chapter.book_id,
                                    chapter_number: chapter.chapter_number,
                                    chapter_name: chapter.chapter_name,
                                    series: chapter.series || "official",
                                },
                                attemptedUpdate: {
                                    chapter_number: updates.chapter_number,
                                    chapter_name: updates.chapter_name,
                                    series: updates.series,
                                },
                                conflictingRecord: conflictingRecord
                                    ? {
                                          id: conflictingRecord.id,
                                          book_id: conflictingRecord.book_id,
                                          chapter_number:
                                              conflictingRecord.chapter_number,
                                          chapter_name:
                                              conflictingRecord.chapter_name,
                                          series:
                                              conflictingRecord.series ||
                                              "official",
                                      }
                                    : null,
                                error: {
                                    message:
                                        updateError?.message ||
                                        String(updateError),
                                    stack: updateError?.stack,
                                },
                            }
                        );
                    }
                    throw updateError;
                }

                reformatted++;
            } catch (error) {
                // If UNIQUE constraint error, fetch the conflicting record
                let conflictingRecord = null;
                if (
                    error?.message &&
                    error.message.includes("UNIQUE constraint failed")
                ) {
                    try {
                        // Extract book_id, chapter_number, and series from the error or updates
                        const conflictBookId = bookId;
                        const conflictChapterNumber =
                            updates.chapter_number !== undefined
                                ? updates.chapter_number
                                : chapter.chapter_number;
                        const conflictSeries =
                            updates.series !== undefined
                                ? updates.series
                                : chapter.series || "official";

                        conflictingRecord = await Chapter.findByBookAndNumber(
                            conflictBookId,
                            conflictChapterNumber,
                            conflictSeries
                        );
                    } catch (fetchError) {
                        // Ignore errors when fetching conflicting record
                        logger.warn("Could not fetch conflicting record", {
                            fetchError,
                        });
                    }
                }

                logger.error("Error reformatting chapter", {
                    chapterId: chapter.id,
                    chapterNumber: chapter.chapter_number,
                    currentChapter: {
                        id: chapter.id,
                        book_id: chapter.book_id,
                        chapter_number: chapter.chapter_number,
                        chapter_name: chapter.chapter_name,
                        series: chapter.series || "official",
                    },
                    attemptedUpdate: {
                        chapter_number: updates.chapter_number,
                        chapter_name: updates.chapter_name,
                        series: updates.series,
                    },
                    conflictingRecord: conflictingRecord
                        ? {
                              id: conflictingRecord.id,
                              book_id: conflictingRecord.book_id,
                              chapter_number: conflictingRecord.chapter_number,
                              chapter_name: conflictingRecord.chapter_name,
                              series: conflictingRecord.series || "official",
                          }
                        : null,
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

// Merge books ending with "+" into books without "+"
router.post("/merge-books-with-plus", async (req, res) => {
    try {
        const db = require("../models/database").getDatabase();
        const allBooks = await Book.findAll();

        // Find books ending with one or more "+"
        const booksWithPlus = allBooks.filter(
            (book) =>
                book.book_name_simplified &&
                book.book_name_simplified.endsWith("+")
        );

        if (booksWithPlus.length === 0) {
            return res.json({
                message: "沒有找到以 '+' 結尾的書籍",
                merged: 0,
                deleted: 0,
            });
        }

        const mergeResults = [];
        let totalMerged = 0;
        let totalDeleted = 0;

        for (const plusBook of booksWithPlus) {
            try {
                // Find the base name (strip all trailing "+" characters)
                const baseName = plusBook.book_name_simplified.replace(
                    /\++$/,
                    ""
                );
                const targetBook = allBooks.find(
                    (book) => book.book_name_simplified === baseName
                );

                if (!targetBook) {
                    logger.warn(
                        `找不到對應的基礎書籍: ${baseName} (來源: ${plusBook.book_name_simplified})`
                    );
                    mergeResults.push({
                        source: plusBook.book_name_simplified,
                        target: baseName,
                        status: "skipped",
                        reason: "找不到對應的基礎書籍",
                    });
                    continue;
                }

                // Get chapters from both books
                const plusChapters = await Chapter.findByBookId(plusBook.id);
                const targetChapters = await Chapter.findByBookId(
                    targetBook.id
                );

                // Create a map of existing chapters by series and chapter_number
                // Key format: "series:number"
                const targetChaptersMap = new Map();
                targetChapters.forEach((ch) => {
                    if (
                        ch.chapter_number !== null &&
                        ch.chapter_number !== undefined
                    ) {
                        const series = ch.series || "official";
                        const key = `${series}:${ch.chapter_number}`;
                        targetChaptersMap.set(key, ch);
                    }
                });

                let mergedCount = 0;
                let updatedCount = 0;
                let skippedCount = 0;
                let deletedCount = 0;

                // Merge chapters
                for (const plusChapter of plusChapters) {
                    if (
                        plusChapter.chapter_number === null ||
                        plusChapter.chapter_number === undefined
                    ) {
                        // Skip chapters without valid chapter numbers
                        skippedCount++;
                        continue;
                    }

                    const plusSeries = plusChapter.series || "official";
                    const chapterKey = `${plusSeries}:${plusChapter.chapter_number}`;
                    const existingChapter = targetChaptersMap.get(chapterKey);

                    if (existingChapter) {
                        // Chapter exists - compare and use longer version
                        const plusTitle =
                            plusChapter.chapter_title ||
                            plusChapter.chapter_title_simplified ||
                            plusChapter.chapter_name ||
                            "";
                        const existingTitle =
                            existingChapter.chapter_title ||
                            existingChapter.chapter_title_simplified ||
                            existingChapter.chapter_name ||
                            "";

                        // Use longer content
                        const plusContentLength = (plusChapter.content || "")
                            .length;
                        const existingContentLength = (
                            existingChapter.content || ""
                        ).length;

                        // Use longer title
                        const plusTitleLength = plusTitle.length;
                        const existingTitleLength = existingTitle.length;

                        // Update if plus version is longer
                        if (
                            plusContentLength > existingContentLength ||
                            (plusContentLength === existingContentLength &&
                                plusTitleLength > existingTitleLength)
                        ) {
                            // Preserve series from existing chapter
                            const existingSeries =
                                existingChapter.series || "official";
                            await Chapter.updateByBookSeriesAndNumber(
                                targetBook.id,
                                existingSeries,
                                plusChapter.chapter_number,
                                {
                                    chapter_title: plusChapter.chapter_title,
                                    chapter_title_simplified:
                                        plusChapter.chapter_title_simplified,
                                    chapter_name: plusChapter.chapter_name,
                                    content: plusChapter.content,
                                    line_start: plusChapter.line_start,
                                    line_end: plusChapter.line_end,
                                    status: plusChapter.status,
                                    series: existingSeries,
                                }
                            );
                            updatedCount++;
                            // Delete the plus chapter since we've merged its content into the target
                            await Chapter.delete(plusChapter.id);
                            deletedCount++;
                            logger.info(
                                "Updated target chapter with plus content and deleted plus chapter",
                                {
                                    chapterNumber: plusChapter.chapter_number,
                                    series: plusSeries,
                                    targetChapterId: existingChapter.id,
                                    plusChapterId: plusChapter.id,
                                    plusContentLength: plusContentLength,
                                    existingContentLength:
                                        existingContentLength,
                                }
                            );
                        } else {
                            // Target version is longer - delete the plus chapter
                            // The target chapter already has the better content
                            await Chapter.delete(plusChapter.id);
                            deletedCount++;
                            logger.info(
                                "Target chapter has longer content, deleted plus chapter",
                                {
                                    chapterNumber: plusChapter.chapter_number,
                                    series: plusSeries,
                                    targetChapterId: existingChapter.id,
                                    plusChapterId: plusChapter.id,
                                    plusContentLength: plusContentLength,
                                    existingContentLength:
                                        existingContentLength,
                                }
                            );
                        }
                    } else {
                        // New chapter - move it to target book (preserve series)
                        const chapterSeries = plusChapter.series || "official";
                        try {
                            await Chapter.updateById(plusChapter.id, {
                                book_id: targetBook.id,
                                series: chapterSeries,
                            });
                            mergedCount++;
                            logger.info("Moved chapter to target book", {
                                chapterId: plusChapter.id,
                                chapterNumber: plusChapter.chapter_number,
                                series: chapterSeries,
                                fromBookId: plusBook.id,
                                toBookId: targetBook.id,
                            });
                        } catch (moveError) {
                            // If UNIQUE constraint violation, chapter already exists in target
                            // This shouldn't happen since we checked, but handle it gracefully
                            if (
                                moveError.message &&
                                moveError.message.includes("UNIQUE constraint")
                            ) {
                                logger.warn(
                                    "Cannot move chapter - duplicate in target book, deleting instead",
                                    {
                                        chapterId: plusChapter.id,
                                        chapterNumber:
                                            plusChapter.chapter_number,
                                        series: chapterSeries,
                                        fromBookId: plusBook.id,
                                        toBookId: targetBook.id,
                                        error: moveError.message,
                                    }
                                );
                                // Delete the plus chapter since target already has it
                                await Chapter.delete(plusChapter.id);
                                deletedCount++;
                            } else {
                                throw moveError;
                            }
                        }
                    }
                }

                // Update target book's total chapters count
                const allTargetChapters = await Chapter.findByBookId(
                    targetBook.id
                );
                await Book.update(targetBook.id, {
                    total_chapters: allTargetChapters.length,
                    rebuild_chunks: true, // Mark for chunk rebuild after merge
                });

                // Delete the "+" book
                await Book.delete(plusBook.id);
                totalDeleted++;

                mergeResults.push({
                    source: plusBook.book_name_simplified,
                    target: targetBook.book_name_simplified,
                    status: "merged",
                    chaptersMerged: mergedCount,
                    chaptersUpdated: updatedCount,
                    chaptersDeleted: deletedCount,
                    chaptersSkipped: skippedCount,
                });

                totalMerged += mergedCount + updatedCount;
            } catch (error) {
                logger.error("Error merging book", {
                    bookId: plusBook.id,
                    bookName: plusBook.book_name_simplified,
                    error: error.message,
                });
                mergeResults.push({
                    source: plusBook.book_name_simplified,
                    target: null,
                    status: "error",
                    error: error.message,
                });
            }
        }

        res.json({
            message: `合併完成: ${totalMerged} 個章節已合併，${totalDeleted} 本書籍已刪除`,
            merged: totalMerged,
            deleted: totalDeleted,
            results: mergeResults,
        });
    } catch (error) {
        logger.error("Error in merge-books-with-plus endpoint", {
            error: error.message,
            stack: error.stack,
        });
        res.status(500).json({
            error: "合併書籍失敗",
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
            return res
                .status(400)
                .json({ error: "chapters array is required" });
        }

        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        // Use the download service to add chapters
        const DownloadJob = require("../models/download");
        const downloadService = require("../services/downloadService");

        // Create download job
        const jobId = await DownloadJob.create(
            bookId,
            chapters.length,
            chapters
        );

        // Start processing asynchronously
        const processDownloadJobAsync =
            require("./download").processDownloadJobAsync;
        processDownloadJobAsync(
            jobId,
            chapters,
            bookId,
            book.book_name_simplified,
            null
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
        const { analyzeFile } = require("../services/fileAnalyzer");
        const {
            toTraditional,
            normalizeToHalfWidth,
        } = require("../services/converter");
        const { sortChaptersForExport } = require("../services/chunker");
        const botStatusService = require("../services/botStatusService");
        const Chapter = require("../models/chapter");

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
                const uniqueSuffix =
                    Date.now() + "-" + Math.round(Math.random() * 1e9);
                cb(
                    null,
                    `chapter-${uniqueSuffix}${path.extname(file.originalname)}`
                );
            },
        });

        const upload = multer({ storage: storage }).single("file");

        // Handle file upload
        upload(req, res, async (err) => {
            if (err) {
                logger.error("Error uploading file", { error: err });
                return res.status(400).json({
                    error: "File upload failed",
                    message: err.message,
                });
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
                // Register upload operation for tracking
                const uploadId = `upload-${Date.now()}-${Math.random()
                    .toString(36)
                    .substr(2, 9)}`;
                botStatusService.registerOperation("upload", uploadId, {
                    filename: req.file.originalname,
                    bookId: bookId,
                    bookName:
                        book.book_name_simplified || book.book_name_traditional,
                    totalChapters: 0,
                    completedChapters: 0,
                    failedChapters: 0,
                });

                // Analyze the file
                const analysis = await analyzeFile(
                    req.file.path,
                    req.file.originalname
                );

                // Log parsed chapters with numbers and series
                if (analysis.chapters && analysis.chapters.length > 0) {
                    logger.info(
                        "Parsed chapters from file (add-chapters-file)",
                        {
                            filename: req.file.originalname,
                            bookId: bookId,
                            totalChapters: analysis.totalChapters,
                            chapters: analysis.chapters.map((ch) => ({
                                number: ch.number,
                                series: ch.series || "official",
                                title: ch.title || ch.titleSimplified || "",
                            })),
                        }
                    );
                    analysis.chapters.forEach((ch) => {
                        logger.info(
                            `Chapter ${ch.number} - Series: ${
                                ch.series || "official"
                            }`
                        );
                    });
                } else {
                    logger.info(
                        "No chapters found in parsed file (add-chapters-file)",
                        {
                            filename: req.file.originalname,
                            bookId: bookId,
                        }
                    );
                }

                // Update operation with total chapters
                botStatusService.updateOperation("upload", uploadId, {
                    totalChapters: analysis.totalChapters,
                });

                // Process and insert chapters
                let insertedCount = 0;
                let updatedCount = 0;
                let errorCount = 0;

                // Sort chapters: regular chapters first, final chapters (-1) at the end
                const sortedChapters = sortChaptersForExport(analysis.chapters);

                for (let i = 0; i < sortedChapters.length; i++) {
                    const chapter = sortedChapters[i];
                    try {
                        const chapterTitleTraditional = toTraditional(
                            chapter.title
                        );
                        const chapterTitle =
                            chapter.titleSimplified || chapter.title;

                        // Format chapter content using reformatChapterContent
                        const formattedContent =
                            textProcessor.reformatChapterContent(
                                chapter.content || "",
                                chapterTitle,
                                true, // Convert to Traditional Chinese
                                true // Enable detailed logging
                            );

                        const series = chapter.series || "official";
                        const chapterData = {
                            book_id: bookId,
                            chapter_number: chapter.number,
                            chapter_title: chapterTitleTraditional,
                            chapter_title_simplified:
                                chapter.titleSimplified || chapter.title,
                            chapter_name: chapter.name || "",
                            content: formattedContent,
                            line_start: chapter.lineStart,
                            line_end: chapter.lineEnd,
                            status: "downloaded",
                            series: series,
                        };

                        // Check if chapter already exists
                        const existingChapter =
                            await Chapter.findByBookAndNumber(
                                bookId,
                                chapter.number,
                                series
                            );

                        if (existingChapter) {
                            // Update existing chapter
                            await Chapter.updateByBookSeriesAndNumber(
                                bookId,
                                series,
                                chapter.number,
                                chapterData
                            );
                            updatedCount++;
                        } else {
                            // Create new chapter
                            await Chapter.create(chapterData);
                            insertedCount++;
                        }

                        // Update progress
                        botStatusService.updateOperation("upload", uploadId, {
                            completedChapters: i + 1,
                        });
                    } catch (error) {
                        logger.error("Error processing chapter", {
                            bookId,
                            chapterNumber: chapter.number,
                            error,
                        });
                        errorCount++;
                        botStatusService.updateOperation("upload", uploadId, {
                            failedChapters: errorCount,
                        });
                    }
                }

                // Update book's total chapters count
                const allChapters = await Chapter.findByBookId(bookId);
                await Book.update(bookId, {
                    total_chapters: allChapters.length,
                });

                // Mark operation as completed
                botStatusService.updateOperation("upload", uploadId, {
                    status: "completed",
                    chaptersInserted: insertedCount,
                    chaptersUpdated: updatedCount,
                    chaptersErrored: errorCount,
                });

                res.json({
                    message: "File processed successfully",
                    bookId,
                    bookName:
                        book.book_name_simplified || book.book_name_traditional,
                    chaptersInserted: insertedCount,
                    chaptersUpdated: updatedCount,
                    chaptersErrored: errorCount,
                    totalChapters: analysis.totalChapters,
                    chapters: analysis.chapters
                        ? analysis.chapters.map((ch) => ({
                              number: ch.number,
                              series: ch.series || "official",
                              title: ch.title || ch.titleSimplified || "",
                          }))
                        : [],
                });
            } catch (error) {
                // Clean up uploaded file on error
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                logger.error("Error processing uploaded file", {
                    bookId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        name: error.name,
                        ...error,
                    },
                });
                res.status(500).json({
                    error: "Failed to process file",
                    message: error.message || "Unknown error",
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
