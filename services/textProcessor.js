/**
 * Text Processor Service
 * Formats content according to FormatGuide.md for optimal phone reading
 * Based on FormatGuide.md rules
 */

const cheerio = require("cheerio");
const converter = require("./converter");
const logger = require("../utils/logger");

/**
 * Clean HTML content from Cool18 thread
 * @param {string} html - Raw HTML content
 * @returns {string} - Cleaned text
 */
function cleanHtml(html) {
    if (!html) return "";

    const $ = cheerio.load(html);

    // Remove script and style tags
    $("script, style, noscript").remove();

    // Remove common unwanted elements
    $(".ad, .advertisement, .ads, .sidebar, .footer, .header, nav").remove();

    // Try to find main content area
    let content = "";
    const contentSelectors = [
        ".post-content",
        ".thread-content",
        ".content",
        "#post-content",
        "td[colspan]",
        ".message",
        "article",
        "main",
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
        content = $("body").text();
    }

    // Clean up the text
    content = content.replace(/cool18\.com/g, "").replace(/[~]/g, "");

    return content.trim();
}

/**
 * Normalize Chinese punctuation to full-width
 * @param {string} text - Text to normalize
 * @returns {string} - Text with normalized punctuation
 */
function normalizePunctuation(text) {
    if (!text) return "";

    // Convert half-width to full-width punctuation
    const replacements = {
        ",": "，",
        ".": "。",
        "!": "！",
        "?": "？",
        ":": "：",
        ";": "；",
        "(": "（",
        ")": "）",
        "[": "【",
        "]": "】",
        '"': '"',
        '"': '"',
        "'": "'",
        "'": "'",
    };

    let normalized = text;
    for (const [half, full] of Object.entries(replacements)) {
        // Escape special regex characters in the search string
        const escaped = half.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        normalized = normalized.replace(new RegExp(escaped, "g"), full);
    }

    // Normalize ellipsis
    normalized = normalized.replace(/\.{3,}/g, "……");
    normalized = normalized.replace(/…{2,}/g, "……");

    return normalized;
}

/**
 * Break long lines to target length (50 chars per line)
 * @param {string} text - Text to break
 * @param {number} targetLength - Target line length (default 50)
 * @param {number} maxLength - Maximum line length (default 50)
 * @returns {string} - Text with line breaks
 */
function breakLongLines(text, targetLength = 50, maxLength = 50) {
    if (!text) return "";

    const lines = text.split("\n");
    const result = [];

    for (const line of lines) {
        // Skip headers and empty lines
        if (line.trim().startsWith("##") || line.trim() === "") {
            result.push(line);
            continue;
        }

        // If line is already short enough, keep it
        if (line.length <= maxLength) {
            result.push(line);
            continue;
        }

        // Break long lines at natural boundaries
        let remaining = line;
        while (remaining.length > maxLength) {
            // Try to break at punctuation first
            let breakPoint = -1;
            const punctuation = ["。", "！", "？", "，", "；", "：", "、"];

            for (
                let i = Math.min(targetLength, remaining.length - 1);
                i >= Math.max(1, remaining.length - (maxLength - targetLength));
                i--
            ) {
                if (punctuation.includes(remaining[i])) {
                    breakPoint = i + 1;
                    break;
                }
            }

            // If no punctuation found, break at space or just force break
            if (breakPoint === -1) {
                for (
                    let i = targetLength;
                    i < Math.min(remaining.length, maxLength);
                    i++
                ) {
                    if (remaining[i] === " " || remaining[i] === "　") {
                        breakPoint = i;
                        break;
                    }
                }
            }

            // Force break if still not found
            if (breakPoint === -1) {
                breakPoint = Math.min(targetLength, remaining.length);
            }

            result.push(remaining.substring(0, breakPoint).trim());
            remaining = remaining.substring(breakPoint).trim();
        }

        if (remaining.length > 0) {
            result.push(remaining);
        }
    }

    return result.join("\n");
}

