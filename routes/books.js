const express = require("express");
const router = express.Router();
const Book = require("../models/book");
const Chapter = require("../models/chapter");
const cool18Scraper = require("../services/cool18Scraper");
const converter = require("../services/converter");
const textProcessor = require("../services/textProcessor");
const chapterExtractor = require("../services/chapterExtractor");
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

        res.json({
            ...book,
            chapters,
            tags,
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
        res.json(chapters);
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
        const {
            book_name_simplified,
            book_name_traditional,
            author,
            category,
            description,
            source_url,
            tags,
        } = req.body;

        if (!book_name_simplified) {
            return res
                .status(400)
                .json({ error: "book_name_simplified is required" });
        }

        // Check if book already exists
        const existing = await Book.findBySimplifiedName(book_name_simplified);
        if (existing) {
            return res.json(existing);
        }

        const metadata = {
            author,
            category,
            description,
            sourceUrl: source_url,
            tags: tags || [],
        };

        const bookId = await Book.create(
            book_name_simplified,
            book_name_traditional,
            metadata
        );
        const book = await Book.findById(bookId);
        const bookTags = await Book.getTags(bookId);
        res.status(201).json({ ...book, tags: bookTags });
    } catch (error) {
        logger.error("Error creating book", { error });
        res.status(500).json({ error: "Failed to create book" });
    }
});

