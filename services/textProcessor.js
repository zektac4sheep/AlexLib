/**
 * Text Processor Service
 * Cleans and formats HTML content from Cool18 threads
 * Based on patterns from Reference.md
 */

const cheerio = require('cheerio');
const converter = require('./converter');
const logger = require('../utils/logger');

// Text formatting patterns (from Reference.md)
const patterns = [
    [/~/g, ""], // remove all the ~
    [/　/g, ""], // remove all the full-width space
    [/^\s*$/gm, ""], // remove empty lines
    [
        /((第[零一二三四五六七八九十百千万两0-9]+(?:部[分]|季[度]|章|卷[书经]|篇[篇经文]|[部集])))/g,
        "\n# $1\n", // if the line starts with a bracket, and number, we make it a header
    ],
    [
        /([（(【〔〖〝「『][零一二三四五六七八九十百千万两0-9-]+[）)】〕〗〞」』])/g,
        "\n# $1\n\n", // if the line starts with a bracket, and number, we make it a header
    ],
    [/^(?![#])([（(【〔〖〝「『])/gm, "\n\n$1"], // if the line starts with a bracket, we split it
    [/([）)】〕〗〞」』])/g, "$1\n\n"], // if the line ends with a bracket, we split it
    [/(.{80})/g, "$1\n"], // split every line with more than 80 characters
    [/^(?![#])(.{1,40})\n\n(?![#])(.{1,40})\n/gm, "$1$2\n"], // if two lines are not headers, we merge them
    [/^(?![#])([。！？；;!?])(.{1,40})\n/gm, "$1$2\n"], // if the first line ends with punctuation, we merge them
    [/^(?![#])(.*)$/gm, "  $1"], // add two spaces to the beginning of each line, if the line is not a header
    [/(\n){2,}/g, "\n\n"], // remove two consecutive newlines
    [/^ *#/gm, "#"], // remove all the space in front of all the header #
    [/^ *##/gm, "##"], // remove all the space in front of all the header ##
    [/^ *###/gm, "###"], // remove all the space in front of all the header ###
    [/^ *(\[\[toc\]\])/gm, "$1"], // remove all the space in front of [[toc]]
    [/^ *(\[toc\])/gm, "$1"], // remove all the space in front of [toc]
    [/(.{80})/g, "$1\n"], // split every line with more than 80 characters again
];

/**
 * Clean HTML content from Cool18 thread
 * @param {string} html - Raw HTML content
 * @returns {string} - Cleaned text
 */
function cleanHtml(html) {
    if (!html) return '';

    const $ = cheerio.load(html);

    // Remove script and style tags
    $('script, style, noscript').remove();

    // Remove common unwanted elements
    $('.ad, .advertisement, .ads, .sidebar, .footer, .header, nav').remove();

    // Try to find main content area
    let content = '';
    const contentSelectors = [
        '.post-content',
        '.thread-content',
        '.content',
        '#post-content',
        'td[colspan]',
        '.message',
        'article',
        'main'
    ];

    for (const selector of contentSelectors) {
        const $content = $(selector).first();
        if ($content.length > 0) {
            content = $content.text();
            if (content.length > 100) {
                break;
            }
        }
    }

    // Fallback: get all text from body
    if (!content || content.length < 100) {
        content = $('body').text();
    }

    // Clean up the text
    content = content
        .replace(/cool18\.com/g, "")
        .replace(/[“"]/g, '\n"')
        .replace(/[""]/g, '"\n')
        .replace(/[~]/g, "");

    return content.trim();
}

/**
 * Apply formatting patterns to text
 * @param {string} text - Raw text
 * @returns {string} - Formatted text
 */
function applyPatterns(text) {
    if (!text) return '';

    let processed = text;

    // Apply each pattern
    patterns.forEach((pattern) => {
        try {
            processed = processed.replace(pattern[0], pattern[1]);
        } catch (error) {
            logger.error('Error applying text processing pattern', { pattern: pattern[0].toString(), error });
        }
    });

    return processed;
}

/**
 * Format content from HTML to Markdown
 * @param {string} html - Raw HTML content
 * @param {boolean} convertToTraditional - Whether to convert to Traditional Chinese
 * @returns {string} - Formatted Markdown content
 */
function formatContent(html, convertToTraditional = true) {
    if (!html) return '';

    // Clean HTML
    let content = cleanHtml(html);

    // Apply formatting patterns
    content = applyPatterns(content);

    // Convert to Traditional Chinese if requested
    if (convertToTraditional) {
        content = converter.toTraditional(content);
    }

    return content.trim();
}

/**
 * Process chapter content
 * Adds chapter header if not present
 * @param {string} content - Chapter content
 * @param {string} chapterTitle - Chapter title (e.g., "第126章 絲襪誘惑")
 * @returns {string} - Processed content with header
 */
function processChapterContent(content, chapterTitle) {
    if (!content) return '';

    // Ensure chapter title is a header
    let processed = content.trim();

    // If content doesn't start with the chapter title as a header, add it
    if (chapterTitle && !processed.startsWith(`# ${chapterTitle}`) && !processed.startsWith(chapterTitle)) {
        processed = `# ${chapterTitle}\n\n${processed}`;
    }

    return processed;
}

module.exports = {
    cleanHtml,
    applyPatterns,
    formatContent,
    processChapterContent
};

