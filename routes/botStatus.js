const express = require('express');
const router = express.Router();
const botStatusService = require('../services/botStatusService');
const DownloadJob = require('../models/download');
const logger = require('../utils/logger');

/**
 * Get all active operations
 */
router.get('/operations', async (req, res) => {
    try {
        const operations = botStatusService.getActiveOperations();

        // Enrich download operations with database data
        const enrichedOperations = await Promise.all(
            operations.map(async (op) => {
                if (op.type === 'download' && op.id) {
                    try {
                        const job = await DownloadJob.findById(op.id);
                        if (job) {
                            return {
                                ...op,
                                totalChapters: job.total_chapters,
                                completedChapters: job.completed_chapters,
                                failedChapters: job.failed_chapters,
                                progress: job.total_chapters > 0
                                    ? Math.round((job.completed_chapters / job.total_chapters) * 100)
                                    : 0
                            };
                        }
                    } catch (error) {
                        logger.error('Error fetching download job for bot status', { jobId: op.id, error });
                    }
                }
                return op;
            })
        );

        res.json({
            success: true,
            operations: enrichedOperations,
            summary: botStatusService.getSummary(),
            isActive: botStatusService.isBotActive()
        });
    } catch (error) {
        logger.error('Error fetching bot status', { error });
        res.status(500).json({ error: 'Failed to fetch bot status', message: error.message });
    }
});

/**
 * Get bot status summary
 */
router.get('/summary', (req, res) => {
    try {
        res.json({
            success: true,
            summary: botStatusService.getSummary(),
            isActive: botStatusService.isBotActive()
        });
    } catch (error) {
        logger.error('Error fetching bot summary', { error });
        res.status(500).json({ error: 'Failed to fetch bot summary', message: error.message });
    }
});

/**
 * Stream bot status updates (SSE)
 */
router.get('/stream', (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial status
    const sendUpdate = async () => {
        try {
            const operations = botStatusService.getActiveOperations();
            const enrichedOperations = await Promise.all(
                operations.map(async (op) => {
                    if (op.type === 'download' && op.id) {
                        try {
                            const job = await DownloadJob.findById(op.id);
                            if (job) {
                                return {
                                    ...op,
                                    totalChapters: job.total_chapters,
                                    completedChapters: job.completed_chapters,
                                    failedChapters: job.failed_chapters,
                                    progress: job.total_chapters > 0
                                        ? Math.round((job.completed_chapters / job.total_chapters) * 100)
                                        : 0
                                };
                            }
                        } catch (error) {
                            logger.warn('Error enriching bot status download job in stream', { jobId: op.id, error: error.message });
                        }
                    }
                    return op;
                })
            );

            res.write(`data: ${JSON.stringify({
                type: 'status-update',
                operations: enrichedOperations,
                summary: botStatusService.getSummary(),
                isActive: botStatusService.isBotActive()
            })}\n\n`);
        } catch (error) {
            logger.error('Error sending bot status update', { error });
        }
    };

    // Send initial update
    sendUpdate();

    // Send updates every 2 seconds
    const interval = setInterval(sendUpdate, 2000);

    // Handle client disconnect
    req.on('close', () => {
        clearInterval(interval);
        res.end();
    });
});

module.exports = router;

