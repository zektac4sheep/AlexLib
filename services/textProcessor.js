/**
 * Text Processor Service
 * Formats content according to FormatGuide.md for optimal phone reading
 * Based on FormatGuide.md rules
 *
 * FORMATTING PHASES (formatChapterContent):
 * ==========================================
 * The formatting process consists of the following phases, executed in order:
 *
 * 0. Denoise - Remove noise/artifacts from content (currently no-op, placeholder for future implementation)
 * 1. Initial content (after trim) - Trim leading/trailing whitespace
 * 2. After cleanText - Remove "cool18" references and empty full stops
 * 3. After extractMetadataBlock - Extract and remove metadata blocks (author, date, word count, etc.)
 * 4. After normalizePunctuation - Convert half-width punctuation to full-width Chinese punctuation
 * 5. After removing tildes and full-width spaces - Remove ~ characters and convert full-width spaces to half-width
 * 6. After scene break marking - Mark scene break patterns (*　*　*, ---, ～～～) with placeholders
 * 7. After removing newlines - Remove all newlines, replacing with single spaces (preserving scene break markers)
 * 8. After cleaning spaces - Remove multiple consecutive spaces/tabs
 * 9. After restoring scene breaks - Restore scene break markers with newlines
 * 10. After quotation mark formatting - Remove spaces around Chinese quotation marks (「」『』)
 * 11. After dialogue line breaks - Ensure dialogue starts and ends on new lines
 * 12. After paragraph splitting - Add blank lines between paragraphs (after 。！？)
 * 13. After breakLongLines - Break long lines to ~50 characters per line
 * 14. After scene break restoration - Replace scene break markers with actual markers (*　*　*, ———, ～～～～～)
 * 15. After chapter header addition - Add formatted chapter header (## 第X章 标题)
 * 16. After final cleanup - Remove excessive consecutive newlines (max 2, except around scene breaks)
 * 17. After Traditional Chinese conversion - Convert Simplified Chinese to Traditional Chinese (if enabled)
 */

const cheerio = require("cheerio");
const converter = require("./converter");
const logger = require("../utils/logger");

/**
 * Get detailed log flag from environment variable or parameter
 * @param {boolean|undefined} detailedLog - Optional parameter to override env var
 * @returns {boolean} - Whether detailed logging is enabled
 */
function getDetailedLogFlag(detailedLog) {
    if (detailedLog !== undefined) {
        return detailedLog === true;
    }
    return (
        process.env.DETAILED_LOG === "true" || process.env.DETAILED_LOG === "1"
    );
}

// detail debug log enable
// for each phase
const detailedLog_each_phase = [];
// it's an array of boolean values, one for each phase
// the index of the array corresponds to the phase number
// all are initial to be true;
for (let i = 0; i < 17; i++) {
    detailedLog_each_phase.push(true);
}

//phase 0: denoise
//phase 1: initial content (after trim)
//phase 2: after cleanText
//phase 3: after extractMetadataBlock
//phase 4: after normalizePunctuation
//phase 5: after removing tildes and full-width spaces
//phase 6: after scene break marking
//phase 7: after removing newlines
//phase 8: after cleaning spaces
//phase 9: after restoring scene breaks
//phase 10: after quotation mark formatting
//phase 11: after dialogue line breaks
//phase 12: after paragraph splitting
//phase 13: after breakLongLines
//phase 14: after scene break restoration
//phase 15: after chapter header addition
//phase 16: after final cleanup
//phase 17: after Traditional Chinese conversion

const debug_format_content = false;

