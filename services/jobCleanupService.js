/**
 * Job Cleanup Service
 * Automatically removes job records older than 14 days
 */

const BookSearchJob = require('../models/bookSearchJob');
const DownloadJob = require('../models/download');
const ChunkJob = require('../models/chunkJob');
const JoplinJob = require('../models/joplinJob');
const UploadJob = require('../models/uploadJob');
const { getDatabase } = require('../models/database');
const logger = require('../utils/logger');

const DAYS_TO_KEEP = 14;

/**
 * Delete jobs older than the specified number of days
 * @param {number} daysOld - Number of days to keep jobs (default: 14)
 * @returns {Promise<Object>} Summary of deleted jobs
 */
async function cleanupOldJobs(daysOld = DAYS_TO_KEEP) {
    const db = getDatabase();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffDateStr = cutoffDate.toISOString().replace('T', ' ').substring(0, 19);

    const summary = {
        bookSearchJobs: 0,
        downloadJobs: 0,
        chunkJobs: 0,
        joplinJobs: 0,
        uploadJobs: 0,
        total: 0,
        errors: []
    };

    try {
        logger.info(`Starting job cleanup for jobs older than ${daysOld} days (before ${cutoffDateStr})`);

        // Cleanup BookSearchJobs
        try {
            const bookSearchDeleted = await deleteOldJobsFromTable(
                'book_search_jobs',
                cutoffDateStr
            );
            summary.bookSearchJobs = bookSearchDeleted;
            summary.total += bookSearchDeleted;
            logger.info(`Deleted ${bookSearchDeleted} old book search jobs`);
        } catch (err) {
            logger.error('Error cleaning up book search jobs', { error: err });
            summary.errors.push({ type: 'book_search', error: err.message });
        }

        // Cleanup DownloadJobs
        try {
            const downloadDeleted = await deleteOldJobsFromTable(
                'download_jobs',
                cutoffDateStr
            );
            summary.downloadJobs = downloadDeleted;
            summary.total += downloadDeleted;
            logger.info(`Deleted ${downloadDeleted} old download jobs`);
        } catch (err) {
            logger.error('Error cleaning up download jobs', { error: err });
            summary.errors.push({ type: 'download', error: err.message });
        }

        // Cleanup ChunkJobs
        try {
            const chunkDeleted = await deleteOldJobsFromTable(
                'chunk_jobs',
                cutoffDateStr
            );
            summary.chunkJobs = chunkDeleted;
            summary.total += chunkDeleted;
            logger.info(`Deleted ${chunkDeleted} old chunk jobs`);
        } catch (err) {
            logger.error('Error cleaning up chunk jobs', { error: err });
            summary.errors.push({ type: 'chunk', error: err.message });
        }

        // Cleanup JoplinJobs
        try {
            const joplinDeleted = await deleteOldJobsFromTable(
                'joplin_jobs',
                cutoffDateStr
            );
            summary.joplinJobs = joplinDeleted;
            summary.total += joplinDeleted;
            logger.info(`Deleted ${joplinDeleted} old joplin jobs`);
        } catch (err) {
            logger.error('Error cleaning up joplin jobs', { error: err });
            summary.errors.push({ type: 'joplin', error: err.message });
        }

        // Cleanup UploadJobs
        try {
            const uploadDeleted = await deleteOldJobsFromTable(
                'upload_jobs',
                cutoffDateStr
            );
            summary.uploadJobs = uploadDeleted;
            summary.total += uploadDeleted;
            logger.info(`Deleted ${uploadDeleted} old upload jobs`);
        } catch (err) {
            logger.error('Error cleaning up upload jobs', { error: err });
            summary.errors.push({ type: 'upload', error: err.message });
        }

        logger.info(`Job cleanup completed. Total deleted: ${summary.total}`, summary);
        return summary;
    } catch (error) {
        logger.error('Error during job cleanup', { error });
        throw error;
    }
}

/**
 * Delete jobs from a specific table that are older than the cutoff date
 * @param {string} tableName - Name of the table
 * @param {string} cutoffDateStr - Cutoff date in SQLite datetime format
 * @returns {Promise<number>} Number of deleted rows
 */
function deleteOldJobsFromTable(tableName, cutoffDateStr) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM ${tableName} WHERE created_at < ?`;
        db.run(sql, [cutoffDateStr], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
}

/**
 * Start the scheduled cleanup task
 * Runs cleanup daily at the specified hour
 * @param {number} intervalHours - Hours between cleanup runs (default: 24)
 */
function startScheduledCleanup(intervalHours = 24) {
    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Run cleanup immediately on startup (optional)
    cleanupOldJobs().catch(err => {
        logger.error('Error in initial job cleanup', { error: err });
    });

    // Schedule periodic cleanup
    const intervalId = setInterval(() => {
        cleanupOldJobs().catch(err => {
            logger.error('Error in scheduled job cleanup', { error: err });
        });
    }, intervalMs);

    logger.info(`Scheduled job cleanup started. Will run every ${intervalHours} hours.`);

    return intervalId;
}

module.exports = {
    cleanupOldJobs,
    startScheduledCleanup,
    deleteOldJobsFromTable
};

