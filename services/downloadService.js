/**
 * Download Service
 * Orchestrates concurrent downloads, text processing, and database storage
 */

const pLimit = require('p-limit').default || require('p-limit');
const cool18Scraper = require('./cool18Scraper');
const textProcessor = require('./textProcessor');
const chapterExtractor = require('./chapterExtractor');
const converter = require('./converter');
const Book = require('../models/book');
const Chapter = require('../models/chapter');
const DownloadJob = require('../models/download');
const BookTag = require('../models/bookTag');
const tagExtractor = require('./tagExtractor');
const botStatusService = require('./botStatusService');
const logger = require('../utils/logger');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '6');
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
    if (existing && existing.status === 'downloaded') {
      emitProgress(jobId, {
        type: 'chapter-skipped',
        url,
        chapterNum,
        message: 'Chapter already downloaded'
      });
      return existing;
    }

    emitProgress(jobId, {
      type: 'chapter-start',
      url,
      chapterNum,
      message: `Downloading chapter ${chapterNum}...`
    });

    // Download thread content
    const threadData = await cool18Scraper.downloadThread(url);

    // Extract chapter info
    const chapterInfo = chapterExtractor.extractChapterNumber(threadData.title);
    const chapterNumber = chapterNum || (chapterInfo ? chapterInfo.number : null);
    const chapterTitleSimplified = threadData.title;
    const chapterTitle = converter.toTraditional(chapterTitleSimplified);

    // Process content
    const rawContent = threadData.content;
    const processedContent = textProcessor.formatContent(rawContent, true);
    const finalContent = textProcessor.processChapterContent(processedContent, chapterTitle);

    // Save to database
    const chapterRecord = {
      book_id: bookId,
      chapter_number: chapterNumber,
      chapter_title: chapterTitle,
      chapter_title_simplified: chapterTitleSimplified,
      cool18_url: url,
      cool18_thread_id: cool18Scraper.extractThreadId(url),
      content: finalContent,
      status: 'downloaded'
    };

    let chapterId;
    if (existing) {
      // Update existing chapter
      await Chapter.updateByBookAndNumber(bookId, chapterNumber, chapterRecord);
      chapterId = existing.id;
    } else {
      // Create new chapter
      chapterId = await Chapter.create(chapterRecord);
    }

    emitProgress(jobId, {
      type: 'chapter-complete',
      url,
      chapterNum: chapterNumber,
      message: `Chapter ${chapterNumber} downloaded successfully`
    });

    return {
      id: chapterId,
      ...chapterRecord
    };
  } catch (error) {
    logger.error('Error downloading chapter', { url, error });

    // Save failed chapter to database
    try {
      const chapterRecord = {
        book_id: bookId,
        chapter_number: chapterNum,
        chapter_title_simplified: title,
        cool18_url: url,
        status: 'failed'
      };
      await Chapter.create(chapterRecord);
    } catch (dbError) {
      logger.error('Error saving failed chapter', { error: dbError, url, chapterNum });
    }

    emitProgress(jobId, {
      type: 'chapter-error',
      url,
      chapterNum,
      message: `Error: ${error.message}`
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
async function processDownloadJob(jobId, chapters, bookId, bookName, bookMetadata = null) {
  try {
    // Register operation with bot status service
    botStatusService.registerOperation('download', jobId, {
      bookId,
      bookName,
      totalChapters: chapters.length,
      completedChapters: 0,
      failedChapters: 0
    });

    // Update job status
    await DownloadJob.updateStatus(jobId, 'processing');

    emitProgress(jobId, {
      type: 'job-start',
      message: `Starting download of ${chapters.length} chapters...`
    });

    // Create or get book
    let finalBookId = bookId;
    if (!finalBookId && bookName) {
      // Check if book exists
      let book = await Book.findBySimplifiedName(bookName);
      if (!book) {
        // Create new book with metadata
        const bookNameTraditional = bookMetadata?.bookNameTraditional || converter.toTraditional(bookName);
        const metadata = bookMetadata ? {
          author: bookMetadata.author,
          category: bookMetadata.category,
          description: bookMetadata.description,
          sourceUrl: bookMetadata.sourceUrl,
          tags: bookMetadata.tags || []
        } : {};
        finalBookId = await Book.create(bookName, bookNameTraditional, metadata);
        book = await Book.findById(finalBookId);
      } else {
        finalBookId = book.id;
        // Update book metadata if provided and book exists
        if (bookMetadata) {
          await Book.update(finalBookId, {
            author: bookMetadata.author,
            category: bookMetadata.category,
            description: bookMetadata.description,
            source_url: bookMetadata.sourceUrl,
            tags: bookMetadata.tags || []
          });
        }
      }
    }

    if (!finalBookId) {
      throw new Error('Book ID is required');
    }

    // Download chapters concurrently
    const downloadPromises = chapters.map(chapterData =>
      limit(() => downloadChapter({ ...chapterData, bookId: finalBookId }, jobId))
    );

    const results = await Promise.allSettled(downloadPromises);

    // Count successes and failures
    let completed = 0;
    let failed = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        completed++;
      } else {
        failed++;
      }
    });

    // Update job progress
    await DownloadJob.updateProgress(jobId, completed, failed);

    // Update bot status
    botStatusService.updateOperation('download', jobId, {
      completedChapters: completed,
      failedChapters: failed
    });

    // Update book total chapters
    const allChapters = await Chapter.findByBookId(finalBookId);
    await Book.update(finalBookId, { total_chapters: allChapters.length });

    // Extract and save tags
    if (bookName) {
      const tags = tagExtractor.extractTags(bookName, '');
      if (tags.length > 0) {
        await BookTag.addMultiple(finalBookId, tags);
      }
    }

    // Mark job as completed
    await DownloadJob.updateStatus(jobId, 'completed');

    // Update bot status
    botStatusService.updateOperation('download', jobId, {
      status: 'completed',
      completedChapters: completed,
      failedChapters: failed
    });

    emitProgress(jobId, {
      type: 'job-complete',
      message: `Download completed: ${completed} successful, ${failed} failed`,
      completed,
      failed
    });

    return {
      bookId: finalBookId,
      completed,
      failed,
      total: chapters.length
    };
  } catch (error) {
    logger.error('Error processing download job', { jobId, error });
    await DownloadJob.updateStatus(jobId, 'failed');

    // Update bot status
    botStatusService.updateOperation('download', jobId, {
      status: 'failed',
      error: error.message
    });

    emitProgress(jobId, {
      type: 'job-error',
      message: `Error: ${error.message}`
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
      logger.error('Error emitting progress', { jobId, error });
    }
  }
}

module.exports = {
  processDownloadJob,
  registerProgressCallback,
  unregisterProgressCallback,
  downloadChapter
};

