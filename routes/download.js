const express = require('express');
const router = express.Router();
const DownloadJob = require('../models/download');
const Chapter = require('../models/chapter');
const downloadService = require('../services/downloadService');
const logger = require('../utils/logger');

// Start download job
router.post('/start', async (req, res) => {
  const { chapters, bookId, bookName, bookMetadata } = req.body;

  if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json({ error: 'chapters array is required' });
  }

  try {
    // Create download job
    const jobId = await DownloadJob.create(bookId, chapters.length);

    // Start processing asynchronously (don't wait for completion)
    processDownloadJobAsync(jobId, chapters, bookId, bookName, bookMetadata).catch(error => {
      logger.error('Error in async download processing', { jobId, error });
    });

    res.json({
      jobId,
      status: 'queued',
      message: 'Download job created and started',
      totalChapters: chapters.length
    });
  } catch (error) {
    logger.error('Error creating download job', { error });
    res.status(500).json({ error: 'Failed to create download job', message: error.message });
  }
});

// Async function to process download job
async function processDownloadJobAsync(jobId, chapters, bookId, bookName, bookMetadata) {
  try {
    await downloadService.processDownloadJob(jobId, chapters, bookId, bookName, bookMetadata);
  } catch (error) {
    logger.error('Error processing download job (async wrapper)', { jobId, error });
  }
}

// Get download job status
router.get('/:jobId/status', async (req, res) => {
  try {
    const job = await DownloadJob.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Download job not found' });
    }
    res.json(job);
  } catch (error) {
    logger.error('Error fetching download job', { jobId: req.params.jobId, error });
    res.status(500).json({ error: 'Failed to fetch download job' });
  }
});

// Stream download logs (SSE)
router.get('/:jobId/stream', (req, res) => {
  const jobId = parseInt(req.params.jobId);

  if (isNaN(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`);

  // Register progress callback
  const progressCallback = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.error('Error writing SSE data', { jobId, error });
      downloadService.unregisterProgressCallback(jobId);
      res.end();
    }
  };

  downloadService.registerProgressCallback(jobId, progressCallback);

  // Handle client disconnect
  req.on('close', () => {
    downloadService.unregisterProgressCallback(jobId);
    res.end();
  });

  // Send periodic heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (error) {
      clearInterval(heartbeat);
      downloadService.unregisterProgressCallback(jobId);
      res.end();
    }
  }, 30000); // Every 30 seconds

  // Clean up on close
  req.on('close', () => {
    clearInterval(heartbeat);
    downloadService.unregisterProgressCallback(jobId);
  });
});

// Retry failed chapters
router.post('/retry-failed', async (req, res) => {
  const { bookId } = req.body;

  if (!bookId) {
    return res.status(400).json({ error: 'bookId is required' });
  }

  try {
    const failedChapters = await Chapter.findFailedByBookId(bookId);

    if (failedChapters.length === 0) {
      return res.json({ message: 'No failed chapters to retry' });
    }

    // Create new download job for retry
    const jobId = await DownloadJob.create(bookId, failedChapters.length);

    // Convert failed chapters to download format
    const chapters = failedChapters.map(ch => ({
      url: ch.cool18_url,
      title: ch.chapter_title_simplified || '',
      chapterNum: ch.chapter_number
    }));

    // Start processing
    processDownloadJobAsync(jobId, chapters, bookId, null).catch(error => {
      logger.error('Error in async retry processing', { jobId, error });
    });

    res.json({
      jobId,
      message: `Retrying ${failedChapters.length} failed chapters`,
      totalChapters: failedChapters.length
    });
  } catch (error) {
    logger.error('Error retrying failed chapters', { bookId, error });
    res.status(500).json({ error: 'Failed to retry chapters', message: error.message });
  }
});

module.exports = router;

