/**
 * Tag Extractor Service
 * Extracts relevant tags from book/chapter titles
 */

// Common tag keywords
const tagKeywords = {
  '小說': ['小说', '小說', 'novel'],
  '成人': ['成人', 'adult', '18+', 'r18'],
  '後宮': ['后宫', '後宮', 'harem'],
  '人妻': ['人妻', 'married'],
  'NTR': ['ntr', 'NTR', '绿帽', '綠帽'],
  '絲襪': ['丝袜', '絲襪', 'stocking'],
  '都市': ['都市', 'urban', 'city'],
  '古裝': ['古装', '古裝', 'ancient', 'historical'],
  '穿越': ['穿越', 'time travel', 'transmigration'],
  '重生': ['重生', 'reborn', 'reincarnation'],
  '玄幻': ['玄幻', 'fantasy', 'xuanhuan'],
  '武俠': ['武侠', '武俠', 'martial arts', 'wuxia'],
  '現代': ['现代', '現代', 'modern'],
  '校園': ['校园', '校園', 'school', 'campus'],
  '職場': ['职场', '職場', 'workplace', 'office'],
  '科幻': ['科幻', 'sci-fi', 'science fiction'],
  '懸疑': ['悬疑', '懸疑', 'mystery', 'thriller'],
  '愛情': ['爱情', '愛情', 'romance', 'love'],
  'BL': ['bl', 'BL', 'boys love', '耽美'],
  'GL': ['gl', 'GL', 'girls love', '百合'],
};

/**
 * Extract tags from title and content
 * @param {string} title - Book/chapter title
 * @param {string} content - Optional content text
 * @returns {Array<string>} - Array of tag names
 */
function extractTags(title, content = '') {
  if (!title) return [];
  
  const text = (title + ' ' + content).toLowerCase();
  const foundTags = new Set();
  
  // Check each tag keyword
  for (const [tag, keywords] of Object.entries(tagKeywords)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        foundTags.add(tag);
        break;
      }
    }
  }
  
  // Always add 小說 if it's a novel
  if (foundTags.size > 0) {
    foundTags.add('小說');
  }
  
  return Array.from(foundTags);
}

module.exports = {
  extractTags
};

