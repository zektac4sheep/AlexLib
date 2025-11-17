/**
 * File Analyzer Service
 * Analyzes uploaded files to extract book information and detect chapters
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { detectBookName } = require("./bookDetector");
const {
    extractChapterNumber,
    normalizeChapterTitle,
} = require("./chapterExtractor");
const { normalizeToHalfWidth } = require("./converter");
const logger = require("../utils/logger");

/**
 * Extract book name from filename
 * @param {string} filename - Original filename
 * @returns {string|null} - Detected book name or null
 */
function extractBookNameFromFilename(filename) {
    if (!filename) return null;

    // Remove extension
    const nameWithoutExt = path.basename(filename, path.extname(filename));

    // Try to detect book name using bookDetector patterns
    const detected = detectBookName(nameWithoutExt);
    if (detected) {
        return detected;
    }

    // Fallback: remove common patterns and use as book name
    let bookName = nameWithoutExt
        .replace(
            /第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/g,
            ""
        )
        .replace(/[（(【〔〖〝「『].*?[）)】〕〗〞」』]/g, "")
        .replace(/\s*[-－]\s*/g, " ")
        .trim();

    // Remove file upload suffixes (e.g., "file-1234567890")
    bookName = bookName.replace(/^file-\d+-/, "");

    // Normalize full-width English and numbers to half-width
    bookName = normalizeToHalfWidth(bookName.trim());

    return bookName.length >= 2 ? bookName : null;
}

/**
 * Read and parse file content based on file type
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} - Plain text content
 */
async function readFileContent(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, "utf-8");

    if (ext === ".html" || ext === ".htm") {
        // Parse HTML and extract text
        const $ = cheerio.load(content);
        // Remove script and style elements
        $("script, style").remove();
        // Get text content
        return $("body").text() || $.text();
    } else if (ext === ".md" || ext === ".txt") {
        return content;
    }

    return content;
}

/**
 * Detect chapters in text content
 * @param {string} content - File content
 * @returns {Array<Object>} - Array of chapter objects {number, title, startLine, endLine, content}
 */
function detectChapters(content) {
    if (!content) return [];

    const lines = content.split("\n");
    const chapters = [];
    let currentChapter = null;
    let currentChapterLines = [];
    let lineNumber = 0;

    // Patterns for chapter headers
    // Pattern 1: bookname (chapterNo.) chapterName - e.g., "我們的風箏線（3）騙子"
    // Include full-width digits: ０１２３４５６７８９
    const fullWidthDigits = "０１２３４５６７８９";
    const digitPattern = `[零一二三四五六七八九十百千万两0-9${fullWidthDigits}]`;
    const booknameChapterPattern = new RegExp(
        `^(.+?)[（(](${digitPattern}+)[）)](.+)$`
    );

    const chapterPatterns = [
        /^第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/,
        /^[（(【〔〖〝「『][零一二三四五六七八九十百千万两0-9]+[）)】〕〗〞」』](?=\s*(?:章|回|集|話|篇|部|卷|$|\s|：|:))/,
        /^第[零一二三四五六七八九十百千万两0-9]+(?=\s*(?:章|回|集|話|篇|部|卷|$|\s|：|:))/,
        /^#{1,3}\s*第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/, // Markdown headers
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Check if this line is a chapter header
        let isChapterHeader = false;
        let chapterInfo = null;
        let extractedBookName = null;
        let chapterName = null;

        // First check for bookname (chapterNo.) chapterName format
        const booknameMatch = trimmedLine.match(booknameChapterPattern);
        if (booknameMatch) {
            extractedBookName = normalizeToHalfWidth(booknameMatch[1].trim());
            const chapterNumStr = booknameMatch[2].trim();
            chapterName = booknameMatch[3].trim();

            // Extract chapter number
            chapterInfo = extractChapterNumber(`（${chapterNumStr}）`);
            if (chapterInfo && (chapterInfo.number > 0 || chapterInfo.isFinal)) {
                isChapterHeader = true;
            }
        }

        // If not matched, try other patterns
        if (!isChapterHeader) {
            for (const pattern of chapterPatterns) {
                if (pattern.test(trimmedLine)) {
                    chapterInfo = extractChapterNumber(trimmedLine);
                    if (chapterInfo && (chapterInfo.number > 0 || chapterInfo.isFinal)) {
                        isChapterHeader = true;
                        break;
                    }
                }
            }
        }

        if (isChapterHeader && chapterInfo) {
            // Save previous chapter if exists
            if (currentChapter) {
                currentChapter.endLine = lineNumber - 1;
                currentChapter.content = currentChapterLines.join("\n");
                chapters.push(currentChapter);
            }

            // Start new chapter
            let title = normalizeChapterTitle(trimmedLine);

            // Extract chapter name (the part after chapter number)
            let extractedChapterName = chapterName || ""; // Use already extracted name if available

            // If we extracted bookname and chapter name separately, use chapter name as title
            if (extractedChapterName) {
                title = extractedChapterName;
            } else if (title) {
                // Try to extract name from title like "第3章 章节名" or "第三章 章节名"
                const nameMatch = title.match(/第[^章]*章\s*(.+)$/);
                if (nameMatch && nameMatch[1]) {
                    extractedChapterName = nameMatch[1].trim();
                }
            }

            currentChapter = {
                number: chapterInfo.number,
                title:
                    title ||
                    (chapterInfo.isFinal 
                        ? `終${chapterInfo.format || "章"}`
                        : `第${chapterInfo.number}${chapterInfo.format || "章"}`),
                titleSimplified: title,
                name: extractedChapterName || "", // Store chapter name separately
                startLine: lineNumber,
                endLine: null,
                content: "",
                lineStart: lineNumber + 1, // 1-indexed for database
                lineEnd: null,
                extractedBookName: extractedBookName, // Store extracted book name
                isFinal: chapterInfo.isFinal || false, // Preserve isFinal flag
            };
            currentChapterLines = [line];
        } else if (currentChapter) {
            // Add line to current chapter
            currentChapterLines.push(line);
        }

        lineNumber++;
    }

    // Save last chapter
    if (currentChapter) {
        currentChapter.endLine = lineNumber - 1;
        currentChapter.content = currentChapterLines.join("\n");
        chapters.push(currentChapter);
    }

    // If no chapters detected, treat entire file as one chapter
    if (chapters.length === 0) {
        chapters.push({
            number: 1,
            title: "第一章",
            titleSimplified: "第一章",
            startLine: 0,
            endLine: lines.length - 1,
            content: content,
            lineStart: 1,
            lineEnd: lines.length,
        });
    }

    // Update lineEnd for all chapters
    chapters.forEach((chapter, index) => {
        if (chapter.endLine === null) {
            chapter.endLine =
                index < chapters.length - 1
                    ? chapters[index + 1].startLine - 1
                    : lines.length - 1;
        }
        // Set lineEnd (1-indexed) if not already set
        if (chapter.lineEnd === null || chapter.lineEnd === undefined) {
            chapter.lineEnd = chapter.endLine + 1; // 1-indexed
        }
        if (!chapter.content) {
            const chapterLines = lines.slice(
                chapter.startLine,
                chapter.endLine + 1
            );
            chapter.content = chapterLines.join("\n");
        }
    });

    // Handle "終" chapters: convert to max chapter number + 1
    const finalChapters = chapters.filter(ch => ch.isFinal === true && ch.number === -1);
    if (finalChapters.length > 0) {
        // Find max chapter number (excluding final chapters)
        const regularChapters = chapters.filter(ch => !ch.isFinal || ch.number !== -1);
        const maxChapterNumber = regularChapters.length > 0
            ? Math.max(...regularChapters.map(ch => ch.number || 0))
            : 0;
        
        // Set final chapters to max + 1
        finalChapters.forEach(ch => {
            ch.number = maxChapterNumber + 1;
            ch.isFinal = false; // Clear flag after conversion
        });
    }

    return chapters;
}