if (debug_format_content) {
    detailedLog_each_phase[0] = false;
    detailedLog_each_phase[1] = true;
    detailedLog_each_phase[2] = true;
    detailedLog_each_phase[3] = true;
    detailedLog_each_phase[4] = true;
    detailedLog_each_phase[5] = true;
    detailedLog_each_phase[6] = true;
    detailedLog_each_phase[7] = true;
    detailedLog_each_phase[8] = true;
    detailedLog_each_phase[9] = true;
    detailedLog_each_phase[10] = true;
    detailedLog_each_phase[11] = true;
    detailedLog_each_phase[12] = true;
    detailedLog_each_phase[13] = true;
    detailedLog_each_phase[14] = false;
    detailedLog_each_phase[15] = false;
    detailedLog_each_phase[16] = true;
    detailedLog_each_phase[17] = false;
} else {
    // all are false
    detailedLog_each_phase[0] = false;
    detailedLog_each_phase[1] = false;
    detailedLog_each_phase[2] = false;
    detailedLog_each_phase[3] = false;
    detailedLog_each_phase[4] = false;
    detailedLog_each_phase[5] = false;
    detailedLog_each_phase[6] = false;
    detailedLog_each_phase[7] = false;
    detailedLog_each_phase[8] = false;
    detailedLog_each_phase[9] = false;
    detailedLog_each_phase[10] = false;
    detailedLog_each_phase[11] = false;
    detailedLog_each_phase[12] = false;
    detailedLog_each_phase[13] = false;
    detailedLog_each_phase[14] = false;
    detailedLog_each_phase[15] = false;
    detailedLog_each_phase[16] = false;
    detailedLog_each_phase[17] = false;
}
/**
 * Log phase result with content preview
 * @param {string} phaseName - Name of the phase
 * @param {string} content - Content to log
 * @param {boolean} detailedLog - Whether to log
 */
function logPhase(phaseName, content, detailedLog) {
    if (!detailedLog) return;
    const preview = content ? content.substring(0, 200) : "(empty)";
    const length = content ? content.length : 0;
    logger.info(`[Format Phase] ${phaseName}`, {
        length,
        preview: preview + (content && content.length > 200 ? "..." : ""),
    });
}

/**
 * Denoise content - Remove noise and artifacts
 * Currently a no-op placeholder for future implementation
 * @param {string} content - Content to denoise
 * @returns {string} - Denoised content
 */
function denoise(content) {
    if (!content) return "";
    // TODO: Implement noise removal logic
    // This could include:
    // - Removing unwanted characters/patterns
    // - Fixing encoding issues
    // - Removing artifacts from scraping/conversion
    return content;
}

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
 * Clean text by removing "cool18" (case-insensitive) and empty full stops
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
    if (!text) return "";

    let cleaned = text;

    // Remove "cool18.com" (case-insensitive) - remove URL
    cleaned = cleaned.replace(/cool18\.com/gi, "");

    // Remove "cool18" (case-insensitive) - remove as whole word or part of word
    cleaned = cleaned.replace(/cool18/gi, "");

    // Remove empty full stops (periods with nothing meaningful after them)
    // Pattern: period at end of line (with optional whitespace)
    cleaned = cleaned.replace(/\.\s*$/gm, ""); // Half-width period at end of line
    cleaned = cleaned.replace(/。\s*$/gm, ""); // Full-width period at end of line

    // Remove standalone periods (period with only whitespace around it)
    cleaned = cleaned.replace(/^\s*\.\s*$/gm, ""); // Standalone half-width period on a line
    cleaned = cleaned.replace(/^\s*。\s*$/gm, ""); // Standalone full-width period on a line

    // Remove multiple consecutive periods (with or without spaces)
    cleaned = cleaned.replace(/\.{2,}/g, ""); // Multiple half-width periods
    cleaned = cleaned.replace(/。{2,}/g, ""); // Multiple full-width periods
    cleaned = cleaned.replace(/\.\s+\./g, ""); // Periods separated by spaces
    cleaned = cleaned.replace(/。\s+。/g, ""); // Full-width periods separated by spaces

    // Remove period followed only by whitespace and newline/end
    cleaned = cleaned.replace(/\.\s+\n/g, "\n"); // Period + whitespace + newline
    cleaned = cleaned.replace(/。\s+\n/g, "\n"); // Full-width period + whitespace + newline

    // clean range chapter numbers e.g. (1-3) both in half-width and full-width
    // the digit can also be both half-width and full-width, and with multiple digits
    // there can be space between the numbers and the parentheses
    // IDEMPOTENCY: This replacement uses $1-$2 but the pattern doesn't have capture groups
    // This is actually removing the range, not replacing it. Let's fix it to be idempotent.
    // Note: This pattern removes ranges like (1-3), which should be idempotent (removing twice = removing once)
    cleaned = cleaned.replace(
        /[（(]\s*[零一二三四五六七八九十百千万两0-9０１２３４５６７８９]\s*[-－~～]\s*[零一二三四五六七八九十百千万两0-9０１２３４５６７８９]\s*[）)]/g,
        ""
    );
    return cleaned.trim();
}

/**
 * Truncate string to maximum length (for chapter titles and names)
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length (default 20)
 * @returns {string} - Truncated string
 */
