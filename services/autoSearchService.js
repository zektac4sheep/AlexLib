/**
 * Auto Search Service
 * Automatically searches for new chapters when bot is idle for more than 10 minutes
 * for books that have auto_search enabled and last search was more than 1 day ago
 */

const Book = require('../models/book');
const BookSearchJob = require('../models/bookSearchJob');
const botStatusService = require('./botStatusService');
const logger = require('../utils/logger');

let checkInterval = null;
let isEnabled = false; // Default: disabled
const IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const SEARCH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Start the auto search service
 * Checks every minute if bot is idle and triggers auto searches
 */
function startAutoSearchService() {
    if (checkInterval) {
        return; // Already running
    }

    isEnabled = true;

    // Check every minute
    checkInterval = setInterval(() => {
        if (isEnabled) {
            checkAndTriggerAutoSearches().catch(err => {
                logger.error('Error in auto search service', { error: err });
            });
        }
    }, 60 * 1000); // 1 minute

    logger.info('Auto search service started');
}

/**
 * Stop the auto search service
 */
function stopAutoSearchService() {
    isEnabled = false;
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
        logger.info('Auto search service stopped');
    }
}

/**
 * Check if bot is idle and trigger auto searches for eligible books
 */
async function checkAndTriggerAutoSearches() {
    // Check if service is enabled
    if (!isEnabled) {
        return; // Service is disabled
    }

    // Check if bot is active
    if (botStatusService.isBotActive()) {
        return; // Bot is busy, skip
    }

    // Check if bot has been idle for more than 10 minutes
    const idleDuration = botStatusService.getIdleDuration();
    if (idleDuration < IDLE_THRESHOLD_MS) {
        return; // Not idle long enough
    }

    try {
        // Find books with auto_search enabled
        const allBooks = await Book.findAll();
        const autoSearchBooks = allBooks.filter(book => book.auto_search === 1);

        if (autoSearchBooks.length === 0) {
            return; // No books with auto search enabled
        }

        // Check each book's last_search_datetime
        const now = new Date();
        const eligibleBooks = [];

        for (const book of autoSearchBooks) {
            // Check if last search was more than 1 day ago (or never searched)
            if (!book.last_search_datetime) {
                // Never searched, eligible
                eligibleBooks.push(book);
            } else {
                const lastSearchTime = new Date(book.last_search_datetime);
                const timeSinceLastSearch = now - lastSearchTime;
                
                if (timeSinceLastSearch >= SEARCH_INTERVAL_MS) {
                    eligibleBooks.push(book);
                }
            }
        }

        if (eligibleBooks.length === 0) {
            return; // No eligible books
        }

        // Check if there are already queued or processing search jobs for these books
        // to avoid creating duplicate jobs
        const existingJobs = await BookSearchJob.findAllByStatus('queued', 100);
        const processingJobs = await BookSearchJob.findAllByStatus('processing', 100);
        const allActiveJobs = [...existingJobs, ...processingJobs];
        const booksWithActiveJobs = new Set(allActiveJobs.map(job => job.book_id));

        // Create search jobs for eligible books that don't have active jobs
        let jobsCreated = 0;
        for (const book of eligibleBooks) {
            if (booksWithActiveJobs.has(book.id)) {
                continue; // Skip if there's already an active job for this book
            }

            try {
                // Create a 'new' search job (search for new chapters)
                await BookSearchJob.create(
                    book.id,
                    'new',
                    {
                        bookName: book.book_name_simplified,
                        pages: 3 // Default to 3 pages for auto searches
                    },
                    true // Mark as auto_job
                );

                jobsCreated++;
                logger.info('Auto search job created', {
                    bookId: book.id,
                    bookName: book.book_name_simplified
                });
            } catch (error) {
                logger.error('Error creating auto search job', {
                    bookId: book.id,
                    error: error.message
                });
            }
        }

        if (jobsCreated > 0) {
            logger.info('Auto search jobs created', {
                count: jobsCreated,
                idleDurationMinutes: Math.round(idleDuration / 60000)
            });
        }
    } catch (error) {
        logger.error('Error in checkAndTriggerAutoSearches', {
            error: error.message,
            stack: error.stack
        });
    }
}

/**
 * Get enabled state
 */
function getEnabled() {
    return isEnabled;
}

/**
 * Set enabled state
 */
function setEnabled(enabled) {
    isEnabled = enabled;
    if (enabled && !checkInterval) {
        startAutoSearchService();
    } else if (!enabled && checkInterval) {
        stopAutoSearchService();
    }
}

module.exports = {
    startAutoSearchService,
    stopAutoSearchService,
    checkAndTriggerAutoSearches,
    getEnabled,
    setEnabled
};

