const express = require('express');
const router = express.Router();
const Book = require('../models/book');
const Chapter = require('../models/chapter');
const cool18Scraper = require('../services/cool18Scraper');
const converter = require('../services/textProcessor').converter;
const logger = require('../utils/logger');

// Get all books
router.get('/', async (req, res) => {
  try {
    const books = await Book.findAll();
    res.json(books);
  } catch (error) {
    logger.error('Error fetching books', { error });
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// Extract book metadata from a thread URL
router.post('/extract-metadata', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const metadata = await cool18Scraper.extractBookMetadata(url);

    // Convert book name to traditional Chinese
    const bookNameTraditional = converter.toTraditional(metadata.bookName);

    res.json({
      ...metadata,
      bookNameTraditional
    });
  } catch (error) {
    logger.error('Error extracting book metadata', { error });
    res.status(500).json({ error: 'Failed to extract metadata', message: error.message });
  }
});

// Get book by ID with chapters
router.get('/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const chapters = await Chapter.findByBookId(req.params.id);
    const tags = await Book.getTags(req.params.id);

    res.json({
      ...book,
      chapters,
      tags
    });
  } catch (error) {
    logger.error('Error fetching book', { bookId: req.params.id, error });
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

// Get chapters for a book
router.get('/:id/chapters', async (req, res) => {
  try {
    const chapters = await Chapter.findByBookId(req.params.id);
    res.json(chapters);
  } catch (error) {
    logger.error('Error fetching chapters', { bookId: req.params.id, error });
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// Create new book
router.post('/', async (req, res) => {
  try {
    const { book_name_simplified, book_name_traditional, author, category, description, source_url, tags } = req.body;

    if (!book_name_simplified) {
      return res.status(400).json({ error: 'book_name_simplified is required' });
    }

    // Check if book already exists
    const existing = await Book.findBySimplifiedName(book_name_simplified);
    if (existing) {
      return res.json(existing);
    }

    const metadata = {
      author,
      category,
      description,
      sourceUrl: source_url,
      tags: tags || []
    };

    const bookId = await Book.create(book_name_simplified, book_name_traditional, metadata);
    const book = await Book.findById(bookId);
    const bookTags = await Book.getTags(bookId);
    res.status(201).json({ ...book, tags: bookTags });
  } catch (error) {
    logger.error('Error creating book', { error });
    res.status(500).json({ error: 'Failed to create book' });
  }
});

// Update book
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    // Convert tags array if provided
    if (updates.tags && Array.isArray(updates.tags)) {
      // Tags will be handled in Book.update
    } else if (updates.tags && typeof updates.tags === 'string') {
      updates.tags = updates.tags.split(',').map(t => t.trim()).filter(t => t);
    }
    await Book.update(req.params.id, updates);
    const book = await Book.findById(req.params.id);
    const tags = await Book.getTags(req.params.id);
    res.json({ ...book, tags });
  } catch (error) {
    logger.error('Error updating book', { bookId: req.params.id, error });
    res.status(500).json({ error: 'Failed to update book' });
  }
});

// Find missing chapters for a book
router.get('/:id/missing-chapters', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const chapters = await Chapter.findByBookId(req.params.id);

    // Get all chapter numbers
    const chapterNumbers = chapters
      .filter(ch => ch.chapter_number !== null && ch.chapter_number !== undefined)
      .map(ch => ch.chapter_number)
      .sort((a, b) => a - b);

    if (chapterNumbers.length === 0) {
      return res.json({ missingChapters: [], minChapter: null, maxChapter: null });
    }

    const minChapter = Math.min(...chapterNumbers);
    const maxChapter = Math.max(...chapterNumbers);
    const allChapters = new Set(chapterNumbers);
    const missingChapters = [];

    // Find gaps in chapter sequence
    for (let i = minChapter; i <= maxChapter; i++) {
      if (!allChapters.has(i)) {
        missingChapters.push(i);
      }
    }

    res.json({
      missingChapters,
      minChapter,
      maxChapter,
      totalChapters: chapterNumbers.length,
      expectedChapters: maxChapter - minChapter + 1
    });
  } catch (error) {
    logger.error('Error finding missing chapters', { bookId: req.params.id, error });
    res.status(500).json({ error: 'Failed to find missing chapters' });
  }
});

// Search for missing chapters
router.post('/:id/search-missing', async (req, res) => {
  try {
    const { missingChapters, bookName } = req.body;
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    if (!missingChapters || !Array.isArray(missingChapters) || missingChapters.length === 0) {
      return res.status(400).json({ error: 'missingChapters array is required' });
    }

    const searchKeyword = bookName || book.book_name_simplified;
    if (!searchKeyword) {
      return res.status(400).json({ error: 'Book name is required for search' });
    }

    // Search for the book on Cool18
    const cool18Scraper = require('../services/cool18Scraper');
    const chapterExtractor = require('../services/chapterExtractor');

    const searchResults = await cool18Scraper.searchForum(searchKeyword, 5);

    // Filter results to find chapters matching missing chapter numbers
    const foundChapters = [];
    const missingSet = new Set(missingChapters);

    for (const thread of searchResults) {
      const chapterInfo = chapterExtractor.extractChapterNumber(thread.title);
      if (chapterInfo && missingSet.has(chapterInfo.number)) {
        foundChapters.push({
          chapterNumber: chapterInfo.number,
          title: thread.title,
          url: thread.url,
          date: thread.date
        });
      }
    }

    // Also check for multi-chapter pages (e.g., "1-5", "1,2,3", etc.)
    for (const thread of searchResults) {
      // Check for range patterns: "1-5", "1~5", "1至5"
      const rangeMatch = thread.title.match(/(\d+)[-~至到](\d+)/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        for (let i = start; i <= end; i++) {
          if (missingSet.has(i)) {
            // Check if we already have this chapter
            if (!foundChapters.find(ch => ch.chapterNumber === i)) {
              foundChapters.push({
                chapterNumber: i,
                title: thread.title,
                url: thread.url,
                date: thread.date,
                isMultiChapter: true,
                range: `${start}-${end}`
              });
            }
          }
        }
      }

      // Check for comma-separated chapters: "1,2,3" or "1, 2, 3"
      const commaMatch = thread.title.match(/(\d+(?:\s*,\s*\d+)+)/);
      if (commaMatch) {
        const numbers = commaMatch[1].split(',').map(n => parseInt(n.trim()));
        for (const num of numbers) {
          if (missingSet.has(num)) {
            if (!foundChapters.find(ch => ch.chapterNumber === num)) {
              foundChapters.push({
                chapterNumber: num,
                title: thread.title,
                url: thread.url,
                date: thread.date,
                isMultiChapter: true,
                chapters: numbers
              });
            }
          }
        }
      }
    }

    // Sort by chapter number
    foundChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    res.json({
      foundChapters,
      searchedFor: missingChapters,
      foundCount: foundChapters.length,
      missingCount: missingChapters.length
    });
  } catch (error) {
    logger.error('Error searching for missing chapters', { bookId: req.params.id, error });
    res.status(500).json({ error: 'Failed to search for missing chapters', message: error.message });
  }
});

// Delete book
router.delete('/:id', async (req, res) => {
  try {
    await Book.delete(req.params.id);
    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    logger.error('Error deleting book', { bookId: req.params.id, error });
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

module.exports = router;

