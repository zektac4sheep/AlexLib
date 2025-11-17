/**
 * Book Name Detector
 * Detects book name from thread title using regex patterns
 * Returns Simplified Chinese (as-is from Cool18)
 */

/**
 * Detect book name from thread title
 * Patterns: (都市猎艳.*?)第, (.*?)第.*章
 * @param {string} threadTitle - Thread title from Cool18 (Simplified Chinese)
 * @returns {string|null} - Book name in Simplified Chinese, or null if not detected
 */
function detectBookName(threadTitle) {
  if (!threadTitle) return null;

  // Common patterns for book name detection
  const patterns = [
    // Pattern: "都市猎艳人生 第126章" -> "都市猎艳人生"
    /^(.+?)\s*第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/,
    // Pattern: "书名（第126章）" -> "书名"
    /^(.+?)[（(]第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)[）)]/,
    // Pattern: "书名 - 第126章" -> "书名"
    /^(.+?)\s*[-－]\s*第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/,
    // Pattern: "书名 126" -> "书名"
    /^(.+?)\s+[零一二三四五六七八九十百千万两0-9]+$/,
    // Fallback: take everything before common separators
    /^(.+?)(?:\s*[第（(【]|$)/,
  ];

  for (const pattern of patterns) {
    const match = threadTitle.match(pattern);
    if (match && match[1]) {
      let bookName = match[1].trim();
      
      // Clean up common suffixes
      bookName = bookName.replace(/\s*[-－]\s*$/, '');
      bookName = bookName.replace(/\s*[（(].*?[）)]\s*$/, '');
      bookName = bookName.replace(/\s*【.*?】\s*$/, '');
      
      // Must have at least 2 characters
      if (bookName.length >= 2) {
        return bookName;
      }
    }
  }

  // If no pattern matches, return null
  return null;
}

const logger = require('../utils/logger');

/**
 * Match existing book by simplified name
 * This will be used with the Book model
 * @param {string} bookNameSimplified - Book name in Simplified Chinese
 * @param {Function} findBookFn - Function to find book (from Book model)
 * @returns {Promise<Object|null>} - Book object or null
 */

async function matchExistingBook(bookNameSimplified, findBookFn) {
  if (!bookNameSimplified || !findBookFn) return null;
  
  try {
    const book = await findBookFn(bookNameSimplified);
    return book;
  } catch (error) {
    logger.error('Error matching existing book', { bookNameSimplified, error });
    return null;
  }
}

module.exports = {
  detectBookName,
  matchExistingBook
};