/**
 * Detect and extract metadata from content
 * Format: 作者：xxx 2025/11/16發表於：xxx是否首發：是字數：13,186 字
 * @param {string} content - Content to check
 * @returns {Object} - { metadata: Object|null, cleanedContent: string }
 */
function extractMetadataBlock(content) {
    if (!content) return { metadata: null, cleanedContent: content };

    // Pattern to match: 作者：... 日期發表於：...是否首發：...字數：... 字
    // Format: 作者：duty111 2025/11/16發表於：第一會所，春滿四合院是否首發：是字數：13,186 字
    // Note: No spaces between "發表於：" and previous field, or between "是否首發：" and previous field
    const metadataPatterns = [
        // Exact format: 作者：xxx 日期發表於：xxx是否首發：xxx字數：xxx 字
        // Pattern: 作者：([^ ]+) (\d{4}/\d{1,2}/\d{1,2})發表於：([^是否]+)是否首發：([^字數]+)字數：([0-9,]+) 字
        /作者[：:]([^\s\n]+)\s+(\d{4}\/\d{1,2}\/\d{1,2})[發发]表於[：:]([^是否\n]+)是否首發[：:]([^字數\n]+)字數[：:]([0-9,]+)\s*字/g,
        // With optional spaces after colons
        /作者[：:]\s*([^\s\n]+)\s+(\d{4}\/\d{1,2}\/\d{1,2})[發发]表於[：:]\s*([^是否\n]+)是否首發[：:]\s*([^字數\n]+)字數[：:]\s*([0-9,]+)\s*字/g,
        // With line breaks (more flexible)
        /作者[：:]\s*([^\n]+?)\s+(\d{4}\/\d{1,2}\/\d{1,2})[發发]表於[：:]\s*([^\n]+?)是否首發[：:]\s*([^\n]+?)字數[：:]\s*([0-9,]+)\s*字/g,
    ];

    let cleaned = content;
    let metadata = null;

    for (const pattern of metadataPatterns) {
        const match = pattern.exec(content);
        if (match) {
            const fullMatch = match[0];
            metadata = {
                author: match[1]?.trim(),
                date: match[2]?.trim(),
                publishedAt: match[3]?.trim(),
                isFirstPublication: match[4]?.trim(),
                wordCount: match[5]?.trim(),
                raw: fullMatch,
            };

            // Remove the metadata block from content (handle with or without newlines)
            cleaned = content.replace(fullMatch, "").trim();
            // Also remove any surrounding newlines
            cleaned = cleaned.replace(/^\n+|\n+$/g, "").trim();
            break;
        }
    }

    return { metadata, cleanedContent: cleaned };
}

/**
 * Format chapter content according to FormatGuide.md
 * @param {string} content - Raw chapter content
 * @param {string} chapterTitle - Chapter title (e.g., "第1章 章节标题")
 * @param {boolean} convertToTraditional - Whether to convert to Traditional Chinese
 * @returns {string} - Formatted Markdown content
 */
