/**
 * Job Resumption Service
 * Handles resuming interrupted jobs after server restart/crash
 */

const BookSearchJob = require('../models/bookSearchJob');
const DownloadJob = require('../models/download');
const ChunkJob = require('../models/chunkJob');
const JoplinJob = require('../models/joplinJob');
const UploadJob = require('../models/uploadJob');
const logger = require('../utils/logger');

/**
 * Resume all interrupted jobs (status = 'processing')
 * Called on server startup
 */
async function resumeInterruptedJobs() {
    logger.info('Checking for interrupted jobs to resume...');

    try {
        // Resume BookSearchJobs
        await resumeBookSearchJobs();

        // Resume DownloadJobs
        await resumeDownloadJobs();

        // Resume ChunkJobs
        await resumeChunkJobs();

        // Resume JoplinJobs
        await resumeJoplinJobs();

        // Resume UploadJobs
        await resumeUploadJobs();

        logger.info('Job resumption check completed');
    } catch (error) {
        logger.error('Error during job resumption', { error });
    }
}

/**
 * Resume interrupted BookSearchJobs
 * Book search jobs can be safely restarted from scratch
 */
async function resumeBookSearchJobs() {
    try {
        const interruptedJobs = await BookSearchJob.findAllByStatus('processing', 100);
        
        if (interruptedJobs.length === 0) {
            return;
        }

        logger.info(`Found ${interruptedJobs.length} interrupted book search job(s)`);

        for (const job of interruptedJobs) {
            try {
                // Reset to queued so the queue processor can pick it up
                await BookSearchJob.update(job.id, {
                    status: 'queued',
                    started_at: null
                });
                logger.info(`Reset book search job ${job.id} to queued status`);
            } catch (error) {
                logger.error(`Error resuming book search job ${job.id}`, { error });
            }
        }
    } catch (error) {
        logger.error('Error resuming book search jobs', { error });
    }
}

/**
 * Resume interrupted DownloadJobs
 * Download jobs can resume by checking which chapters are already downloaded
 */
