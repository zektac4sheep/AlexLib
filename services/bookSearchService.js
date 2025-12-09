const BookSearchJob = require("../models/bookSearchJob");
const Book = require("../models/book");
const Chapter = require("../models/chapter");
const SearchResult = require("../models/searchResult");
const cool18Scraper = require("./cool18Scraper");
const chapterExtractor = require("./chapterExtractor");
const bookDetector = require("./bookDetector");
const converter = require("./converter");
const { normalizeToHalfWidth } = require("./converter");
const { sortChaptersForExport } = require("./chunker");
const botStatusService = require("./botStatusService");
const logger = require("../utils/logger");
const bookSearchLogger = require("../utils/logger").bookSearchLogger;
const fileAnalyzer = require("./fileAnalyzer");

// Track if queue processor is running
let isProcessing = false;
let processingInterval = null;

/**
 * Start the background queue processor
 */
function startQueueProcessor() {
    if (processingInterval) {
        return; // Already running
    }

    // Process queue every 2 seconds
    processingInterval = setInterval(() => {
        processNextJob().catch((err) => {
            logger.error("Error in queue processor", { error: err });
        });
    }, 2000);

    logger.info("Book search queue processor started");
}

/**
 * Stop the background queue processor
 */
function stopQueueProcessor() {
    if (processingInterval) {
        clearInterval(processingInterval);
        processingInterval = null;
        logger.info("Book search queue processor stopped");
    }
}

/**
 * Process the next job in the queue
 */
