/**
 * Download Service
 * Orchestrates concurrent downloads, text processing, and database storage
 */

const pLimit = require("p-limit").default || require("p-limit");
const cool18Scraper = require("./cool18Scraper");
const textProcessor = require("./textProcessor");
const chapterExtractor = require("./chapterExtractor");
const converter = require("./converter");
const fileAnalyzer = require("./fileAnalyzer");
const Book = require("../models/book");
const Chapter = require("../models/chapter");
const DownloadJob = require("../models/download");
const BookTag = require("../models/bookTag");
const tagExtractor = require("./tagExtractor");
const botStatusService = require("./botStatusService");
const logger = require("../utils/logger");

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || "6");
const limit = pLimit(MAX_CONCURRENT);

// Store progress callbacks for SSE
const progressCallbacks = new Map();

/**
 * Download and process a single chapter
 * @param {Object} chapterData - {url, title, chapterNum, bookId}
 * @param {number} jobId - Download job ID
 * @returns {Promise<Object>} - Processed chapter data
 */
async function downloadChapter(chapterData, jobId) {
    const { url, title, chapterNum, bookId } = chapterData;

    logger.info("downloadChapter called", {
        url,
        bookId,
        chapterNum,
        chapterDataKeys: Object.keys(chapterData),
    });

    try {
        // Check if chapter already exists
        const existing = await Chapter.findByUrl(url);
        if (existing) {
            logger.info("Existing chapter found by URL", {
                url,
                existingChapterId: existing.id,
                existingBookId: existing.book_id,
                requestedBookId: bookId,
                status: existing.status,
            });
            // If existing chapter belongs to a different book, don't use it
            if (existing.book_id !== bookId) {
                logger.warn(
                    "Existing chapter belongs to different book, will create new one",
                    {
                        url,
                        existingBookId: existing.book_id,
                        requestedBookId: bookId,
                        existingChapterId: existing.id,
                    }
                );
                // Don't use existing chapter, continue to create new one
            } else if (existing.status === "downloaded") {
                emitProgress(jobId, {
                    type: "chapter-skipped",
                    url,
                    chapterNum,
                    message: "Chapter already downloaded",
                });
                return existing;
            }
        }

        emitProgress(jobId, {
            type: "chapter-start",
            url,
            chapterNum,
            message: `Downloading chapter ${chapterNum}...`,
        });

        // Download thread content
        const threadData = await cool18Scraper.downloadThread(url);

        const titleCandidates = [
            threadData.mainTitle,
            threadData.metadata?.mainTitle,
            threadData.metadata?.title,
            threadData.title,
        ].filter(Boolean);
        let firstChapterMetadata = null;
        for (const candidate of titleCandidates) {
            const parsed = fileAnalyzer.parseTitleMetadata(candidate);
            if (parsed) {
                firstChapterMetadata = parsed;
                logger.info("Parsed title metadata from candidate", {
                    candidate: candidate.substring(0, 100),
                    metadata: parsed,
                });
                break;
            }
        }

        // Log if no metadata was parsed
        if (!firstChapterMetadata) {
            logger.warn("No title metadata parsed from any candidate", {
                url,
                candidates: titleCandidates.map((c) => c.substring(0, 100)),
            });
        }

        // Extract chapter info
        const chapterInfo = chapterExtractor.extractChapterNumber(
            threadData.title
        );
        const chapterNumber =
            chapterNum ||
            (firstChapterMetadata?.chapterNumber ??
                (chapterInfo ? chapterInfo.number : null));
        const series =
            firstChapterMetadata?.series || chapterInfo?.series || "official";
        const chapterTitleSimplified = threadData.title;
        const chapterTitle = converter.toTraditional(chapterTitleSimplified);
        let chapterNameFromTitle = firstChapterMetadata?.chapterName || "";

        // Helper function to strip site suffix (reuse from fileAnalyzer)
        function stripSiteSuffix(text) {
            if (!text) return "";
            let result = text;
            const patterns = [
                /\s*[-－–—]\s*禁忌[书書]屋.*$/i,
                /\s*[-－–—]\s*禁忌[书書]坊.*$/i,
            ];
            for (const pattern of patterns) {
                result = result.replace(pattern, "");
            }
            return result.trim();
        }

        // Fallback: if we have chapterInfo but no chapter name, try to extract it from title
        if (!chapterNameFromTitle && chapterInfo?.fullMatch) {
            const matchIndex = chapterTitleSimplified.indexOf(
                chapterInfo.fullMatch
            );
            if (matchIndex >= 0) {
                const after = chapterTitleSimplified
                    .slice(matchIndex + chapterInfo.fullMatch.length)
                    .trim();
                // Remove site suffix if present
                const cleaned = stripSiteSuffix(after);
                if (cleaned) {
                    chapterNameFromTitle = cleaned;
                }
            }
        }

        // Additional fallback: try to extract from "第一章 章节名" pattern directly
        if (!chapterNameFromTitle) {
            // Pattern: 第X章 章节名
            const chapterNamePattern =
                /第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)\s+(.+?)(?:\s*[-－–—]|$)/;
            const match = chapterTitleSimplified.match(chapterNamePattern);
            if (match && match[1]) {
                const cleaned = stripSiteSuffix(match[1].trim());
                if (cleaned) {
                    chapterNameFromTitle = cleaned;
                }
            }
        }

        // Process content using new formatting rules
        const rawContent = threadData.content;

        // Check if content contains multiple chapters
        const detectedChapters = fileAnalyzer.detectChapters(rawContent, {
            firstChapterMetadata,
        });

        // If multiple chapters detected, split and save each separately
        if (detectedChapters && detectedChapters.length > 1) {
            const savedChapters = [];
            for (const detectedChapter of detectedChapters) {
                const detectedChapterNumber = detectedChapter.number;
                const detectedChapterTitle =
                    detectedChapter.title || `第${detectedChapterNumber}章`;
                const detectedChapterName = detectedChapter.name || "";

                // Format each chapter content using reformatChapterContent (same as check_reformat.js)
                const chapterContent = textProcessor.reformatChapterContent(
                    detectedChapter.content,
                    detectedChapterTitle,
                    true, // Convert to Traditional Chinese
                    true // Enable detailed logging
                );

                const detectedSeries = detectedChapter.series || "official";

                // Validate bookId before proceeding
                if (!bookId || bookId === null || bookId === undefined) {
                    logger.error("Cannot create chapter: bookId is missing", {
                        url,
                        chapterNumber: detectedChapterNumber,
                        chapterData,
                    });
                    throw new Error("bookId is required to create chapter");
                }

                const chapterRecord = {
                    book_id: bookId,
                    chapter_number: detectedChapterNumber,
                    chapter_title:
                        converter.toTraditional(detectedChapterTitle),
                    chapter_title_simplified: detectedChapterTitle,
                    chapter_name: detectedChapterName,
                    job_id: jobId,
                    cool18_url: url,
                    cool18_thread_id: cool18Scraper.extractThreadId(url),
                    content: chapterContent,
                    status: "downloaded",
                    series: detectedSeries,
                };

                // Check if chapter already exists
                const existingChapter = await Chapter.findByBookAndNumber(
                    bookId,
                    detectedChapterNumber,
                    detectedSeries
                );

                let chapterId;
                let wasNew = false;
                if (existingChapter) {
                    logger.info(
                        "Multi-chapter: Chapter already exists, updating",
                        {
                            existingChapterId: existingChapter.id,
                            bookId,
                            chapterNumber: detectedChapterNumber,
                            series: detectedSeries,
                            url,
                        }
                    );
                    // Update existing chapter only if action is overwrite or not specified
                    if (
                        chapterData.action === "overwrite" ||
                        !chapterData.action
                    ) {
                        await Chapter.updateByBookSeriesAndNumber(
                            bookId,
                            detectedSeries,
                            detectedChapterNumber,
                            chapterRecord
                        );
                        chapterId = existingChapter.id;
                    } else {
                        // Skip if action is discard
                        logger.info(
                            "Multi-chapter: Skipping chapter (discard action)",
                            {
                                bookId,
                                chapterNumber: detectedChapterNumber,
                                url,
                            }
                        );
                        continue;
                    }
                } else {
                    // Create new chapter
                    try {
                        logger.info("Attempting to create multi-chapter", {
                            bookId,
                            chapterNumber: detectedChapterNumber,
                            series: detectedSeries,
                            chapterRecord: {
                                ...chapterRecord,
                                content: chapterRecord.content
                                    ? `${chapterRecord.content.length} chars`
                                    : "empty",
                            },
                            url,
                        });
                        chapterId = await Chapter.create(chapterRecord);
                        wasNew = true;
                        logger.info(
                            "Multi-chapter: Chapter created in database",
                            {
                                chapterId,
                                bookId,
                                chapterNumber: detectedChapterNumber,
                                series: detectedSeries,
                                chapterName: detectedChapterName,
                                url,
                            }
                        );
                    } catch (createError) {
                        logger.error(
                            "Error creating multi-chapter in database",
                            {
                                error: createError,
                                errorMessage: createError?.message,
                                errorStack: createError?.stack,
                                bookId,
                                chapterNumber: detectedChapterNumber,
                                series: detectedSeries,
                                chapterRecord: {
                                    ...chapterRecord,
                                    content: chapterRecord.content
                                        ? `${chapterRecord.content.length} chars`
                                        : "empty",
                                },
                                url,
                            }
                        );
                        throw createError;
                    }
                }

                // Extract bookname for this chapter
                let chapterBookName =
                    detectedChapter.extractedBookName ||
                    firstChapterMetadata?.bookName ||
                    null;
                if (!chapterBookName && detectedChapterNumber) {
                    // Fallback: try to extract from chapter title
                    const titleMatch = detectedChapterTitle.match(
                        /^(.+?)\s+第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/
                    );
                    if (titleMatch && titleMatch[1]) {
                        chapterBookName = titleMatch[1].trim();
                    }
                }

                savedChapters.push({
                    id: chapterId,
                    ...chapterRecord,
                    capturedBookName: chapterBookName,
                });

                emitProgress(jobId, {
                    type: "chapter-complete",
                    url,
                    chapterNum: detectedChapterNumber,
                    message: `Chapter ${detectedChapterNumber} downloaded and split successfully`,
                });
            }

            // Return all saved chapters so they can all be tracked
            // If we have multiple chapters, return array; if only one, return it directly for backward compatibility
            return savedChapters.length > 1
                ? savedChapters
                : savedChapters.length === 1
                ? savedChapters[0]
                : null;
        }

        // Single chapter - process normally using reformatChapterContent (same as check_reformat.js)
        const finalContent = textProcessor.reformatChapterContent(
            rawContent,
            chapterTitle,
            true, // Convert to Traditional Chinese
            true // Enable detailed logging
        );

        // Log captured metadata for debugging
        logger.info("Single chapter download - captured metadata", {
            url,
            firstChapterMetadata,
            chapterNumber,
            chapterNameFromTitle,
            chapterTitleSimplified: chapterTitleSimplified.substring(0, 100),
        });

        // Validate bookId before proceeding
        if (!bookId || bookId === null || bookId === undefined) {
            logger.error("Cannot create chapter: bookId is missing", {
                url,
                chapterNumber,
                chapterData,
            });
            throw new Error("bookId is required to create chapter");
        }

        // Save to database
        const chapterRecord = {
            book_id: bookId,
            chapter_number: chapterNumber,
            chapter_title: chapterTitle,
            chapter_title_simplified: chapterTitleSimplified,
            chapter_name: chapterNameFromTitle || "",
            cool18_url: url,
            cool18_thread_id: cool18Scraper.extractThreadId(url),
            content: finalContent,
            series: series,
            status: "downloaded",
            job_id: jobId,
        };

        let chapterId;
        let wasNew = false;
        // Check for existing chapter by URL first, then by book/series/number
        let existingChapter = existing;
        // If existing chapter from URL belongs to different book, ignore it
        if (existingChapter && existingChapter.book_id !== bookId) {
            logger.warn(
                "Single chapter: Existing chapter from URL belongs to different book, ignoring",
                {
                    url,
                    existingBookId: existingChapter.book_id,
                    requestedBookId: bookId,
                    existingChapterId: existingChapter.id,
                }
            );
            existingChapter = null;
        }
        if (!existingChapter && chapterNumber !== null) {
            existingChapter = await Chapter.findByBookAndNumber(
                bookId,
                chapterNumber,
                series
            );
        }
        if (existingChapter) {
            logger.info("Single chapter: Chapter already exists, updating", {
                existingChapterId: existingChapter.id,
                existingBookId: existingChapter.book_id,
                requestedBookId: bookId,
                chapterNumber,
                series,
                url,
            });
            // Update existing chapter only if action is overwrite or not specified
            if (chapterData.action === "overwrite" || !chapterData.action) {
                await Chapter.updateByBookSeriesAndNumber(
                    bookId,
                    series,
                    chapterNumber,
                    chapterRecord
                );
                chapterId = existingChapter.id;
            } else {
                // Skip if action is discard
                emitProgress(jobId, {
                    type: "chapter-skipped",
                    url,
                    chapterNum: chapterNumber,
                    message: "Chapter skipped (discarded)",
                });
                return null;
            }
        } else {
            // Create new chapter
            try {
                logger.info("Attempting to create single chapter", {
                    bookId,
                    chapterNumber,
                    series,
                    chapterRecord: {
                        ...chapterRecord,
                        content: chapterRecord.content
                            ? `${chapterRecord.content.length} chars`
                            : "empty",
                    },
                    url,
                });
                chapterId = await Chapter.create(chapterRecord);
                wasNew = true;
                logger.info("Chapter created in database", {
                    chapterId,
                    bookId,
                    chapterNumber,
                    series,
                    chapterName: chapterRecord.chapter_name,
                    url,
                });
            } catch (createError) {
                logger.error("Error creating chapter in database", {
                    error: createError,
                    errorMessage: createError?.message,
                    errorStack: createError?.stack,
                    bookId,
                    chapterNumber,
                    series,
                    chapterRecord: {
                        ...chapterRecord,
                        content: chapterRecord.content
                            ? `${chapterRecord.content.length} chars`
                            : "empty",
                    },
                    url,
                });
                throw createError;
            }
        }

        emitProgress(jobId, {
            type: "chapter-complete",
            url,
            chapterNum: chapterNumber,
            message: `Chapter ${chapterNumber} downloaded successfully`,
        });

        // Extract bookname if not already captured
        let capturedBookName = firstChapterMetadata?.bookName || null;
        if (!capturedBookName && chapterInfo?.fullMatch) {
            const matchIndex = chapterTitleSimplified.indexOf(
                chapterInfo.fullMatch
            );
            if (matchIndex > 0) {
                const before = chapterTitleSimplified
                    .slice(0, matchIndex)
                    .trim();
                if (before) {
                    capturedBookName = before;
                }
            }
        }

        // Additional fallback: extract bookname from "bookname 第一章" pattern
        if (!capturedBookName) {
            // Pattern: (bookname) 第X章
            const booknamePattern =
                /^(.+?)\s+第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/;
            const match = chapterTitleSimplified.match(booknamePattern);
            if (match && match[1]) {
                const cleaned = match[1].trim();
                if (cleaned) {
                    capturedBookName = cleaned;
                }
            }
        }

        return {
            id: chapterId,
            ...chapterRecord,
            capturedBookName: capturedBookName,
        };
    } catch (error) {
        logger.error("Error downloading chapter", { url, error });

        // Save failed chapter to database
        try {
            const chapterRecord = {
                book_id: bookId,
                chapter_number: chapterNum,
                chapter_title_simplified: title,
                cool18_url: url,
                status: "failed",
                job_id: jobId,
            };
            await Chapter.create(chapterRecord);
        } catch (dbError) {
            logger.error("Error saving failed chapter", {
                error: dbError,
                url,
                chapterNum,
            });
        }

        emitProgress(jobId, {
            type: "chapter-error",
            url,
            chapterNum,
            message: `Error: ${error.message}`,
        });

        throw error;
    }
}

