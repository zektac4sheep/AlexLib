/**
 * Chinese Converter Service
 * Wrapper around opencc-js for Simplified ↔ Traditional conversion
 * Uses HK variant for Traditional Chinese
 */

const { Converter } = require('opencc-js');
const logger = require('../utils/logger');

// Initialize converters
const s2tConverter = Converter({ from: 'cn', to: 'hk' });
const t2sConverter = Converter({ from: 'hk', to: 'cn' });

/**
 * Convert Simplified Chinese to Traditional Chinese (HK variant)
 * @param {string} text - Text in Simplified Chinese
 * @returns {string} - Text in Traditional Chinese
 */
function toTraditional(text) {
  if (!text) return '';
  try {
    return s2tConverter(text);
  } catch (error) {
    logger.error('Error converting to Traditional Chinese', { error });
    return text;
  }
}

/**
 * Convert Traditional Chinese to Simplified Chinese
 * @param {string} text - Text in Traditional Chinese
 * @returns {string} - Text in Simplified Chinese
 */
function toSimplified(text) {
  if (!text) return '';
  try {
    return t2sConverter(text);
  } catch (error) {
    logger.error('Error converting to Simplified Chinese', { error });
    return text;
  }
}

/**
 * Convert book name for UI display (Simplified → Traditional)
 * @param {string} bookNameSimplified - Book name in Simplified Chinese
 * @returns {string} - Book name in Traditional Chinese for display
 */
function convertBookNameForDisplay(bookNameSimplified) {
  return toTraditional(bookNameSimplified);
}

/**
 * Convert book name for Joplin export (Simplified → Traditional)
 * @param {string} bookNameSimplified - Book name in Simplified Chinese
 * @returns {string} - Book name in Traditional Chinese for Joplin
 */
function convertBookNameForJoplin(bookNameSimplified) {
  return toTraditional(bookNameSimplified);
}

module.exports = {
  toTraditional,
  toSimplified,
  convertBookNameForDisplay,
  convertBookNameForJoplin
};