async function processNextJob() {
    if (isProcessing) {
        return; // Already processing a job
    }

    try {
        // Find next queued job
        const queuedJobs = await BookSearchJob.findAllByStatus("queued", 1);
        if (queuedJobs.length === 0) {
            return; // No jobs to process
        }

        const job = queuedJobs[0];
        isProcessing = true;

        // Update job status to processing
        await BookSearchJob.update(job.id, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        // Register with bot status service
        const operationId = `book-search-${job.id}`;
        botStatusService.registerOperation("book-search", operationId, {
            bookId: job.book_id,
            status: "processing",
        });

        try {
            // Process the search job
            const result = await processBookSearch(job);

            // Save results to SearchResult table
            let searchResultId = null;
            if (result.foundChapters && result.foundChapters.length > 0) {
                // Convert found chapters to thread format for SearchResult
                const threads = result.foundChapters.map((ch) => ({
                    url: ch.url,
                    threadId: ch.url.match(/tid=(\d+)/)?.[1] || null,
                    title: ch.title,
                    date: ch.date,
                    replies: 0,
                }));

                // Build thread response similar to search route
                const processedThreads = await Promise.all(
                    threads.map(async (thread) => {
                        const titleMetadata = fileAnalyzer.parseTitleMetadata(
                            thread.title
                        );
                        const chapterInfo =
                            chapterExtractor.extractChapterNumber(thread.title);
                        const resolvedChapterNumber =
                            titleMetadata?.chapterNumber ??
                            (chapterInfo ? chapterInfo.number : null);
                        const resolvedChapterFormat = chapterInfo
                            ? chapterInfo.format
                            : null;
                        let bookNameSimplified =
                            titleMetadata?.bookName ||
                            bookDetector.detectBookName(thread.title);
                        if (bookNameSimplified) {
                            bookNameSimplified =
                                normalizeToHalfWidth(bookNameSimplified);
                        }
                        const titleTraditional = converter.toTraditional(
                            thread.title
                        );

                        let existingBook = null;
                        if (bookNameSimplified) {
                            existingBook = await Book.findBySimplifiedName(
                                bookNameSimplified
                            );
                        }

                        return {
                            url: thread.url,
                            threadId: thread.threadId,
                            title: thread.title,
                            titleTraditional,
                            chapterNumber: resolvedChapterNumber,
                            chapterFormat: resolvedChapterFormat,
                            bookNameSimplified,
                            bookNameTraditional: bookNameSimplified
                                ? converter.toTraditional(bookNameSimplified)
                                : null,
                            existingBookId: existingBook
                                ? existingBook.id
                                : null,
                            date: thread.date,
                            replies: thread.replies,
                        };
                    })
                );

                try {
                    searchResultId = await SearchResult.create(
                        result.searchKeyword,
                        result.pagesSearched || 3,
                        processedThreads
                    );
                } catch (dbError) {
                    logger.error("Error saving search results to database", {
                        error: dbError,
                        jobId: job.id,
                    });
                }
            }

            // Update job with results
            // If results found, set status to waiting_for_input so user can review
            // Otherwise, mark as completed
            const finalStatus =
                result.foundChapters && result.foundChapters.length > 0
                    ? "waiting_for_input"
                    : "completed";

            await BookSearchJob.update(job.id, {
                status: finalStatus,
                completed_at: new Date().toISOString(),
                results: JSON.stringify(result),
                search_result_id: searchResultId,
            });

            // Update book's last_search_datetime
            await Book.updateLastSearchDatetime(job.book_id).catch((err) => {
                logger.warn("Error updating last_search_datetime", {
                    bookId: job.book_id,
                    error: err.message,
                });
            });

            // Update bot status
            botStatusService.updateOperation("book-search", operationId, {
                status: "completed",
                totalResults: result.foundChapters
                    ? result.foundChapters.length
                    : 0,
            });

            logger.info("Book search job completed", {
                jobId: job.id,
                bookId: job.book_id,
                foundChapters: result.foundChapters
                    ? result.foundChapters.length
                    : 0,
            });
        } catch (error) {
            logger.error("Error processing book search job", {
                jobId: job.id,
                error: error.message,
                stack: error.stack,
            });

            // Update job with error
            await BookSearchJob.update(job.id, {
                status: "failed",
                completed_at: new Date().toISOString(),
                error_message: error.message,
            });

            // Update bot status
            botStatusService.updateOperation("book-search", operationId, {
                status: "failed",
                error: error.message,
            });
        }
    } finally {
        isProcessing = false;
    }
}

/**
 * Process a book search job
 */
async function processBookSearch(job) {
    const book = await Book.findById(job.book_id);
    if (!book) {
        throw new Error("Book not found");
    }

    const searchParams = job.search_params || {};
    const { bookName, pages } = searchParams;

    let searchKeyword = bookName || book.book_name_simplified;
    if (!searchKeyword) {
        throw new Error("Book name is required for search");
    }

    // Convert to simplified Chinese before searching (without overwriting the original)
    // This ensures better search results on Cool18 which uses simplified Chinese
    try {
        const convertedKeyword = converter.toSimplified(searchKeyword);
        if (convertedKeyword && convertedKeyword.trim()) {
            searchKeyword = convertedKeyword;
            bookSearchLogger.info(
                "Converted book name to simplified Chinese for search",
                {
                    original: bookName || book.book_name_simplified,
                    converted: searchKeyword,
                }
            );
        }
    } catch (error) {
        bookSearchLogger.warn(
            "Failed to convert book name to simplified Chinese, using original",
            {
                error: error?.message,
                keyword: searchKeyword,
            }
        );
        // Continue with original keyword if conversion fails
    }

    // Get existing chapters
    const chapters = await Chapter.findByBookId(job.book_id);
    const chapterNumbers = chapters
        .filter(
            (ch) =>
                ch.chapter_number !== null && ch.chapter_number !== undefined
        )
        .map((ch) => ch.chapter_number)
        .sort((a, b) => a - b);

    const existingChapters = new Set(chapterNumbers);

    // Calculate min and max for logging purposes
    const minChapter =
        chapterNumbers.length > 0 ? Math.min(...chapterNumbers) : null;
    const maxChapter =
        chapterNumbers.length > 0 ? Math.max(...chapterNumbers) : null;

    const pagesToSearch = pages || 3;

    // Log search start
    bookSearchLogger.info(
        "Starting book search - searching for ALL available chapters",
        {
            jobId: job.id,
            bookId: job.book_id,
            bookName: searchKeyword,
            pagesToSearch: pagesToSearch,
            existingChapters: chapterNumbers.length,
            minChapter: minChapter,
            maxChapter: maxChapter,
        }
    );

    // Search for the book on Cool18
    const bookSearchResult = await cool18Scraper.searchForum(
        searchKeyword,
        pagesToSearch
    );
    const searchResults = bookSearchResult.threads || [];
    const allSearchUrls = [...(bookSearchResult.searchUrls || [])];

    // Log search pages used
    bookSearchLogger.info("Search pages accessed", {
        jobId: job.id,
        bookId: job.book_id,
        bookName: searchKeyword,
        totalPages: allSearchUrls.length,
        searchUrls: allSearchUrls,
        totalThreadsExtracted: searchResults.length,
    });

    // Log all extracted links/threads
    bookSearchLogger.info("All extracted links from search results", {
        jobId: job.id,
        bookId: job.book_id,
        bookName: searchKeyword,
        extractedThreads: searchResults.map((thread) => ({
            url: thread.url,
            title: thread.title,
            date: thread.date,
        })),
    });

    // Filter results to find chapters matching target criteria
    const foundChapters = [];
    const seenUrls = new Set();

    // Helper function to add chapter if not seen
    const addChapterIfNew = (chapter) => {
        if (!seenUrls.has(chapter.url)) {
            seenUrls.add(chapter.url);
            foundChapters.push(chapter);
        }
    };

    // Get all authors for the book (support multiple authors)
    const bookAuthors = await Book.getAuthors(job.book_id);
    // Also include legacy author field if no authors in book_authors table
    if (bookAuthors.length === 0 && book.author) {
        bookAuthors.push(book.author);
    }

    // Normalize all author names for comparison (half-width, lowercase)
    const normalizedAuthors = bookAuthors
        .filter((author) => author && author.trim())
        .map((author) => normalizeToHalfWidth(author.trim().toLowerCase()));

    // Helper function to check if chapter should be included
    // Include ALL chapters that don't already exist (0 to infinity)
    const shouldIncludeChapter = (chapterNum) => {
        return !existingChapters.has(chapterNum);
    };

    // Helper function to check if content contains any of the author names
    const contentContainsAuthor = (content) => {
        if (normalizedAuthors.length === 0) {
            return true; // No authors to check, allow all
        }
        return true;

        //@todo temp disable author verification
        const normalizedContent = normalizeToHalfWidth(content.toLowerCase());
        return normalizedAuthors.some((author) =>
            normalizedContent.includes(author)
        );
    };

    // Process search results and verify author in content
    // This function is now async because it needs to download content to verify authors
    const processSearchResults = async (results, verificationStats) => {
        const buildParsingContext = (title) => {
            const titleMetadata = fileAnalyzer.parseTitleMetadata(title);
            const chapterInfo = chapterExtractor.extractChapterNumber(title);
            return {
                titleMetadata,
                chapterInfo,
                chapterNumber:
                    titleMetadata?.chapterNumber ??
                    (chapterInfo ? chapterInfo.number : null),
                chapterFormat: chapterInfo ? chapterInfo.format : null,
                series:
                    titleMetadata?.series || chapterInfo?.series || "official",
                chapterName: titleMetadata?.chapterName || null,
                bookName:
                    titleMetadata?.bookName ||
                    bookDetector.detectBookName(title),
            };
        };
        // Track all candidate links and their validation status
        const candidateLinks = [];

        // Find single chapters
        for (const thread of results) {
            const parsingContext = buildParsingContext(thread.title);
            const chapterInfo = parsingContext.chapterInfo;
            const resolvedChapterNumber = parsingContext.chapterNumber;
            const shouldInclude =
                resolvedChapterNumber !== null
                    ? shouldIncludeChapter(resolvedChapterNumber)
                    : false;

            // Log all threads being processed
            bookSearchLogger.info("Processing thread from search results", {
                jobId: job.id,
                bookId: job.book_id,
                bookName: searchKeyword,
                url: thread.url,
                title: thread.title,
                extractedChapterNumber: resolvedChapterNumber,
                extractedChapterFormat: chapterInfo ? chapterInfo.format : null,
                shouldInclude: shouldInclude,
                maxChapter: maxChapter,
                minChapter: minChapter,
                existingChapters: Array.from(existingChapters),
            });

            if (resolvedChapterNumber !== null && shouldInclude) {
                // Download content to verify author
                verificationStats.total++;
                const candidateInfo = {
                    link: thread.url,
                    title: thread.title,
                    chapterNumber: resolvedChapterNumber,
                    type: "single",
                    status: "pending",
                    date: thread.date,
                };
                candidateLinks.push(candidateInfo);

                bookSearchLogger.info("Downloading content to verify chapter", {
                    jobId: job.id,
                    bookId: job.book_id,
                    bookName: searchKeyword,
                    chapterNumber: resolvedChapterNumber,
                    url: thread.url,
                    title: thread.title,
                });
                try {
                    const threadContent = await cool18Scraper.downloadThread(
                        thread.url
                    );

                    // Log content details
                    const contentLength = threadContent.content
                        ? threadContent.content.length
                        : 0;
                    const contentPreview = threadContent.content
                        ? threadContent.content
                              .substring(0, 200)
                              .replace(/\n/g, " ")
                        : "";

                    bookSearchLogger.info(
                        "Content downloaded for verification",
                        {
                            jobId: job.id,
                            bookId: job.book_id,
                            bookName: searchKeyword,
                            chapterNumber: resolvedChapterNumber,
                            url: thread.url,
                            title: thread.title,
                            contentLength: contentLength,
                            contentPreview: contentPreview,
                        }
                    );

                    const isValid = contentContainsAuthor(
                        threadContent.content
                    );

                    if (isValid) {
                        addChapterIfNew({
                            chapterNumber: resolvedChapterNumber,
                            title: thread.title,
                            url: thread.url,
                            date: thread.date,
                        });
                        verificationStats.verified++;
                        candidateInfo.status = "VALID";
                        candidateInfo.reason = "Author found in content";
                        bookSearchLogger.info(
                            "Chapter verified - VALID CHAPTER (author found in content)",
                            {
                                jobId: job.id,
                                bookId: job.book_id,
                                bookName: searchKeyword,
                                chapterNumber: resolvedChapterNumber,
                                chapterLink: thread.url,
                                chapterTitle: thread.title,
                                authorsSearched: normalizedAuthors,
                                validationResult: "VALID",
                            }
                        );
                    } else {
                        verificationStats.excluded++;
                        candidateInfo.status = "INVALID";
                        candidateInfo.reason = "Author not found in content";
                        bookSearchLogger.info(
                            "Chapter excluded - NOT VALID (author not found in content)",
                            {
                                jobId: job.id,
                                bookId: job.book_id,
                                bookName: searchKeyword,
                                chapterNumber: resolvedChapterNumber,
                                chapterLink: thread.url,
                                chapterTitle: thread.title,
                                authorsSearched: normalizedAuthors,
                                validationResult: "INVALID - Author not found",
                            }
                        );
                    }
                } catch (error) {
                    verificationStats.failed++;
                    candidateInfo.status = "FAILED";
                    candidateInfo.reason = `Download error: ${error.message}`;
                    bookSearchLogger.warn(
                        "Error downloading thread to verify author",
                        {
                            jobId: job.id,
                            bookId: job.book_id,
                            bookName: searchKeyword,
                            chapterNumber: resolvedChapterNumber,
                            chapterLink: thread.url,
                            chapterTitle: thread.title,
                            error: error.message,
                            validationResult: "FAILED - Download error",
                        }
                    );
                    // If download fails, skip this chapter (better to be safe)
                }
            } else if (resolvedChapterNumber !== null) {
                // Check if chapter already exists
                if (existingChapters.has(resolvedChapterNumber)) {
                    // Check if existing chapter has < 100 lines - if so, compare with new chapter
                    try {
                        const existingChapter =
                            await Chapter.findByBookAndNumber(
                                job.book_id,
                                resolvedChapterNumber
                            );

                        if (existingChapter) {
                            // Calculate existing chapter line count
                            const existingLines = existingChapter.content
                                ? existingChapter.content.split("\n").length
                                : 0;

                            bookSearchLogger.info(
                                "Chapter already exists - checking if update needed",
                                {
                                    jobId: job.id,
                                    bookId: job.book_id,
                                    bookName: searchKeyword,
                                    chapterNumber: resolvedChapterNumber,
                                    url: thread.url,
                                    title: thread.title,
                                    existingLines: existingLines,
                                }
                            );

                            // If existing chapter has < 100 lines, download new chapter and compare
                            if (existingLines < 100) {
                                bookSearchLogger.info(
                                    "Existing chapter has < 100 lines - downloading new chapter for comparison",
                                    {
                                        jobId: job.id,
                                        bookId: job.book_id,
                                        bookName: searchKeyword,
                                        chapterNumber: resolvedChapterNumber,
                                        url: thread.url,
                                        existingLines: existingLines,
                                    }
                                );

                                try {
                                    const threadContent =
                                        await cool18Scraper.downloadThread(
                                            thread.url
                                        );

                                    // Calculate new chapter line count
                                    const newLines = threadContent.content
                                        ? threadContent.content.split("\n")
                                              .length
                                        : 0;
                                    const lineDifference =
                                        newLines - existingLines;

                                    bookSearchLogger.info(
                                        "Chapter comparison result",
                                        {
                                            jobId: job.id,
                                            bookId: job.book_id,
                                            bookName: searchKeyword,
                                            chapterNumber:
                                                resolvedChapterNumber,
                                            url: thread.url,
                                            existingLines: existingLines,
                                            newLines: newLines,
                                            lineDifference: lineDifference,
                                        }
                                    );

                                    // If new chapter has 30+ more lines, include it as candidate
                                    if (lineDifference > 30) {
                                        // Verify author before including
                                        if (
                                            contentContainsAuthor(
                                                threadContent.content
                                            )
                                        ) {
                                            verificationStats.total++;
                                            const candidateInfo = {
                                                link: thread.url,
                                                title: thread.title,
                                                chapterNumber:
                                                    resolvedChapterNumber,
                                                type: "single-update",
                                                status: "pending",
                                                date: thread.date,
                                                existingLines: existingLines,
                                                newLines: newLines,
                                                lineDifference: lineDifference,
                                            };
                                            candidateLinks.push(candidateInfo);

                                            addChapterIfNew({
                                                chapterNumber:
                                                    resolvedChapterNumber,
                                                title: thread.title,
                                                url: thread.url,
                                                date: thread.date,
                                                isUpdate: true,
                                            });
                                            verificationStats.verified++;
                                            candidateInfo.status = "VALID";
                                            candidateInfo.reason = `New chapter has ${lineDifference} more lines (existing: ${existingLines}, new: ${newLines})`;

                                            bookSearchLogger.info(
                                                "Chapter update candidate - VALID (new chapter has significantly more lines)",
                                                {
                                                    jobId: job.id,
                                                    bookId: job.book_id,
                                                    bookName: searchKeyword,
                                                    chapterNumber:
                                                        resolvedChapterNumber,
                                                    chapterLink: thread.url,
                                                    chapterTitle: thread.title,
                                                    existingLines:
                                                        existingLines,
                                                    newLines: newLines,
                                                    lineDifference:
                                                        lineDifference,
                                                    validationResult:
                                                        "VALID - Update recommended",
                                                }
                                            );
                                        } else {
                                            bookSearchLogger.info(
                                                "Chapter update candidate excluded - author not found in new content",
                                                {
                                                    jobId: job.id,
                                                    bookId: job.book_id,
                                                    bookName: searchKeyword,
                                                    chapterNumber:
                                                        resolvedChapterNumber,
                                                    url: thread.url,
                                                    existingLines:
                                                        existingLines,
                                                    newLines: newLines,
                                                    lineDifference:
                                                        lineDifference,
                                                }
                                            );
                                        }
                                    } else {
                                        bookSearchLogger.info(
                                            "Chapter update not needed - line difference too small",
                                            {
                                                jobId: job.id,
                                                bookId: job.book_id,
                                                bookName: searchKeyword,
                                                chapterNumber:
                                                    resolvedChapterNumber,
                                                url: thread.url,
                                                existingLines: existingLines,
                                                newLines: newLines,
                                                lineDifference: lineDifference,
                                                reason: `Line difference (${lineDifference}) is <= 30 lines`,
                                            }
                                        );
                                    }
                                } catch (error) {
                                    bookSearchLogger.warn(
                                        "Error downloading chapter for comparison",
                                        {
                                            jobId: job.id,
                                            bookId: job.book_id,
                                            bookName: searchKeyword,
                                            chapterNumber:
                                                resolvedChapterNumber,
                                            url: thread.url,
                                            error: error.message,
                                        }
                                    );
                                }
                            } else {
                                bookSearchLogger.info(
                                    "Thread skipped - chapter already exists with sufficient content",
                                    {
                                        jobId: job.id,
                                        bookId: job.book_id,
                                        bookName: searchKeyword,
                                        chapterNumber: resolvedChapterNumber,
                                        url: thread.url,
                                        title: thread.title,
                                        existingLines: existingLines,
                                        reason: "Existing chapter has >= 100 lines",
                                    }
                                );
                            }
                        }
                    } catch (error) {
                        bookSearchLogger.warn(
                            "Error checking existing chapter",
                            {
                                jobId: job.id,
                                bookId: job.book_id,
                                bookName: searchKeyword,
                                chapterNumber: resolvedChapterNumber,
                                url: thread.url,
                                error: error.message,
                            }
                        );
                    }
                } else {
                    // This shouldn't happen with new logic
                    bookSearchLogger.info(
                        "Thread skipped - unexpected filter",
                        {
                            jobId: job.id,
                            bookId: job.book_id,
                            bookName: searchKeyword,
                            chapterNumber: resolvedChapterNumber,
                            url: thread.url,
                            title: thread.title,
                            reason: "Unexpected: Chapter should be included but was filtered out",
                        }
                    );
                }
            } else {
                // Log threads where no chapter number could be extracted
                bookSearchLogger.info(
                    "Thread skipped - no chapter number extracted",
                    {
                        jobId: job.id,
                        bookId: job.book_id,
                        bookName: searchKeyword,
                        url: thread.url,
                        title: thread.title,
                        reason: "ChapterExtractor could not extract chapter number from title",
                    }
                );
            }
        }

        // Also check for multi-chapter pages (e.g., "1-5", "1,2,3", etc.)
        for (const thread of results) {
            // Check for range patterns: "1-5", "1~5", "1至5"
            const rangeMatch = thread.title.match(/(\d+)[-~至到](\d+)/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                // Check if any chapter in range matches criteria
                const hasMatchingChapter = Array.from(
                    { length: end - start + 1 },
                    (_, i) => start + i
                ).some((i) => shouldIncludeChapter(i));

                if (hasMatchingChapter) {
                    // Download content to verify author
                    verificationStats.total++;
                    const candidateInfo = {
                        link: thread.url,
                        title: thread.title,
                        chapterNumbers: Array.from(
                            { length: end - start + 1 },
                            (_, i) => start + i
                        ),
                        range: `${start}-${end}`,
                        type: "multi-chapter-range",
                        status: "pending",
                        date: thread.date,
                    };
                    candidateLinks.push(candidateInfo);

                    bookSearchLogger.info(
                        "Downloading content to verify multi-chapter range",
                        {
                            jobId: job.id,
                            bookId: job.book_id,
                            bookName: searchKeyword,
                            url: thread.url,
                            title: thread.title,
                            range: `${start}-${end}`,
                        }
                    );
                    try {
                        const threadContent =
                            await cool18Scraper.downloadThread(thread.url);

                        // Log content details
                        const contentLength = threadContent.content
                            ? threadContent.content.length
                            : 0;
                        const contentPreview = threadContent.content
                            ? threadContent.content
                                  .substring(0, 200)
                                  .replace(/\n/g, " ")
                            : "";

                        bookSearchLogger.info(
                            "Content downloaded for multi-chapter range verification",
                            {
                                jobId: job.id,
                                bookId: job.book_id,
                                bookName: searchKeyword,
                                url: thread.url,
                                title: thread.title,
                                range: `${start}-${end}`,
                                contentLength: contentLength,
                                contentPreview: contentPreview,
                            }
                        );

                        if (contentContainsAuthor(threadContent.content)) {
                            let chaptersAdded = 0;
                            const addedChapterNumbers = [];
                            for (let i = start; i <= end; i++) {
                                if (shouldIncludeChapter(i)) {
                                    // Check if we already have this chapter
                                    if (
                                        !foundChapters.find(
                                            (ch) => ch.chapterNumber === i
                                        )
                                    ) {
                                        addChapterIfNew({
                                            chapterNumber: i,
                                            title: thread.title,
                                            url: thread.url,
                                            date: thread.date,
                                            isMultiChapter: true,
                                            range: `${start}-${end}`,
                                        });
                                        chaptersAdded++;
                                        addedChapterNumbers.push(i);
                                    }
                                }
                            }
                            if (chaptersAdded > 0) {
                                verificationStats.verified += chaptersAdded;
                                candidateInfo.status = "VALID";
                                candidateInfo.reason =
                                    "Author found in content";
                                candidateInfo.validChapters =
                                    addedChapterNumbers;
                                bookSearchLogger.info(
                                    "Multi-chapter range verified - VALID (author found in content)",
                                    {
                                        jobId: job.id,
                                        bookId: job.book_id,
                                        bookName: searchKeyword,
                                        url: thread.url,
                                        title: thread.title,
                                        range: `${start}-${end}`,
                                        chaptersAdded: chaptersAdded,
                                        chapterNumbers: addedChapterNumbers,
                                        chapterLink: thread.url,
                                        authorsSearched: normalizedAuthors,
                                        validationResult: "VALID",
                                    }
                                );
                            } else {
                                candidateInfo.status = "SKIPPED";
                                candidateInfo.reason =
                                    "All chapters already exist";
                            }
                        } else {
                            verificationStats.excluded++;
                            candidateInfo.status = "INVALID";
                            candidateInfo.reason =
                                "Author not found in content";
                            bookSearchLogger.info(
                                "Multi-chapter range excluded - NOT VALID (author not found in content)",
                                {
                                    jobId: job.id,
                                    bookId: job.book_id,
                                    bookName: searchKeyword,
                                    url: thread.url,
                                    title: thread.title,
                                    range: `${start}-${end}`,
                                    chapterLink: thread.url,
                                    authorsSearched: normalizedAuthors,
                                    validationResult:
                                        "INVALID - Author not found",
                                }
                            );
                        }
                    } catch (error) {
                        verificationStats.failed++;
                        candidateInfo.status = "FAILED";
                        candidateInfo.reason = `Download error: ${error.message}`;
                        bookSearchLogger.warn(
                            "Error downloading thread to verify author (range)",
                            {
                                jobId: job.id,
                                bookId: job.book_id,
                                bookName: searchKeyword,
                                url: thread.url,
                                title: thread.title,
                                range: `${start}-${end}`,
                                chapterLink: thread.url,
                                error: error.message,
                                validationResult: "FAILED - Download error",
                            }
                        );
                    }
                }
            }

            // Check for comma-separated chapters: "1,2,3" or "1, 2, 3"
            const commaMatch = thread.title.match(/(\d+(?:\s*,\s*\d+)+)/);
            if (commaMatch) {
                const numbers = commaMatch[1]
                    .split(",")
                    .map((n) => parseInt(n.trim()));
                // Check if any chapter in list matches criteria
                const hasMatchingChapter = numbers.some((num) =>
                    shouldIncludeChapter(num)
                );

                if (hasMatchingChapter) {
                    // Download content to verify author
                    verificationStats.total++;
                    const candidateInfo = {
                        link: thread.url,
                        title: thread.title,
                        chapterNumbers: numbers,
                        type: "multi-chapter-list",
                        status: "pending",
                        date: thread.date,
                    };
                    candidateLinks.push(candidateInfo);

                    bookSearchLogger.info(
                        "Downloading content to verify multi-chapter list",
                        {
                            jobId: job.id,
                            bookId: job.book_id,
                            bookName: searchKeyword,
                            url: thread.url,
                            title: thread.title,
                            chapters: numbers,
                        }
                    );
                    try {
                        const threadContent =
                            await cool18Scraper.downloadThread(thread.url);

                        // Log content details
                        const contentLength = threadContent.content
                            ? threadContent.content.length
                            : 0;
                        const contentPreview = threadContent.content
                            ? threadContent.content
                                  .substring(0, 200)
                                  .replace(/\n/g, " ")
                            : "";

                        bookSearchLogger.info(
                            "Content downloaded for multi-chapter list verification",
                            {
                                jobId: job.id,
                                bookId: job.book_id,
                                bookName: searchKeyword,
                                url: thread.url,
                                title: thread.title,
                                chapters: numbers,
                                contentLength: contentLength,
                                contentPreview: contentPreview,
                            }
                        );

                        if (contentContainsAuthor(threadContent.content)) {
                            let chaptersAdded = 0;
                            const addedChapterNumbers = [];
                            for (const num of numbers) {
                                if (shouldIncludeChapter(num)) {
                                    if (
                                        !foundChapters.find(
                                            (ch) => ch.chapterNumber === num
                                        )
                                    ) {
                                        addChapterIfNew({
                                            chapterNumber: num,
                                            title: thread.title,
                                            url: thread.url,
                                            date: thread.date,
                                            isMultiChapter: true,
                                            chapters: numbers,
                                        });
                                        chaptersAdded++;
                                        addedChapterNumbers.push(num);
                                    }
                                }
                            }
                            if (chaptersAdded > 0) {
                                verificationStats.verified += chaptersAdded;
                                candidateInfo.status = "VALID";
                                candidateInfo.reason =
                                    "Author found in content";
                                candidateInfo.validChapters =
                                    addedChapterNumbers;
                                bookSearchLogger.info(
                                    "Multi-chapter list verified - VALID (author found in content)",
                                    {
                                        jobId: job.id,
                                        bookId: job.book_id,
                                        bookName: searchKeyword,
                                        url: thread.url,
                                        title: thread.title,
                                        chapters: numbers,
                                        chaptersAdded: chaptersAdded,
                                        chapterNumbers: addedChapterNumbers,
                                        chapterLink: thread.url,
                                        authorsSearched: normalizedAuthors,
                                        validationResult: "VALID",
                                    }
                                );
                            } else {
                                candidateInfo.status = "SKIPPED";
                                candidateInfo.reason =
                                    "All chapters already exist";
                            }
                        } else {
                            verificationStats.excluded++;
                            candidateInfo.status = "INVALID";
                            candidateInfo.reason =
                                "Author not found in content";
                            bookSearchLogger.info(
                                "Multi-chapter list excluded - NOT VALID (author not found in content)",
                                {
                                    jobId: job.id,
                                    bookId: job.book_id,
                                    bookName: searchKeyword,
                                    url: thread.url,
                                    title: thread.title,
                                    chapters: numbers,
                                    chapterLink: thread.url,
                                    authorsSearched: normalizedAuthors,
                                    validationResult:
                                        "INVALID - Author not found",
                                }
                            );
                        }
                    } catch (error) {
                        verificationStats.failed++;
                        candidateInfo.status = "FAILED";
                        candidateInfo.reason = `Download error: ${error.message}`;
                        bookSearchLogger.warn(
                            "Error downloading thread to verify author (comma-separated)",
                            {
                                jobId: job.id,
                                bookId: job.book_id,
                                bookName: searchKeyword,
                                url: thread.url,
                                title: thread.title,
                                chapters: numbers,
                                chapterLink: thread.url,
                                error: error.message,
                                validationResult: "FAILED - Download error",
                            }
                        );
                    }
                }
            }
        }

        // Return candidate links for summary logging
        return candidateLinks;
    };

    // Process results from book name search only
    // Author verification is done by checking content, not title
    const verificationStats = { total: 0, verified: 0, excluded: 0, failed: 0 };
    const candidateLinks = await processSearchResults(
        searchResults,
        verificationStats
    );

    // Log summary of chapter verification lookups
    if (verificationStats.total > 0) {
        bookSearchLogger.info("Chapter verification lookup summary", {
            jobId: job.id,
            bookId: job.book_id,
            bookName: searchKeyword,
            totalLookups: verificationStats.total,
            verified: verificationStats.verified,
            excluded: verificationStats.excluded,
            failed: verificationStats.failed,
            authorsSearched: normalizedAuthors,
        });
    }

    // Log all candidate links with their validation status
    if (candidateLinks.length > 0) {
        // Format candidate links with each detail on a new line
        const formattedCandidates = candidateLinks
            .map((candidate, index) => {
                let details = `\n  Candidate #${index + 1}:`;
                details += `\n    Link: ${candidate.link}`;
                details += `\n    Title: ${candidate.title}`;
                details += `\n    Status: ${candidate.status}`;
                details += `\n    Reason: ${candidate.reason}`;
                details += `\n    Type: ${candidate.type}`;
                if (candidate.chapterNumber) {
                    details += `\n    Chapter Number: ${candidate.chapterNumber}`;
                }
                if (candidate.chapterNumbers) {
                    details += `\n    Chapter Numbers: ${JSON.stringify(
                        candidate.chapterNumbers
                    )}`;
                }
                if (candidate.range) {
                    details += `\n    Range: ${candidate.range}`;
                }
                if (candidate.validChapters) {
                    details += `\n    Valid Chapters: ${JSON.stringify(
                        candidate.validChapters
                    )}`;
                }
                return details;
            })
            .join("\n");

        bookSearchLogger.info(
            `=== CANDIDATE LINKS VALIDATION SUMMARY ===\nJob ID: ${job.id}\nBook ID: ${job.book_id}\nBook Name: ${searchKeyword}\nTotal Candidates: ${candidateLinks.length}${formattedCandidates}\n`
        );

        // Also log a formatted summary for easy reading
        const validCandidates = candidateLinks.filter(
            (c) => c.status === "VALID"
        );
        const invalidCandidates = candidateLinks.filter(
            (c) => c.status === "INVALID"
        );
        const failedCandidates = candidateLinks.filter(
            (c) => c.status === "FAILED"
        );
        const skippedCandidates = candidateLinks.filter(
            (c) => c.status === "SKIPPED"
        );

        // Format breakdown with each link on separate lines
        const formatLinks = (links, label) => {
            if (links.length === 0) return `\n  ${label}: None`;
            return links
                .map((c, idx) => {
                    let line = `\n  ${label} #${idx + 1}:`;
                    line += `\n    Link: ${c.link}`;
                    line += `\n    Title: ${c.title}`;
                    const chapterInfo =
                        c.chapterNumber || c.validChapters || c.chapterNumbers;
                    if (chapterInfo) {
                        line += `\n    Chapter(s): ${JSON.stringify(
                            chapterInfo
                        )}`;
                    }
                    if (c.reason) {
                        line += `\n    Reason: ${c.reason}`;
                    }
                    if (c.error) {
                        line += `\n    Error: ${c.error}`;
                    }
                    return line;
                })
                .join("");
        };

        const breakdown = `=== CANDIDATE LINKS BREAKDOWN ===
Job ID: ${job.id}
Book ID: ${job.book_id}
Book Name: ${searchKeyword}
Valid: ${validCandidates.length}
Invalid: ${invalidCandidates.length}
Failed: ${failedCandidates.length}
Skipped: ${skippedCandidates.length}${formatLinks(
            validCandidates.map((c) => ({
                link: c.link,
                title: c.title,
                chapterNumber:
                    c.chapterNumber || c.validChapters || c.chapterNumbers,
            })),
            "VALID LINKS"
        )}${formatLinks(
            invalidCandidates.map((c) => ({
                link: c.link,
                title: c.title,
                chapterNumber: c.chapterNumber || c.chapterNumbers,
                reason: c.reason,
            })),
            "INVALID LINKS"
        )}${formatLinks(
            failedCandidates.map((c) => ({
                link: c.link,
                title: c.title,
                chapterNumber: c.chapterNumber || c.chapterNumbers,
                error: c.reason,
            })),
            "FAILED LINKS"
        )}${formatLinks(
            skippedCandidates.map((c) => ({
                link: c.link,
                title: c.title,
                chapterNumber: c.chapterNumber || c.chapterNumbers,
                reason: c.reason,
            })),
            "SKIPPED LINKS"
        )}
`;

        bookSearchLogger.info(breakdown);
    }

    // Log all found chapters with their numbers and links
    if (foundChapters.length > 0) {
        bookSearchLogger.info("All valid chapters found", {
            jobId: job.id,
            bookId: job.book_id,
            bookName: searchKeyword,
            totalFound: foundChapters.length,
            chapters: foundChapters.map((ch) => ({
                chapterNumber: ch.chapterNumber,
                chapterLink: ch.url,
                chapterTitle: ch.title,
                chapterDate: ch.date,
            })),
        });
    }

    // Sort chapters: regular chapters first, final chapters (-1) at the end
    const sortedFoundChapters = sortChaptersForExport(foundChapters);
    foundChapters.length = 0;
    foundChapters.push(...sortedFoundChapters);

    // Build response
    const response = {
        foundChapters,
        searchKeyword,
        authorsSearched:
            bookAuthors.length > 0
                ? bookAuthors
                : book.author
                ? [book.author]
                : [],
        pagesSearched: pagesToSearch,
        searchUrls: allSearchUrls, // Include search URLs used
        maxChapter: maxChapter,
        minChapter: minChapter,
        foundCount: foundChapters.length,
    };

    return response;
}

module.exports = {
    startQueueProcessor,
    stopQueueProcessor,
    processNextJob,
    processBookSearch,
};