function truncateToMax(str, maxLength = 10) {
    if (!str) return "";
    if (str.length <= maxLength) {
        return str;
    }
    return str.substring(0, maxLength);
}

/**
 * Limit chapter name to maximum 20 characters
 * @param {string} chapterName - Chapter name to limit
 * @param {number} maxLength - Maximum length (default 20)
 * @returns {string} - Truncated chapter name
 */
function limitChapterName(chapterName, maxLength = 10) {
    if (!chapterName) return "";

    // First clean the text
    let cleaned = cleanText(chapterName);

    // the chapter name would not contain "new lines", so we can just truncate the text afterward if we found one

    if (cleaned.includes("\n")) {
        // remove the text after the first new line
        cleaned = cleaned.split("\n")[0];
    }

    // If still within limit, return as is
    if (cleaned.length <= maxLength) {
        return cleaned;
    }

    // Truncate to maxLength
    return cleaned.substring(0, maxLength);
}

/**
 * Escape special regex characters in a string
 * @param {string} str - String to escape
 * @returns {string} - Escaped string safe for use in regex
 */
function escapeRegex(str) {
    if (!str) return "";
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Process chapter title: clean text and limit name length
 * @param {string} chapterTitle - Full chapter title (e.g., "第1章 章节标题")
 * @returns {string} - Processed chapter title
 */
function processChapterTitle(chapterTitle) {
    if (!chapterTitle) return "";

    // Extract chapter number prefix (e.g., "第1章 ")
    const prefixMatch = chapterTitle.match(/^(第\d+章\s*)/);
    const prefix = prefixMatch ? prefixMatch[1] : "";

    // Extract chapter name (everything after the prefix)
    const chapterName = prefixMatch
        ? chapterTitle.substring(prefixMatch[0].length).trim()
        : chapterTitle.trim();

    // Clean and limit the chapter name
    const processedName = limitChapterName(chapterName);

    // Reconstruct the title
    return prefix + processedName;
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
 * This function is idempotent - if metadata is already removed, it returns null
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
                author: match[1]?.trim() ? match[1].trim().slice(0, 20) : null,
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
 * @param {boolean|undefined} detailedLog - Whether to enable detailed logging (overrides env var)
 * @returns {string} - Formatted Markdown content
 */
function formatChapterContent(
    content,
    chapterTitle,
    convertToTraditional = true,
    detailedLog = undefined
) {
    if (!content) return "";

    const isDetailedLog = getDetailedLogFlag(detailedLog);

    // Ensure chapterTitle is a string
    if (chapterTitle && typeof chapterTitle !== "string") {
        chapterTitle = String(chapterTitle);
    }
    if (!chapterTitle) {
        chapterTitle = "";
    }

    // Denoise content (currently no-op)
    let formatted = denoise(content);
    if (detailedLog_each_phase[0]) {
        logPhase("0. After denoise", formatted, isDetailedLog);
    }

    formatted = formatted.trim();
    if (detailedLog_each_phase[1]) {
        logPhase("1. Initial content (after trim)", formatted, isDetailedLog);
    }

    // Clean text: remove cool18 and empty full stops
    formatted = cleanText(formatted);
    if (detailedLog_each_phase[2]) {
        logPhase("2. After cleanText", formatted, isDetailedLog);
    }

    // Extract and remove metadata blocks first
    const { metadata, cleanedContent } = extractMetadataBlock(formatted);
    formatted = cleanedContent;
    if (detailedLog_each_phase[3]) {
        logPhase("3. After extractMetadataBlock", formatted, isDetailedLog);
    }

    // print extracted metadata
    logger.info("Extracted metadata", {
        author: metadata?.author,
        date: metadata?.date,
        publishedAt: metadata?.publishedAt,
        isFirstPublication: metadata?.isFirstPublication,
        wordCount: metadata?.wordCount,
    });

    // Normalize punctuation to full-width first
    // IDEMPOTENCY: normalizePunctuation is idempotent (only converts half-width to full-width)
    formatted = normalizePunctuation(formatted);
    if (detailedLog_each_phase[4]) {
        logPhase("4. After normalizePunctuation", formatted, isDetailedLog);
    }

    // Remove all tildes (idempotent - if already removed, nothing happens)
    formatted = formatted.replace(/~/g, "");

    // Remove full-width spaces (but preserve regular spaces for now)
    // IDEMPOTENCY: This is idempotent - if already converted, nothing changes
    formatted = formatted.replace(/　/g, " ");
    if (detailedLog_each_phase[5]) {
        logPhase(
            "5. After removing tildes and full-width spaces",
            formatted,
            isDetailedLog
        );
    }

    // Preserve scene breaks (mark them first)
    const sceneBreakMarkers = {
        marker1: "___SCENE_BREAK_1___",
        marker2: "___SCENE_BREAK_2___",
        marker3: "___SCENE_BREAK_3___",
    };

    // IDEMPOTENCY: Check if markers already exist (from previous formatting run)
    // If they do, we're reformatting already-formatted content
    const hasExistingMarkers =
        formatted.includes(sceneBreakMarkers.marker1) ||
        formatted.includes(sceneBreakMarkers.marker2) ||
        formatted.includes(sceneBreakMarkers.marker3);

    if (!hasExistingMarkers) {
        // Only mark scene breaks if markers don't already exist
        // Mark scene breaks before removing newlines (preserve them)
        formatted = formatted.replace(/\*　\*　\*/g, sceneBreakMarkers.marker1);
        formatted = formatted.replace(/---+$/gm, sceneBreakMarkers.marker2);
        formatted = formatted.replace(/～+$/gm, sceneBreakMarkers.marker3);
    }
    if (detailedLog_each_phase[6]) {
        logPhase("6. After scene break marking", formatted, isDetailedLog);
    }

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
    if (detailedLog_each_phase[7]) {
        logPhase("7. After removing newlines", formatted, isDetailedLog);
    }

    // Clean up multiple spaces (but preserve single spaces)
    formatted = formatted.replace(/[ \t]{2,}/g, " ");
    if (detailedLog_each_phase[8]) {
        logPhase("8. After cleaning spaces", formatted, isDetailedLog);
    }

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
    if (detailedLog_each_phase[9]) {
        logPhase("9. After restoring scene breaks", formatted, isDetailedLog);
    }

    // there are some text use ', " , as dialog marks, we need to replace them to "「」" or "『』"
    // inside a chapter the first ' would reaplced to "「"
    // the second ' would reaplced to "」"
    // the first " would reaplced to "『"
    // the second " would reaplced to "』"
    // so we have the correct dialog sequence: "「dialogue」" or "『dialogue』"

    // IDEMPOTENCY: Handle mixed content - preserve existing Chinese quotes, convert only unconverted quotes
    // Use temporary placeholders to preserve existing Chinese quotes during conversion
    const quotePlaceholders = {
        singleOpen: "___QUOTE_SINGLE_OPEN___",
        singleClose: "___QUOTE_SINGLE_CLOSE___",
        doubleOpen: "___QUOTE_DOUBLE_OPEN___",
        doubleClose: "___QUOTE_DOUBLE_CLOSE___",
    };

    // Replace existing Chinese quotes with placeholders
    formatted = formatted.replace(/「/g, quotePlaceholders.singleOpen);
    formatted = formatted.replace(/」/g, quotePlaceholders.singleClose);
    formatted = formatted.replace(/『/g, quotePlaceholders.doubleOpen);
    formatted = formatted.replace(/』/g, quotePlaceholders.doubleClose);

    // Normalize all quote variants to standard quotes for conversion
    // replace all " or " both to """
    formatted = formatted.replace(/"/g, '"');
    formatted = formatted.replace(/"/g, '"');

    // Convert remaining quotes (', ") to Chinese quotes
    function toChineseQuotes(text) {
        let singleToggle = false; // true = next ' should be 「
        let doubleToggle = false; // true = next " should be 『

        return text.replace(/["']/g, (match) => {
            if (match === '"') {
                doubleToggle = !doubleToggle;
                return doubleToggle ? "『" : "』";
            } else {
                // match === "'"
                singleToggle = !singleToggle;
                return singleToggle ? "「" : "」";
            }
        });
    }
    formatted = toChineseQuotes(formatted);

    // Restore the original Chinese quotes from placeholders
    formatted = formatted.replace(
        new RegExp(quotePlaceholders.singleOpen, "g"),
        "「"
    );
    formatted = formatted.replace(
        new RegExp(quotePlaceholders.singleClose, "g"),
        "」"
    );
    formatted = formatted.replace(
        new RegExp(quotePlaceholders.doubleOpen, "g"),
        "『"
    );
    formatted = formatted.replace(
        new RegExp(quotePlaceholders.doubleClose, "g"),
        "』"
    );

    // Remove spaces around quotation marks (FormatGuide rule: no space after 「 and before 」)
    formatted = formatted.replace(/\s*「\s*/g, "「");
    formatted = formatted.replace(/\s*」\s*/g, "」");
    formatted = formatted.replace(/\s*『\s*/g, "『");
    formatted = formatted.replace(/\s*』\s*/g, "』");
    if (detailedLog_each_phase[10]) {
        logPhase(
            "10. After quotation mark formatting",
            formatted,
            isDetailedLog
        );
    }

    // Ensure dialogue starts on new line
    // Pattern: text「dialogue」 -> text\n「dialogue」
    // IDEMPOTENCY: These patterns only match if the newline doesn't already exist
    formatted = formatted.replace(/([^「\n\s])(「)/g, "$1\n$2");
    formatted = formatted.replace(/([^『\n\s])(『)/g, "$1\n$2");

    // Ensure dialogue ends on new line (if followed by text that's not punctuation)
    // IDEMPOTENCY: These patterns only match if the newline doesn't already exist
    formatted = formatted.replace(/(」)([^」\n\s。！？，；：、])/g, "$1\n$2");
    formatted = formatted.replace(/(』)([^』\n\s。！？，；：、])/g, "$1\n$2");
    if (detailedLog_each_phase[11]) {
        logPhase("11. After dialogue line breaks", formatted, isDetailedLog);
    }

    // Split paragraphs - ensure blank line between paragraphs
    // A paragraph ends with 。！？ and is followed by non-punctuation text
    // IDEMPOTENCY: Pattern only matches if blank line doesn't already exist
    // First, handle cases where there's already a single newline (but not double)
    formatted = formatted.replace(
        /([。！？])\s*\n([^。！？\n「」『』\s])/g,
        "$1\n\n$2"
    );
    // Then handle cases where there's no newline at all (just spaces)
    formatted = formatted.replace(
        /([。！？])\s+([^。！？\n「」『』\s])/g,
        "$1\n\n$2"
    );
    if (detailedLog_each_phase[12]) {
        logPhase("12. After paragraph splitting", formatted, isDetailedLog);
    }

    // Break long lines (but preserve scene breaks and headers)
    formatted = breakLongLines(formatted);
    if (detailedLog_each_phase[13]) {
        logPhase("13. After breakLongLines", formatted, isDetailedLog);
    }

    //if there are consecutive 4+ lines without break (empty line), limit to 3
    // IDEMPOTENCY: This is idempotent - replacing 4+ newlines with 3 newlines
    // If already 3 or fewer, nothing changes
    formatted = formatted.replace(/\n{4,}/g, "\n\n\n");
    if (detailedLog_each_phase[14]) {
        logPhase(
            "14. After consecutive 4 lines without break",
            formatted,
            isDetailedLog
        );
    }

    // Restore scene breaks with proper formatting (3 lines total: marker + blank + blank)
    // IDEMPOTENCY: Only restore if markers exist (not already restored)
    if (formatted.includes(sceneBreakMarkers.marker1)) {
        formatted = formatted.replace(
            new RegExp(sceneBreakMarkers.marker1, "g"),
            "*　*　*"
        );
    }
    if (formatted.includes(sceneBreakMarkers.marker2)) {
        formatted = formatted.replace(
            new RegExp(sceneBreakMarkers.marker2, "g"),
            "———"
        );
    }
    if (formatted.includes(sceneBreakMarkers.marker3)) {
        formatted = formatted.replace(
            new RegExp(sceneBreakMarkers.marker3, "g"),
            "～～～～～"
        );
    }
    if (detailedLog_each_phase[14]) {
        logPhase("14. After scene break restoration", formatted, isDetailedLog);
    }

    // Ensure scene breaks have proper spacing (blank line before and after)
    // IDEMPOTENCY: Only add spacing if it doesn't already exist
    formatted = formatted.replace(
        /([^\n])\n(\*　\*　\*|———|～～～～～)\n([^\n])/g,
        "$1\n\n$2\n\n$3"
    );
    // Also handle case where scene break is at start/end of content
    formatted = formatted.replace(
        /^(\*　\*　\*|———|～～～～～)\n([^\n])/gm,
        "$1\n\n$2"
    );
    formatted = formatted.replace(
        /([^\n])\n(\*　\*　\*|———|～～～～～)$/gm,
        "$1\n\n$2"
    );

    // Ensure chapter header format: ## 第X章 标题
    // One blank line before, one after
    if (chapterTitle) {
        // Process chapter title: clean and limit length
        const processedTitle = processChapterTitle(chapterTitle);

        // Remove any existing chapter headers that match the processed title
        if (processedTitle) {
            const escapedTitle = escapeRegex(processedTitle);
            // Remove markdown headers (##, #, etc.) followed by the title
            formatted = formatted.replace(
                new RegExp(`^#+\\s*${escapedTitle}\\s*\\n*`, "gm"),
                ""
            );
            // Remove plain title at start of line
            formatted = formatted.replace(
                new RegExp(`^${escapedTitle}\\s*\\n*`, "gm"),
                ""
            );
        }

        // Also remove headers with "第X章" format (for backward compatibility)
        formatted = formatted.replace(/^#+\s*第[^章]*章[^\n]*\n*/gm, "");
        formatted = formatted.replace(/^第[^章]*章[^\n]*\n*/gm, "");

        // Add proper chapter header with blank lines
        const header = `## ${processedTitle}`;
        formatted = `\n${header}\n\n${formatted.trim()}`;
    }
    if (detailedLog_each_phase[15]) {
        logPhase("15. After chapter header addition", formatted, isDetailedLog);
    }

    // Final cleanup: ensure no more than 3 consecutive newlines (except around scene breaks)
    // But preserve scene break formatting (which needs 3 lines)
    // IDEMPOTENCY: This is idempotent - if already 3 or fewer, nothing changes
    formatted = formatted.replace(/\n{4,}/g, "\n\n\n");

    // Remove any leading/trailing whitespace
    formatted = formatted.trim();
    if (detailedLog_each_phase[16]) {
        logPhase("16. After final cleanup", formatted, isDetailedLog);
    }

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
    if (detailedLog_each_phase[17]) {
        logPhase(
            "17. After Traditional Chinese conversion",
            formatted,
            isDetailedLog
        );
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
 * This function is designed to be idempotent - running it multiple times
 * on the same content should produce the same result.
 * @param {string} content - Existing chapter content
 * @param {string} chapterTitle - Chapter title
 * @param {boolean} convertToTraditional - Whether to convert to Traditional Chinese
 * @param {boolean|undefined} detailedLog - Whether to enable detailed logging (overrides env var)
 * @returns {string} - Reformatted content
 */
function reformatChapterContent(
    content,
    chapterTitle,
    convertToTraditional = true,
    detailedLog = undefined
) {
    if (!content) return "";

    // Ensure chapterTitle is a string
    if (chapterTitle && typeof chapterTitle !== "string") {
        chapterTitle = String(chapterTitle);
    }
    if (!chapterTitle) {
        chapterTitle = "";
    }

    // IDEMPOTENCY: Remove existing formatting markers and headers to start fresh
    // This ensures that if we're reformatting already-formatted content,
    // we remove the artifacts from previous formatting runs

    // Process chapter title first to get the expected header format
    const processedTitle = chapterTitle
        ? processChapterTitle(chapterTitle)
        : "";

    let cleaned = content;

    // Remove existing headers that match the processed title (with markdown headers or without)
    if (processedTitle) {
        const escapedTitle = escapeRegex(processedTitle);
        // Remove markdown headers (##, #, etc.) followed by the title
        cleaned = cleaned.replace(
            new RegExp(`^#+\\s*${escapedTitle}\\s*\\n*`, "gm"),
            ""
        );
        // Remove plain title at start of line
        cleaned = cleaned.replace(
            new RegExp(`^${escapedTitle}\\s*\\n*`, "gm"),
            ""
        );
    }

    // Also remove headers with "第X章" format (for backward compatibility)
    cleaned = cleaned
        .replace(/^#+\s*第[^章]*章[^\n]*\n*/gm, "")
        .replace(/^第[^章]*章[^\n]*\n*/gm, "")
        // Remove scene break markers from previous runs (if any)
        .replace(/___SCENE_BREAK_[123]___/g, "")
        // Remove indentation
        .replace(/^[ \t]+/gm, "")
        // Normalize excessive whitespace (but preserve scene breaks)
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();

    // Apply formatting (formatChapterContent is now idempotent)
    return formatChapterContent(
        cleaned,
        chapterTitle,
        convertToTraditional,
        detailedLog
    );
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
    cleanText,
    limitChapterName,
    processChapterTitle,
    truncateToMax,
};