/**
 * Analyze uploaded file
 * @param {string} filePath - Path to uploaded file
 * @param {string} originalFilename - Original filename
 * @returns {Promise<Object>} - Analysis result with book info and chapters
 */
async function analyzeFile(filePath, originalFilename) {
    try {
        // Read file content
        const content = await readFileContent(filePath);

        // Extract book name from filename
        let bookName = extractBookNameFromFilename(originalFilename);

        // Try to extract from first few lines of content if not found in filename
        if (!bookName || bookName.length < 2) {
            const firstLines = content.split("\n").slice(0, 10).join("\n");
            bookName = detectBookName(firstLines) || bookName;
        }

        // Detect chapters
        const chapters = detectChapters(content);

        // If book name not found, try to extract from first chapter's extractedBookName
        if ((!bookName || bookName.length < 2) && chapters.length > 0) {
            const firstChapter = chapters[0];
            if (firstChapter.extractedBookName) {
                bookName = firstChapter.extractedBookName;
            }
        }

        // Extract metadata from content (author, etc.)
        const metadata = extractMetadata(content);

        // Normalize book name: convert full-width English to half-width
        const normalizedBookName = bookName
            ? normalizeToHalfWidth(bookName.trim())
            : normalizeToHalfWidth(
                  originalFilename.replace(/\.[^/.]+$/, "").trim()
              );

        return {
            bookName: normalizedBookName,
            bookNameSimplified: normalizedBookName,
            metadata: metadata,
            chapters: chapters,
            totalChapters: chapters.length,
            fileSize: fs.statSync(filePath).size,
        };
    } catch (error) {
        logger.error("Error analyzing file", { filePath, error });
        throw error;
    }
}

/**
 * Extract metadata from content (author, description, etc.)
 * @param {string} content - File content
 * @returns {Object} - Metadata object
 */
function extractMetadata(content) {
    const metadata = {};
    const lines = content.split("\n").slice(0, 100); // Check first 100 lines for metadata

    // Look for author patterns
    const authorPatterns = [
        /作者[：:]\s*(.+)/,
        /作者\s*[：:]\s*(.+)/,
        /^(.+?)\s*[著編]/,
    ];

    for (const line of lines) {
        // Extract author
        if (!metadata.author) {
            for (const pattern of authorPatterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    metadata.author = match[1].trim();
                    break;
                }
            }
        }

        // Extract category/type
        if (!metadata.category) {
            const categoryMatch = line.match(
                /分類[：:]\s*(.+)|類型[：:]\s*(.+)|類別[：:]\s*(.+)/
            );
            if (categoryMatch) {
                metadata.category = (
                    categoryMatch[1] ||
                    categoryMatch[2] ||
                    categoryMatch[3]
                )?.trim();
            }
        }

        // Extract description (usually in metadata block or first paragraph)
        if (!metadata.description) {
            // Look for description patterns
            const descMatch = line.match(
                /簡介[：:]\s*(.+)|描述[：:]\s*(.+)|內容[：:]\s*(.+)/
            );
            if (descMatch) {
                metadata.description = (
                    descMatch[1] ||
                    descMatch[2] ||
                    descMatch[3]
                )?.trim();
            }
        }

        // Extract source URL if present
        if (!metadata.sourceUrl) {
            const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                metadata.sourceUrl = urlMatch[1].trim();
            }
        }
    }

    return metadata;
}

module.exports = {
    analyzeFile,
    detectChapters,
    extractBookNameFromFilename,
    extractMetadata,
};
