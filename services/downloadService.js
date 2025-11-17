/**
 * Download Service
 * Orchestrates concurrent downloads, text processing, and database storage
 */

const pLimit = require("p-limit").default || require("p-limit");
const cool18Scraper = require("./cool18Scraper");
const textProcessor = require("./textProcessor");
const chapterExtractor = require("./chapterExtractor");
const converter = require("./converter");
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

    try {
        // Check if chapter already exists
        const existing = await Chapter.findByUrl(url);
        if (existing && existing.status === "downloaded") {
            emitProgress(jobId, {
                type: "chapter-skipped",
                url,
                chapterNum,
                message: "Chapter already downloaded",
            });
            return existing;
        }

        emitProgress(jobId, {
            type: "chapter-start",
            url,
            chapterNum,
            message: `Downloading chapter ${chapterNum}...`,
        });

        // Download thread content
        const threadData = await cool18Scraper.downloadThread(url);

        // Extract chapter info
        const chapterInfo = chapterExtractor.extractChapterNumber(
            threadData.title
        );
        const chapterNumber =
            chapterNum || (chapterInfo ? chapterInfo.number : null);
        const series = chapterInfo?.series || "official";
        const chapterTitleSimplified = threadData.title;
        const chapterTitle = converter.toTraditional(chapterTitleSimplified);

        // Process content using new formatting rules
        const rawContent = threadData.content;
        
        // Check if content contains multiple chapters
        const fileAnalyzer = require("./fileAnalyzer");
        const detectedChapters = fileAnalyzer.detectChapters(rawContent);
        
        // If multiple chapters detected, split and save each separately
        if (detectedChapters && detectedChapters.length > 1) {
            const savedChapters = [];
            for (const detectedChapter of detectedChapters) {
                const detectedChapterNumber = detectedChapter.number;
                const detectedChapterTitle = detectedChapter.title || `第${detectedChapterNumber}章`;
                const detectedChapterName = detectedChapter.name || "";
                
                // Format each chapter content using reformatChapterContent (same as check_reformat.js)
                const chapterContent = textProcessor.reformatChapterContent(
                    detectedChapter.content,
                    detectedChapterTitle,
                    true, // Convert to Traditional Chinese
                    true // Enable detailed logging
                );

                const detectedSeries = detectedChapter.series || "official";
                const chapterRecord = {
                    book_id: bookId,
                    chapter_number: detectedChapterNumber,
                    chapter_title: converter.toTraditional(detectedChapterTitle),
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
                    // Update existing chapter only if action is overwrite or not specified
                    if (chapterData.action === "overwrite" || !chapterData.action) {
                        await Chapter.updateByBookSeriesAndNumber(
                            bookId,
                            detectedSeries,
                            detectedChapterNumber,
                            chapterRecord
                        );
                        chapterId = existingChapter.id;
                    } else {
                        // Skip if action is discard
                        continue;
                    }
                } else {
                    // Create new chapter
                    chapterId = await Chapter.create(chapterRecord);
                    wasNew = true;
                }

                savedChapters.push({
                    id: chapterId,
                    ...chapterRecord,
                });

                emitProgress(jobId, {
                    type: "chapter-complete",
                    url,
                    chapterNum: detectedChapterNumber,
                    message: `Chapter ${detectedChapterNumber} downloaded and split successfully`,
                });
            }

            return savedChapters[0]; // Return first chapter for backward compatibility
        }

        // Single chapter - process normally using reformatChapterContent (same as check_reformat.js)
        const finalContent = textProcessor.reformatChapterContent(
            rawContent,
            chapterTitle,
            true, // Convert to Traditional Chinese
            true // Enable detailed logging
        );

        // Save to database
        const chapterRecord = {
            book_id: bookId,
            chapter_number: chapterNumber,
            chapter_title: chapterTitle,
            chapter_title_simplified: chapterTitleSimplified,
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
        if (!existingChapter && chapterNumber !== null) {
            existingChapter = await Chapter.findByBookAndNumber(
                bookId,
                chapterNumber,
                series
            );
        }
        if (existingChapter) {
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
            chapterId = await Chapter.create(chapterRecord);
            wasNew = true;
        }

        emitProgress(jobId, {
            type: "chapter-complete",
            url,
            chapterNum: chapterNumber,
            message: `Chapter ${chapterNumber} downloaded successfully`,
        });

        return {
            id: chapterId,
            ...chapterRecord,
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
                        author: (bookMetadata.author || book.author || "").slice(0, 20),
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
                    const result = await downloadChapter({ ...chapterData, bookId: finalBookId }, jobId);
                    // Track added chapter info
                    if (result) {
                        // Handle both single chapter and array (from multi-chapter pages)
                        const chaptersToTrack = Array.isArray(result) ? result : [result];
                        for (const ch of chaptersToTrack) {
                            if (ch && ch.chapter_number !== null && ch.chapter_number !== undefined) {
                                addedChapters.push({
                                    chapter_number: ch.chapter_number,
                                    chapter_title: ch.chapter_title || ch.chapter_title_simplified || "",
                                    chapter_name: ch.chapter_name || "",
                                    action: chapterData.action || "new",
                                    original_number: chapterData.originalNumber || null,
                                });
                            }
                        }
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
        await Book.update(finalBookId, { total_chapters: allChapters.length });

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
        const newChapters = addedChapters.filter(ch => ch.action === "new" || !ch.action).length;
        const overwrittenChapters = addedChapters.filter(ch => ch.action === "overwrite").length;
        const renumberedChapters = addedChapters.filter(ch => ch.action === "new_number").length;
        
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