/**
 * Process download job
 * @param {number} jobId - Download job ID
 * @param {Array} chapters - Array of chapter data
 * @param {number|null} bookId - Existing book ID or null
 * @param {string} bookName - Book name in Simplified Chinese
 * @param {Object} bookMetadata - Optional book metadata (author, category, description, tags, etc.)
 */
async function processDownloadJob(
    jobId,
    chapters,
    bookId,
    bookName,
    bookMetadata = null
) {
    try {
        // Register operation with bot status service
        botStatusService.registerOperation("download", jobId, {
            bookId,
            bookName,
            totalChapters: chapters.length,
            completedChapters: 0,
            failedChapters: 0,
        });

        // Update job status
        await DownloadJob.updateStatus(jobId, "processing");

        emitProgress(jobId, {
            type: "job-start",
            message: `Starting download of ${chapters.length} chapters...`,
        });

        // Create or get book
        let finalBookId = bookId;
        if (!finalBookId) {
            // If bookName is not provided, create a dummy name from first chapter URL
            let finalBookName = bookName;
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
                          author: (bookMetadata.author || "").slice(0, 20),
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
                finalBookId = await Book.create(
                    finalBookName,
                    bookNameTraditional,
                    metadata
                );
                book = await Book.findById(finalBookId);
            } else {
                finalBookId = book.id;
                // Update book metadata if provided and book exists
                if (bookMetadata) {
                    await Book.update(finalBookId, {
                        author: (
                            bookMetadata.author ||
                            book.author ||
                            ""
                        ).slice(0, 20),
                        category: bookMetadata.category || book.category || "",
                        description:
                            bookMetadata.description || book.description || "",
                        source_url:
                            bookMetadata.sourceUrl || book.source_url || "",
                        tags: bookMetadata.tags || [],
                    });
                }
            }
        }

        if (!finalBookId) {
            throw new Error("Book ID is required");
        }

        // Track added chapters
        const addedChapters = [];

        // Download chapters concurrently
        const downloadPromises = chapters.map((chapterData) =>
            limit(async () => {
                try {
                    // Ensure we're using the correct bookId
                    const chapterDataWithBookId = {
                        ...chapterData,
                        bookId: finalBookId,
                    };
                    logger.info("Calling downloadChapter with bookId", {
                        url: chapterData.url,
                        finalBookId: finalBookId,
                        originalChapterDataBookId: chapterData.bookId,
                        chapterDataWithBookId: chapterDataWithBookId.bookId,
                    });
                    const result = await downloadChapter(
                        chapterDataWithBookId,
                        jobId
                    );
                    // Track added chapter info
                    if (result) {
                        // Handle both single chapter and array (from multi-chapter pages)
                        const chaptersToTrack = Array.isArray(result)
                            ? result
                            : [result];
                        logger.info("Processing downloadChapter result", {
                            url: chapterData.url,
                            resultType: Array.isArray(result)
                                ? "array"
                                : "single",
                            chaptersCount: chaptersToTrack.length,
                            chapters: chaptersToTrack.map((ch) => ({
                                id: ch.id,
                                chapter_number: ch.chapter_number,
                                book_id: ch.book_id,
                            })),
                        });
                        for (const ch of chaptersToTrack) {
                            if (
                                ch &&
                                ch.chapter_number !== null &&
                                ch.chapter_number !== undefined
                            ) {
                                if (!ch.id) {
                                    logger.warn(
                                        "Chapter tracked but has no ID",
                                        {
                                            chapter_number: ch.chapter_number,
                                            book_id: ch.book_id,
                                            url: chapterData.url,
                                        }
                                    );
                                }
                                addedChapters.push({
                                    chapter_number: ch.chapter_number,
                                    chapter_title:
                                        ch.chapter_title ||
                                        ch.chapter_title_simplified ||
                                        "",
                                    chapter_name: ch.chapter_name || "",
                                    captured_book_name:
                                        ch.capturedBookName || null,
                                    action: chapterData.action || "new",
                                    original_number:
                                        chapterData.originalNumber || null,
                                });
                            } else {
                                logger.warn(
                                    "Chapter result skipped from tracking",
                                    {
                                        ch: ch
                                            ? {
                                                  id: ch.id,
                                                  chapter_number:
                                                      ch.chapter_number,
                                                  book_id: ch.book_id,
                                              }
                                            : null,
                                        url: chapterData.url,
                                    }
                                );
                            }
                        }
                    } else {
                        logger.warn("downloadChapter returned null/undefined", {
                            url: chapterData.url,
                            bookId: finalBookId,
                        });
                    }
                    return result;
                } catch (error) {
                    throw error;
                }
            })
        );

        const results = await Promise.allSettled(downloadPromises);

        // Count successes and failures
        let completed = 0;
        let failed = 0;

        results.forEach((result, index) => {
            if (result.status === "fulfilled") {
                completed++;
            } else {
                failed++;
            }
        });

        // Update job progress
        await DownloadJob.updateProgress(jobId, completed, failed);

        // Update bot status with added chapters info
        botStatusService.updateOperation("download", jobId, {
            completedChapters: completed,
            failedChapters: failed,
            addedChapters: addedChapters,
        });

        // Update book total chapters
        const allChapters = await Chapter.findByBookId(finalBookId);
        const addedChapterNumbers = addedChapters
            .map((ch) => ch.chapter_number)
            .sort((a, b) => a - b);
        const dbChapterNumbers = allChapters
            .map((ch) => ch.chapter_number)
            .sort((a, b) => a - b);
        const missingChapters = addedChapterNumbers.filter(
            (num) => !dbChapterNumbers.includes(num)
        );

        logger.info("Chapters found for book", {
            bookId: finalBookId,
            totalChapters: allChapters.length,
            chapterNumbers: dbChapterNumbers,
            addedInThisJob: addedChapters.length,
            addedChapterNumbers: addedChapterNumbers,
            missingChapters: missingChapters,
            allChaptersDetails: allChapters.map((ch) => ({
                id: ch.id,
                chapter_number: ch.chapter_number,
                series: ch.series,
                status: ch.status,
            })),
        });

        if (missingChapters.length > 0) {
            logger.error("Chapters were tracked but not found in database", {
                bookId: finalBookId,
                missingChapters: missingChapters,
                addedChapters: addedChapters.filter((ch) =>
                    missingChapters.includes(ch.chapter_number)
                ),
            });
        }

        await Book.update(finalBookId, { total_chapters: allChapters.length });
        logger.info("Book chapters updated", {
            bookId: finalBookId,
            totalChapters: allChapters.length,
            addedInThisJob: addedChapters.length,
        });

        // Extract and save tags
        if (bookName) {
            const tags = tagExtractor.extractTags(bookName, "");
            if (tags.length > 0) {
                await BookTag.addMultiple(finalBookId, tags);
            }
        }

        // Store added chapters info in job results
        const jobResults = {
            addedChapters: addedChapters,
            totalAdded: addedChapters.length,
            completed: completed,
            failed: failed,
        };

        // Mark job as completed
        await DownloadJob.updateStatus(jobId, "completed");

        // Update bot status
        botStatusService.updateOperation("download", jobId, {
            status: "completed",
            completedChapters: completed,
            failedChapters: failed,
            addedChapters: addedChapters,
        });

        // Build summary message
        const newChapters = addedChapters.filter(
            (ch) => ch.action === "new" || !ch.action
        ).length;
        const overwrittenChapters = addedChapters.filter(
            (ch) => ch.action === "overwrite"
        ).length;
        const renumberedChapters = addedChapters.filter(
            (ch) => ch.action === "new_number"
        ).length;

        let summaryMessage = `下載完成: ${completed} 成功, ${failed} 失敗。`;
        if (addedChapters.length > 0) {
            summaryMessage += ` 新增 ${newChapters} 個章節`;
            if (overwrittenChapters > 0) {
                summaryMessage += `, 覆蓋 ${overwrittenChapters} 個章節`;
            }
            if (renumberedChapters > 0) {
                summaryMessage += `, 重新編號 ${renumberedChapters} 個章節`;
            }
            summaryMessage += "。";
        }

        // Log captured metadata for review
        if (addedChapters.length > 0) {
            logger.info("Download job finished - captured metadata", {
                jobId,
                bookId: finalBookId,
                bookName: bookName || finalBookName,
                totalChapters: addedChapters.length,
                completed,
                failed,
                capturedChapters: addedChapters.map((ch) => ({
                    chapter_number: ch.chapter_number,
                    chapter_title: ch.chapter_title,
                    chapter_name: ch.chapter_name,
                    captured_book_name: ch.captured_book_name,
                    action: ch.action,
                })),
            });
        }

        emitProgress(jobId, {
            type: "job-complete",
            message: summaryMessage,
            completed,
            failed,
            addedChapters: addedChapters,
        });

        return {
            bookId: finalBookId,
            completed,
            failed,
            total: chapters.length,
            addedChapters: addedChapters,
            totalAdded: addedChapters.length,
        };
    } catch (error) {
        logger.error("Error processing download job", {
            jobId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        await DownloadJob.updateStatus(jobId, "failed");

        // Update bot status
        botStatusService.updateOperation("download", jobId, {
            status: "failed",
            error: error.message,
        });

        emitProgress(jobId, {
            type: "job-error",
            message: `Error: ${error.message}`,
        });

        throw error;
    }
}

/**
 * Register progress callback for SSE
 * @param {number} jobId - Download job ID
 * @param {Function} callback - Callback function
 */
function registerProgressCallback(jobId, callback) {
    progressCallbacks.set(jobId, callback);
}

/**
 * Unregister progress callback
 * @param {number} jobId - Download job ID
 */
function unregisterProgressCallback(jobId) {
    progressCallbacks.delete(jobId);
}

/**
 * Emit progress update
 * @param {number} jobId - Download job ID
 * @param {Object} data - Progress data
 */
function emitProgress(jobId, data) {
    const callback = progressCallbacks.get(jobId);
    if (callback) {
        try {
            callback(data);
        } catch (error) {
            logger.error("Error emitting progress", { jobId, error });
        }
    }
}

module.exports = {
    processDownloadJob,
    registerProgressCallback,
    unregisterProgressCallback,
    downloadChapter,
};