// Update book
router.put("/:id", async (req, res) => {
    try {
        const updates = { ...req.body };
        // Convert tags array if provided
        if (updates.tags && Array.isArray(updates.tags)) {
            // Tags will be handled in Book.update
        } else if (updates.tags && typeof updates.tags === "string") {
            updates.tags = updates.tags
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t);
        }
        await Book.update(req.params.id, updates);
        const book = await Book.findById(req.params.id);
        const tags = await Book.getTags(req.params.id);
        res.json({ ...book, tags });
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

// Search for missing chapters
router.post("/:id/search-missing", async (req, res) => {
    try {
        const { missingChapters, bookName } = req.body;
        const book = await Book.findById(req.params.id);

        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        if (
            !missingChapters ||
            !Array.isArray(missingChapters) ||
            missingChapters.length === 0
        ) {
            return res
                .status(400)
                .json({ error: "missingChapters array is required" });
        }

        const searchKeyword = bookName || book.book_name_simplified;
        if (!searchKeyword) {
            return res
                .status(400)
                .json({ error: "Book name is required for search" });
        }

        // Search for the book on Cool18
        const cool18Scraper = require("../services/cool18Scraper");
        const chapterExtractor = require("../services/chapterExtractor");

        const searchResults = await cool18Scraper.searchForum(searchKeyword, 5);

        // Filter results to find chapters matching missing chapter numbers
        const foundChapters = [];
        const missingSet = new Set(missingChapters);

        for (const thread of searchResults) {
            const chapterInfo = chapterExtractor.extractChapterNumber(
                thread.title
            );
            if (chapterInfo && missingSet.has(chapterInfo.number)) {
                foundChapters.push({
                    chapterNumber: chapterInfo.number,
                    title: thread.title,
                    url: thread.url,
                    date: thread.date,
                });
            }
        }

        // Also check for multi-chapter pages (e.g., "1-5", "1,2,3", etc.)
        for (const thread of searchResults) {
            // Check for range patterns: "1-5", "1~5", "1至5"
            const rangeMatch = thread.title.match(/(\d+)[-~至到](\d+)/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                for (let i = start; i <= end; i++) {
                    if (missingSet.has(i)) {
                        // Check if we already have this chapter
                        if (
                            !foundChapters.find((ch) => ch.chapterNumber === i)
                        ) {
                            foundChapters.push({
                                chapterNumber: i,
                                title: thread.title,
                                url: thread.url,
                                date: thread.date,
                                isMultiChapter: true,
                                range: `${start}-${end}`,
                            });
                        }
                    }
                }
            }

            // Check for comma-separated chapters: "1,2,3" or "1, 2, 3"
            const commaMatch = thread.title.match(/(\d+(?:\s*,\s*\d+)+)/);
            if (commaMatch) {
                const numbers = commaMatch[1]
                    .split(",")
                    .map((n) => parseInt(n.trim()));
                for (const num of numbers) {
                    if (missingSet.has(num)) {
                        if (
                            !foundChapters.find(
                                (ch) => ch.chapterNumber === num
                            )
                        ) {
                            foundChapters.push({
                                chapterNumber: num,
                                title: thread.title,
                                url: thread.url,
                                date: thread.date,
                                isMultiChapter: true,
                                chapters: numbers,
                            });
                        }
                    }
                }
            }
        }

        // Sort by chapter number
        foundChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

        res.json({
            foundChapters,
            searchedFor: missingChapters,
            foundCount: foundChapters.length,
            missingCount: missingChapters.length,
        });
    } catch (error) {
        logger.error("Error searching for missing chapters", {
            bookId: req.params.id,
            error,
        });
        res.status(500).json({
            error: "Failed to search for missing chapters",
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
        if (req.body.content !== undefined) {
            updates.content = req.body.content;
        }
        if (req.body.status !== undefined) {
            updates.status = req.body.status;
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

// Search down for lower number chapters
router.post("/:id/search-down", async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        const chapters = await Chapter.findByBookId(req.params.id);
        const chapterNumbers = chapters
            .filter((ch) => ch.chapter_number !== null && ch.chapter_number !== undefined)
            .map((ch) => ch.chapter_number)
            .sort((a, b) => a - b);

        if (chapterNumbers.length === 0) {
            return res.status(400).json({ error: "No chapters found for this book" });
        }

        const minChapter = Math.min(...chapterNumbers);
        const searchKeyword = book.book_name_simplified;
        if (!searchKeyword) {
            return res.status(400).json({ error: "Book name is required for search" });
        }

        const cool18Scraper = require("../services/cool18Scraper");
        const chapterExtractor = require("../services/chapterExtractor");

        // Search with book name (up to 5 pages)
        const searchResults = await cool18Scraper.searchForum(searchKeyword, 5);
        const foundChapters = [];
        const existingChapters = new Set(chapterNumbers);
        const seenUrls = new Set();

        // Helper function to add chapter if not seen
        const addChapterIfNew = (chapter) => {
            if (!seenUrls.has(chapter.url)) {
                seenUrls.add(chapter.url);
                foundChapters.push(chapter);
            }
        };

        // Process search results from book name
        const processSearchResults = (results) => {
            // Find chapters with numbers lower than minChapter, up to chapter 1
            for (const thread of results) {
                const chapterInfo = chapterExtractor.extractChapterNumber(thread.title);
                if (chapterInfo && chapterInfo.number < minChapter && chapterInfo.number >= 1) {
                    // Only add if we don't already have this chapter
                    if (!existingChapters.has(chapterInfo.number)) {
                        addChapterIfNew({
                            chapterNumber: chapterInfo.number,
                            title: thread.title,
                            url: thread.url,
                            date: thread.date,
                        });
                    }
                }
            }

            // Also check for multi-chapter pages
            for (const thread of results) {
                const rangeMatch = thread.title.match(/(\d+)[-~至到](\d+)/);
                if (rangeMatch) {
                    const start = parseInt(rangeMatch[1]);
                    const end = parseInt(rangeMatch[2]);
                    for (let i = start; i <= end; i++) {
                        if (i < minChapter && i >= 1 && !existingChapters.has(i)) {
                            addChapterIfNew({
                                chapterNumber: i,
                                title: thread.title,
                                url: thread.url,
                                date: thread.date,
                                isMultiChapter: true,
                                range: `${start}-${end}`,
                            });
                        }
                    }
                }

                const commaMatch = thread.title.match(/(\d+(?:\s*,\s*\d+)+)/);
                if (commaMatch) {
                    const numbers = commaMatch[1]
                        .split(",")
                        .map((n) => parseInt(n.trim()));
                    for (const num of numbers) {
                        if (num < minChapter && num >= 1 && !existingChapters.has(num)) {
                            addChapterIfNew({
                                chapterNumber: num,
                                title: thread.title,
                                url: thread.url,
                                date: thread.date,
                                isMultiChapter: true,
                                chapters: numbers,
                            });
                        }
                    }
                }
            }
        };

        // Process results from book name search
        processSearchResults(searchResults);

        // Also search with author name if available
        if (book.author && book.author.trim()) {
            try {
                const authorSearchResults = await cool18Scraper.searchForum(book.author.trim(), 5);
                processSearchResults(authorSearchResults);
            } catch (error) {
                logger.warn("Error searching with author name", { author: book.author, error });
                // Continue even if author search fails
            }
        }

        // Sort by chapter number (ascending)
        foundChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

        res.json({
            foundChapters,
            minChapter,
            searchKeyword,
            authorSearched: book.author || null,
            pagesSearched: 5,
        });
    } catch (error) {
        logger.error("Error searching down for chapters", {
            bookId: req.params.id,
            error,
        });
        res.status(500).json({ error: "Failed to search down for chapters", message: error.message });
    }
});

// Search up for new higher number chapters
router.post("/:id/search-new", async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).json({ error: "Book not found" });
        }

        const chapters = await Chapter.findByBookId(req.params.id);
        const chapterNumbers = chapters
            .filter((ch) => ch.chapter_number !== null && ch.chapter_number !== undefined)
            .map((ch) => ch.chapter_number)
            .sort((a, b) => a - b);

        if (chapterNumbers.length === 0) {
            return res.status(400).json({ error: "No chapters found for this book" });
        }

        const maxChapter = Math.max(...chapterNumbers);
        const searchKeyword = book.book_name_simplified;
        if (!searchKeyword) {
            return res.status(400).json({ error: "Book name is required for search" });
        }

        const cool18Scraper = require("../services/cool18Scraper");
        const chapterExtractor = require("../services/chapterExtractor");

        // Search with book name (only 3 pages)
        const searchResults = await cool18Scraper.searchForum(searchKeyword, 3);
        const foundChapters = [];
        const existingChapters = new Set(chapterNumbers);
        const seenUrls = new Set();

        // Helper function to add chapter if not seen
        const addChapterIfNew = (chapter) => {
            if (!seenUrls.has(chapter.url)) {
                seenUrls.add(chapter.url);
                foundChapters.push(chapter);
            }
        };

        // Process search results
        const processSearchResults = (results) => {
            // Find chapters with numbers higher than maxChapter
            for (const thread of results) {
                const chapterInfo = chapterExtractor.extractChapterNumber(thread.title);
                if (chapterInfo && chapterInfo.number > maxChapter) {
                    // Only add if we don't already have this chapter
                    if (!existingChapters.has(chapterInfo.number)) {
                        addChapterIfNew({
                            chapterNumber: chapterInfo.number,
                            title: thread.title,
                            url: thread.url,
                            date: thread.date,
                        });
                    }
                }
            }

            // Also check for multi-chapter pages
            for (const thread of results) {
                const rangeMatch = thread.title.match(/(\d+)[-~至到](\d+)/);
                if (rangeMatch) {
                    const start = parseInt(rangeMatch[1]);
                    const end = parseInt(rangeMatch[2]);
                    for (let i = start; i <= end; i++) {
                        if (i > maxChapter && !existingChapters.has(i)) {
                            addChapterIfNew({
                                chapterNumber: i,
                                title: thread.title,
                                url: thread.url,
                                date: thread.date,
                                isMultiChapter: true,
                                range: `${start}-${end}`,
                            });
                        }
                    }
                }

                const commaMatch = thread.title.match(/(\d+(?:\s*,\s*\d+)+)/);
                if (commaMatch) {
                    const numbers = commaMatch[1]
                        .split(",")
                        .map((n) => parseInt(n.trim()));
                    for (const num of numbers) {
                        if (num > maxChapter && !existingChapters.has(num)) {
                            addChapterIfNew({
                                chapterNumber: num,
                                title: thread.title,
                                url: thread.url,
                                date: thread.date,
                                isMultiChapter: true,
                                chapters: numbers,
                            });
                        }
                    }
                }
            }
        };

        // Process results from book name search
        processSearchResults(searchResults);

        // Also search with author name if available
        if (book.author && book.author.trim()) {
            try {
                const authorSearchResults = await cool18Scraper.searchForum(book.author.trim(), 3);
                processSearchResults(authorSearchResults);
            } catch (error) {
                logger.warn("Error searching with author name", { author: book.author, error });
                // Continue even if author search fails
            }
        }

        // Sort by chapter number (ascending)
        foundChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

        res.json({
            foundChapters,
            maxChapter,
            searchKeyword,
            authorSearched: book.author || null,
            pagesSearched: 3,
        });
    } catch (error) {
        logger.error("Error searching for new chapters", {
            bookId: req.params.id,
            error,
        });
        res.status(500).json({ error: "Failed to search for new chapters", message: error.message });
    }
});

module.exports = router;
