const express = require('express');
const router = express.Router();
const cool18Scraper = require('../services/cool18Scraper');
const chapterExtractor = require('../services/chapterExtractor');
const bookDetector = require('../services/bookDetector');
const converter = require('../services/converter');
const { normalizeToHalfWidth } = require('../services/converter');
const Book = require('../models/book');
const SearchResult = require('../models/searchResult');
const botStatusService = require('../services/botStatusService');
const logger = require('../utils/logger');

/**
 * Search Cool18 forum and return processed results
 */
router.get('/', async (req, res) => {
  let { keyword, pages = 3 } = req.query;
  
  if (!keyword) {
    return res.status(400).json({ error: 'keyword parameter is required' });
  }
  
  // Normalize keyword: convert full-width to half-width
  keyword = normalizeToHalfWidth(keyword.trim());
  
  const searchId = `search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Register search operation
    botStatusService.registerOperation('search', searchId, {
      keyword,
      pages: parseInt(pages),
      status: 'active'
    });

    logger.info('Searching Cool18', { keyword, pages: parseInt(pages) });
    // Search Cool18 forum
    const threads = await cool18Scraper.searchForum(keyword, parseInt(pages));
    logger.info('Search completed', { keyword, totalThreads: threads.length });
    
    const processedThreads = await buildThreadResponse(threads);
    
    // Update search operation status
    botStatusService.updateOperation('search', searchId, {
      status: 'completed',
      totalResults: processedThreads.length
    });

    // Save search results to database
    let searchResultId = null;
    try {
      searchResultId = await SearchResult.create(keyword, parseInt(pages), processedThreads);
      logger.info('Search results saved to database', { searchResultId, keyword, totalResults: processedThreads.length });
    } catch (dbError) {
      logger.error('Error saving search results to database', { error: dbError, keyword });
      // Don't fail the request if DB save fails
    }

    res.json({
      keyword,
      totalResults: processedThreads.length,
      threads: processedThreads,
      searchResultId: searchResultId // Include the database ID
    });
  } catch (error) {
    logger.error('Error in search', { error, keyword, pages });
    
    // Update search operation status
    botStatusService.updateOperation('search', searchId, {
      status: 'failed',
      error: error.message
    });
    
    res.status(500).json({ 
      error: 'Failed to search Cool18 forum',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Get search history
 */
router.get('/history', async (req, res) => {
  try {
    let { keyword, limit = 50 } = req.query;
    
    // Normalize keyword if provided
    if (keyword) {
      keyword = normalizeToHalfWidth(keyword.trim());
    }
    
    let results;
    if (keyword) {
      results = await SearchResult.findByKeyword(keyword, parseInt(limit));
    } else {
      results = await SearchResult.findAll(parseInt(limit));
    }
    
    res.json({
      total: results.length,
      searches: results
    });
  } catch (error) {
    logger.error('Error fetching search history', { error });
    res.status(500).json({ 
      error: 'Failed to fetch search history',
      message: error.message 
    });
  }
});

/**
 * Get recent search keywords
 */
router.get('/keywords', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const keywords = await SearchResult.getRecentKeywords(parseInt(limit));
    res.json({ keywords });
  } catch (error) {
    logger.error('Error fetching recent keywords', { error });
    res.status(500).json({ 
      error: 'Failed to fetch recent keywords',
      message: error.message 
    });
  }
});

/**
 * Get a specific search result by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await SearchResult.findById(parseInt(req.params.id));
    if (!result) {
      return res.status(404).json({ error: 'Search result not found' });
    }
    res.json(result);
  } catch (error) {
    logger.error('Error fetching search result', { error, id: req.params.id });
    res.status(500).json({ 
      error: 'Failed to fetch search result',
      message: error.message 
    });
  }
});

/**
 * Delete a search result
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await SearchResult.delete(parseInt(req.params.id));
    if (deleted === 0) {
      return res.status(404).json({ error: 'Search result not found' });
    }
    res.json({ message: 'Search result deleted successfully' });
  } catch (error) {
    logger.error('Error deleting search result', { error, id: req.params.id });
    res.status(500).json({ 
      error: 'Failed to delete search result',
      message: error.message 
    });
  }
});

/**
 * Parse uploaded HTML search page instead of crawling Cool18
 */
router.post('/html', async (req, res) => {
  let { htmlContent, keyword = '', pages = 1 } = req.body || {};

  if (!htmlContent || typeof htmlContent !== 'string' || htmlContent.trim() === '') {
    return res.status(400).json({ error: 'htmlContent is required' });
  }

  // Normalize keyword: convert full-width to half-width
  keyword = keyword ? normalizeToHalfWidth(keyword.trim()) : 'uploaded-html';

  const searchId = `search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    botStatusService.registerOperation('search', searchId, {
      keyword: keyword || 'uploaded-html',
      pages: parseInt(pages),
      status: 'active',
      source: 'html',
    });

    const threads = cool18Scraper.extractThreadMetadata(htmlContent);
    logger.info('Parsed uploaded search HTML', { keyword, threadCount: threads.length });

    const processedThreads = await buildThreadResponse(threads);

    await SearchResult.create(keyword || 'uploaded-html', parseInt(pages), processedThreads);

    botStatusService.updateOperation('search', searchId, {
      status: 'completed',
      totalResults: processedThreads.length,
    });

    res.json({
      keyword,
      totalResults: processedThreads.length,
      threads: processedThreads,
    });
  } catch (error) {
    logger.error('Error parsing uploaded search HTML', { error });
    botStatusService.updateOperation('search', searchId, {
      status: 'failed',
      error: error.message,
    });
    res.status(500).json({
      error: 'Failed to parse search HTML',
      message: error.message,
    });
  }
});

async function buildThreadResponse(threads = []) {
  return Promise.all(
    threads.map(async (thread) => {
      const chapterInfo = chapterExtractor.extractChapterNumber(thread.title);
      const bookNameSimplified = bookDetector.detectBookName(thread.title);
      const titleTraditional = converter.toTraditional(thread.title);

      let existingBook = null;
      if (bookNameSimplified) {
        existingBook = await Book.findBySimplifiedName(bookNameSimplified);
      }

      return {
        url: thread.url,
        threadId: thread.threadId,
        title: thread.title,
        titleTraditional,
        chapterNumber: chapterInfo ? chapterInfo.number : null,
        chapterFormat: chapterInfo ? chapterInfo.format : null,
        bookNameSimplified,
        bookNameTraditional: bookNameSimplified ? converter.toTraditional(bookNameSimplified) : null,
        existingBookId: existingBook ? existingBook.id : null,
        date: thread.date,
        replies: thread.replies,
      };
    })
  );
}

module.exports = router;