function formatChapterContent(
    content,
    chapterTitle,
    convertToTraditional = true
) {
    if (!content) return "";

    // Ensure chapterTitle is a string
    if (chapterTitle && typeof chapterTitle !== "string") {
        chapterTitle = String(chapterTitle);
    }
    if (!chapterTitle) {
        chapterTitle = "";
    }

    let formatted = content.trim();

    // Extract and remove metadata blocks first
    const { metadata, cleanedContent } = extractMetadataBlock(formatted);
    formatted = cleanedContent;

    // Normalize punctuation to full-width first
    formatted = normalizePunctuation(formatted);

    // Remove all tildes
    formatted = formatted.replace(/~/g, "");

    // Remove full-width spaces (but preserve regular spaces for now)
    formatted = formatted.replace(/　/g, " ");

    // Preserve scene breaks (mark them first)
    const sceneBreakMarkers = {
        marker1: "___SCENE_BREAK_1___",
        marker2: "___SCENE_BREAK_2___",
        marker3: "___SCENE_BREAK_3___",
    };

    // Mark scene breaks before removing newlines (preserve them)
    formatted = formatted.replace(/\*　\*　\*/g, sceneBreakMarkers.marker1);
    formatted = formatted.replace(/---+$/gm, sceneBreakMarkers.marker2);
    formatted = formatted.replace(/～+$/gm, sceneBreakMarkers.marker3);

    // Remove all newlines - replace with single space
    // But preserve scene break markers by temporarily replacing them with placeholders
    formatted = formatted.replace(
        /\n*___SCENE_BREAK_1___\n*/g,
        ` ${sceneBreakMarkers.marker1} `
    );
    formatted = formatted.replace(
        /\n*___SCENE_BREAK_2___\n*/g,
        ` ${sceneBreakMarkers.marker2} `
    );
    formatted = formatted.replace(
        /\n*___SCENE_BREAK_3___\n*/g,
        ` ${sceneBreakMarkers.marker3} `
    );

    // Now remove all remaining newlines (replace with single space)
    formatted = formatted.replace(/\n+/g, " ");

    // Clean up multiple spaces (but preserve single spaces)
    formatted = formatted.replace(/[ \t]{2,}/g, " ");

    // Restore scene break markers with newlines (they'll be formatted properly later)
    formatted = formatted.replace(
        new RegExp(` ${sceneBreakMarkers.marker1} `, "g"),
        `\n${sceneBreakMarkers.marker1}\n`
    );
    formatted = formatted.replace(
        new RegExp(` ${sceneBreakMarkers.marker2} `, "g"),
        `\n${sceneBreakMarkers.marker2}\n`
    );
    formatted = formatted.replace(
        new RegExp(` ${sceneBreakMarkers.marker3} `, "g"),
        `\n${sceneBreakMarkers.marker3}\n`
    );

    // Remove spaces around quotation marks (FormatGuide rule: no space after 「 and before 」)
    formatted = formatted.replace(/\s*「\s*/g, "「");
    formatted = formatted.replace(/\s*」\s*/g, "」");
    formatted = formatted.replace(/\s*『\s*/g, "『");
    formatted = formatted.replace(/\s*』\s*/g, "』");

    // Ensure dialogue starts on new line
    // Pattern: text「dialogue」 -> text\n「dialogue」
    formatted = formatted.replace(/([^「\n\s])(「)/g, "$1\n$2");
    formatted = formatted.replace(/([^『\n\s])(『)/g, "$1\n$2");

    // Ensure dialogue ends on new line (if followed by text that's not punctuation)
    formatted = formatted.replace(/(」)([^」\n\s。！？，；：、])/g, "$1\n$2");
    formatted = formatted.replace(/(』)([^』\n\s。！？，；：、])/g, "$1\n$2");

    // Split paragraphs - ensure blank line between paragraphs
    // A paragraph ends with 。！？ and is followed by non-punctuation text
    formatted = formatted.replace(
        /([。！？])\s*\n*([^。！？\n「」『』\s])/g,
        "$1\n\n$2"
    );

    // Break long lines (but preserve scene breaks and headers)
    formatted = breakLongLines(formatted);

    // Restore scene breaks with proper formatting (3 lines total: marker + blank + blank)
    formatted = formatted.replace(
        new RegExp(sceneBreakMarkers.marker1, "g"),
        "*　*　*"
    );
    formatted = formatted.replace(
        new RegExp(sceneBreakMarkers.marker2, "g"),
        "———"
    );
    formatted = formatted.replace(
        new RegExp(sceneBreakMarkers.marker3, "g"),
        "～～～～～"
    );

    // Ensure scene breaks have proper spacing (blank line before and after)
    formatted = formatted.replace(
        /([^\n])\n(\*　\*　\*|———|～～～～～)\n([^\n])/g,
        "$1\n\n$2\n\n$3"
    );

    // Ensure chapter header format: ## 第X章 标题
    // One blank line before, one after
    if (chapterTitle) {
        // Remove any existing chapter headers that might have been missed
        formatted = formatted.replace(/^#+\s*第[^章]*章[^\n]*\n*/gm, "");
        formatted = formatted.replace(/^第[^章]*章[^\n]*\n*/gm, "");

        // Add proper chapter header with blank lines
        const header = `## ${chapterTitle}`;
        formatted = `\n${header}\n\n${formatted.trim()}`;
    }

    // Final cleanup: ensure no more than 2 consecutive newlines (except around scene breaks)
    // But preserve scene break formatting (which needs 3 lines)
    formatted = formatted.replace(/\n{4,}/g, "\n\n\n");

    // Remove any leading/trailing whitespace
    formatted = formatted.trim();

    // Convert to Traditional Chinese if requested
    if (convertToTraditional && formatted) {
        try {
            formatted = converter.toTraditional(formatted);
        } catch (error) {
            // If conversion fails, log but continue with original text
            logger.error("Error converting to Traditional Chinese", {
                error: error?.message || String(error),
            });
        }
    }

    return formatted || "";
}

/**
 * Format content from HTML to Markdown (legacy function for downloads)
 * @param {string} html - Raw HTML content
 * @param {boolean} convertToTraditional - Whether to convert to Traditional Chinese
 * @returns {string} - Formatted Markdown content
 */
function formatContent(html, convertToTraditional = true) {
    if (!html) return "";

    // Clean HTML
    let content = cleanHtml(html);

    // Normalize punctuation
    content = normalizePunctuation(content);

    // Basic cleanup
    content = content
        .replace(/~/g, "")
        .replace(/　/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    // Convert to Traditional Chinese if requested
    if (convertToTraditional && content) {
        try {
            content = converter.toTraditional(content);
        } catch (error) {
            // If conversion fails, log but continue with original text
            logger.error("Error converting to Traditional Chinese", {
                error: error?.message || String(error),
            });
        }
    }

    return content || "";
}

/**
 * Process chapter content (legacy function)
 * Adds chapter header if not present
 * @param {string} content - Chapter content
 * @param {string} chapterTitle - Chapter title (e.g., "第126章 絲襪誘惑")
 * @returns {string} - Processed content with header
 */
function processChapterContent(content, chapterTitle) {
    if (!content) return "";
    return formatChapterContent(content, chapterTitle, true);
}

/**
 * Reformat existing chapter content
 * @param {string} content - Existing chapter content
 * @param {string} chapterTitle - Chapter title
 * @param {boolean} convertToTraditional - Whether to convert to Traditional Chinese
 * @returns {string} - Reformatted content
 */
function reformatChapterContent(
    content,
    chapterTitle,
    convertToTraditional = true
) {
    if (!content) return "";

    // Ensure chapterTitle is a string
    if (chapterTitle && typeof chapterTitle !== "string") {
        chapterTitle = String(chapterTitle);
    }
    if (!chapterTitle) {
        chapterTitle = "";
    }

    // Remove existing formatting to start fresh
    let cleaned = content
        // Remove existing headers
        .replace(/^#+\s*第[^章]*章[^\n]*\n*/gm, "")
        .replace(/^第[^章]*章[^\n]*\n*/gm, "")
        // Remove indentation
        .replace(/^[ \t]+/gm, "")
        // Normalize whitespace
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    // Apply formatting
    return formatChapterContent(cleaned, chapterTitle, convertToTraditional);
}

module.exports = {
    cleanHtml,
    formatContent,
    formatChapterContent,
    processChapterContent,
    reformatChapterContent,
    extractMetadataBlock,
    normalizePunctuation,
    breakLongLines,
};
