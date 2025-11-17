/**
 * Chapter Number Extractor
 * Extracts chapter numbers from titles (第XXX章/回/集/話/篇)
 */

// Chinese number to integer conversion
const chineseNumbers = {
  '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '百': 100, '千': 1000, '万': 10000
};

function chineseToNumber(chinese) {
  if (!chinese || /^\d+$/.test(chinese)) {
    return parseInt(chinese) || 0;
  }

  let result = 0;
  let temp = 0;
  
  for (let i = 0; i < chinese.length; i++) {
    const char = chinese[i];
    const num = chineseNumbers[char];
    
    if (num === undefined) {
      continue;
    }
    
    if (num < 10) {
      temp = num;
    } else if (num === 10) {
      temp = temp === 0 ? 10 : temp * 10;
    } else if (num === 100) {
      temp = temp === 0 ? 100 : temp * 100;
    } else if (num === 1000) {
      temp = temp === 0 ? 1000 : temp * 1000;
      result += temp;
      temp = 0;
    } else if (num === 10000) {
      result = (result + temp) * 10000;
      temp = 0;
    }
  }
  
  return result + temp;
}

/**
 * Extract chapter number from title
 * Supports: 第1章, 第126章, 第零一章, 第一章, etc.
 * @param {string} title - Chapter title
 * @returns {Object|null} - {number: 126, format: "章", fullMatch: "第126章"} or null
 */
function extractChapterNumber(title) {
  if (!title) return null;

  // Pattern: 第[零一二三四五六七八九十百两0-9]+(?:部[分]|季[度]|章|卷[书经]|篇[篇经文]|[部集])
  const patterns = [
    /第([零一二三四五六七八九十百千万两0-9]+)(章|回|集|話|篇|部|卷)/,
    /([（(【〔〖〝「『])([零一二三四五六七八九十百千万两0-9]+)([）)】〕〗〞」』])/,
    /第([零一二三四五六七八九十百千万两0-9]+)/
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      const numberStr = match[1] || match[2];
      const format = match[2] || '';
      const number = chineseToNumber(numberStr);
      
      if (number > 0) {
        return {
          number,
          format,
          fullMatch: match[0]
        };
      }
    }
  }

  return null;
}

/**
 * Normalize chapter title
 * @param {string} title - Raw chapter title
 * @returns {string} - Normalized title
 */
function normalizeChapterTitle(title) {
  if (!title) return '';
  
  // Remove extra whitespace
  let normalized = title.trim();
  
  // Remove common prefixes/suffixes that might interfere
  normalized = normalized.replace(/^【.*?】/, '');
  normalized = normalized.replace(/^\[.*?\]/, '');
  
  return normalized.trim();
}

module.exports = {
  extractChapterNumber,
  normalizeChapterTitle
};