async function resumeDownloadJobs() {
    try {
        const interruptedJobs = await DownloadJob.findAllByStatus('processing', 100);
        
        if (interruptedJobs.length === 0) {
            return;
        }

        logger.info(`Found ${interruptedJobs.length} interrupted download job(s)`);

        const downloadService = require('./downloadService');
        const Chapter = require('../models/chapter');
        const Book = require('../models/book');

        for (const job of interruptedJobs) {
            try {
                if (!job.chapters_data || !Array.isArray(job.chapters_data)) {
                    // No chapter data, mark as failed
                    await DownloadJob.updateStatus(job.id, 'failed');
                    logger.warn(`Download job ${job.id} has no chapter data, marking as failed`);
                    continue;
                }

                // Get book info
                const book = job.book_id ? await Book.findById(job.book_id) : null;
                const bookName = book ? (book.book_name_simplified || book.book_name_traditional) : null;

                // Check which chapters are already downloaded
                const existingChapters = job.book_id 
                    ? await Chapter.findByBookId(job.book_id)
                    : [];
                const downloadedUrls = new Set(
                    existingChapters
                        .filter(ch => ch.status === 'downloaded' && ch.cool18_url)
                        .map(ch => ch.cool18_url)
                );

                // Filter out already downloaded chapters
                const remainingChapters = job.chapters_data.filter(
                    ch => !downloadedUrls.has(ch.url)
                );

                if (remainingChapters.length === 0) {
                    // All chapters already downloaded, mark as completed
                    await DownloadJob.updateStatus(job.id, 'completed');
                    await DownloadJob.updateProgress(job.id, job.total_chapters, 0);
                    logger.info(`Download job ${job.id} already completed, marking as completed`);
                    continue;
                }

                // Update job with remaining chapters
                const { getDatabase } = require('../models/database');
                const db = getDatabase();
                await new Promise((resolve, reject) => {
                    db.run(
                        'UPDATE download_jobs SET chapters_data = ?, total_chapters = ? WHERE id = ?',
                        [JSON.stringify(remainingChapters), remainingChapters.length, job.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                // Reset to queued and resume processing
                await DownloadJob.updateStatus(job.id, 'queued');
                
                // Resume processing
                const routesDownload = require('../routes/download');
                if (routesDownload.processDownloadJobAsync) {
                    routesDownload.processDownloadJobAsync(
                        job.id,
                        remainingChapters,
                        job.book_id,
                        bookName,
                        null
                    ).catch((error) => {
                        logger.error(`Error resuming download job ${job.id}`, { error });
                    });
                } else {
                    logger.error(`processDownloadJobAsync not exported from routes/download`);
                }

                logger.info(`Resumed download job ${job.id} with ${remainingChapters.length} remaining chapters`);
            } catch (error) {
                logger.error(`Error resuming download job ${job.id}`, { error });
                // Mark as failed if we can't resume
                await DownloadJob.updateStatus(job.id, 'failed').catch(() => {});
            }
        }
    } catch (error) {
        logger.error('Error resuming download jobs', { error });
    }
}

/**
 * Resume interrupted ChunkJobs
 * Chunk jobs can be safely restarted from scratch
 */
async function resumeChunkJobs() {
    try {
        const interruptedJobs = await ChunkJob.findAllByStatus('processing');
        
        if (interruptedJobs.length === 0) {
            return;
        }

        logger.info(`Found ${interruptedJobs.length} interrupted chunk job(s)`);

        for (const job of interruptedJobs) {
            try {
                // Reset to queued
                await ChunkJob.update(job.id, {
                    status: 'queued',
                    started_at: null
                });

                // Resume processing
                const routesChunks = require('../routes/chunks');
                if (routesChunks.processChunkJob) {
                    routesChunks.processChunkJob(job.id, job.book_id, job.chunk_size).catch((error) => {
                        logger.error(`Error resuming chunk job ${job.id}`, { error });
                    });
                } else {
                    logger.error(`processChunkJob not exported from routes/chunks`);
                }

                logger.info(`Resumed chunk job ${job.id}`);
            } catch (error) {
                logger.error(`Error resuming chunk job ${job.id}`, { error });
            }
        }
    } catch (error) {
        logger.error('Error resuming chunk jobs', { error });
    }
}

/**
 * Resume interrupted JoplinJobs
 * Joplin jobs can resume based on progress_data
 */
async function resumeJoplinJobs() {
    try {
        const interruptedJobs = await JoplinJob.findByStatus('processing');
        
        if (interruptedJobs.length === 0) {
            return;
        }

        logger.info(`Found ${interruptedJobs.length} interrupted Joplin job(s)`);

        const joplinService = require('./joplinService');

        for (const job of interruptedJobs) {
            try {
                // For Joplin jobs, we'll reset to queued and let them restart
                // The job processors can check progress_data if needed
                await JoplinJob.update(job.id, {
                    status: 'queued',
                    started_at: null
                });

                // Resume based on job type
                const options = {
                    apiUrl: job.api_url,
                    apiToken: job.api_token
                };

                if (job.job_type === 'sync_structure') {
                    joplinService.processSyncStructureJob(job.id, job.api_url, job.api_token)
                        .catch((error) => {
                            logger.error(`Error resuming Joplin sync structure job ${job.id}`, { error });
                        });
                } else if (job.job_type === 'sync_books') {
                    joplinService.processSyncBooksJob(job.id, job.api_url, job.api_token)
                        .catch((error) => {
                            logger.error(`Error resuming Joplin sync books job ${job.id}`, { error });
                        });
                } else if (job.job_type === 'recreate_book_folder') {
                    const configData = job.config_data || {};
                    const bookId = configData.bookId;
                    if (bookId) {
                        joplinService.processRecreateBookFolderJob(job.id, job.api_url, job.api_token, bookId)
                            .catch((error) => {
                                logger.error(`Error resuming Joplin recreate folder job ${job.id}`, { error });
                            });
                    }
                }

                logger.info(`Resumed Joplin job ${job.id} (type: ${job.job_type})`);
            } catch (error) {
                logger.error(`Error resuming Joplin job ${job.id}`, { error });
            }
        }
    } catch (error) {
        logger.error('Error resuming Joplin jobs', { error });
    }
}

/**
 * Resume interrupted UploadJobs
 * Upload jobs can be safely restarted from scratch
 */
async function resumeUploadJobs() {
    try {
        const interruptedJobs = await UploadJob.findAllByStatus('processing', 100);
        
        if (interruptedJobs.length === 0) {
            return;
        }

        logger.info(`Found ${interruptedJobs.length} interrupted upload job(s)`);

        for (const job of interruptedJobs) {
            try {
                // Check if the file still exists
                const fs = require('fs');
                const path = require('path');

                if (!job.file_path || !fs.existsSync(job.file_path)) {
                    // File doesn't exist, mark as failed
                    await UploadJob.update(job.id, {
                        status: 'failed',
                        error_message: 'File no longer exists after server restart',
                        completed_at: new Date().toISOString()
                    });
                    logger.warn(`Upload job ${job.id} file not found, marking as failed`);
                    continue;
                }

                // File exists, determine appropriate status
                // If job has book_metadata, it was confirmed and should be queued for processing
                // Otherwise, it should go back to waiting_for_input
                const newStatus = job.book_metadata ? 'queued' : 'waiting_for_input';
                
                await UploadJob.update(job.id, {
                    status: newStatus,
                    started_at: null
                });
                logger.info(`Reset upload job ${job.id} to ${newStatus} status`);
            } catch (error) {
                logger.error(`Error resuming upload job ${job.id}`, { error });
            }
        }
    } catch (error) {
        logger.error('Error resuming upload jobs', { error });
    }
}

module.exports = {
    resumeInterruptedJobs,
    resumeBookSearchJobs,
    resumeDownloadJobs,
    resumeChunkJobs,
    resumeJoplinJobs,
    resumeUploadJobs
};

