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

const FULL_WIDTH_DIGITS = "０１２３４５６７８９";
const DIGIT_PATTERN = `[零一二三四五六七八九十百千万两0-9${FULL_WIDTH_DIGITS}]`;
const BOOKNAME_CHAPTER_PATTERN = new RegExp(
    `(.+?)[（(](${DIGIT_PATTERN}+|終)[）)](.*)$`
);
const SITE_SUFFIX_PATTERNS = [
    /\s*[-－–—]\s*禁忌[书書]屋.*$/i,
    /\s*[-－–—]\s*禁忌[书書]坊.*$/i,
];

function stripSiteSuffix(title) {
    if (!title) return "";
    let result = title;
    for (const pattern of SITE_SUFFIX_PATTERNS) {
        result = result.replace(pattern, "");
    }
    return result.trim();
}

/**
 * Parse metadata from thread title/main-title text
 * @param {string} rawTitle
 * @returns {Object|null}
 */
function parseTitleMetadata(rawTitle) {
    if (!rawTitle || typeof rawTitle !== "string") {
        return null;
    }

    let title = normalizeToHalfWidth(rawTitle.trim());
    if (!title) {
        return null;
    }

    title = stripSiteSuffix(title);
    title = title.replace(/\s+/g, " ").trim();
    if (!title) {
        return null;
    }

    const metadata = {
        rawTitle: title,
        bookName: null,
        chapterNumber: null,
        chapterName: null,
        isFinal: false,
        series: "official",
    };

    const chapterInfo = extractChapterNumber(title);
    if (chapterInfo) {
        if (typeof chapterInfo.number === "number") {
            metadata.chapterNumber = chapterInfo.number;
        }
        metadata.series = chapterInfo.series || "official";
        metadata.isFinal = !!chapterInfo.isFinal;
    }

    const booknameMatch = title.match(BOOKNAME_CHAPTER_PATTERN);
    if (booknameMatch) {
        const candidateBookName = normalizeToHalfWidth(booknameMatch[1].trim());
        if (candidateBookName) {
            metadata.bookName = candidateBookName;
        }

        const candidateChapterName = (booknameMatch[3] || "").trim();
        if (candidateChapterName) {
            metadata.chapterName = candidateChapterName;
        }
    }

    // If we didn't get bookname/chaptername from parentheses pattern, try extracting from chapter marker
    if (!metadata.bookName && chapterInfo?.fullMatch) {
        const matchIndex = title.indexOf(chapterInfo.fullMatch);
        if (matchIndex > 0) {
            const before = title.slice(0, matchIndex).trim();
            if (before) {
                metadata.bookName = before;
            }
            const after = title
                .slice(matchIndex + chapterInfo.fullMatch.length)
                .trim();
            if (after && !metadata.chapterName) {
                metadata.chapterName = after;
            }
        }
    }

    // Also try pattern: bookname 第一章 chaptername (without parentheses)
    if (!metadata.bookName || !metadata.chapterName) {
        // Pattern: (bookname) 第X章 (chaptername)
        const chapterMarkerPattern = new RegExp(
            `第(${DIGIT_PATTERN}+)(章|回|集|話|篇|部|卷)`
        );
        const chapterMatch = title.match(chapterMarkerPattern);
        if (chapterMatch) {
            const matchIndex = title.indexOf(chapterMatch[0]);
            if (matchIndex > 0 && !metadata.bookName) {
                const before = title.slice(0, matchIndex).trim();
                if (before) {
                    metadata.bookName = before;
                }
            }
            if (!metadata.chapterName) {
                const after = title
                    .slice(matchIndex + chapterMatch[0].length)
                    .trim();
                if (after) {
                    metadata.chapterName = after;
                }
            }
        }
    }

    // Return metadata if we have at least a chapter number
    // Don't return null just because bookname/chaptername are missing
    if (
        metadata.chapterNumber !== null &&
        metadata.chapterNumber !== undefined
    ) {
        return metadata;
    }

    // If no chapter number but we have bookname or chaptername, still return it
    if (metadata.bookName || metadata.chapterName) {
        return metadata;
    }

    return null;
}

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
 * Uses simple pattern for detection, old pattern for bookname/author extraction
 * @param {string} content - File content
 * @returns {Array<Object>} - Array of chapter objects {number, title, startLine, endLine, content}
 */
function detectChapters(content, options = {}) {
    const { firstChapterMetadata = null } = options || {};
    if (!content) return [];

    const lines = content.split("\n");
    const chapters = [];
    let currentChapter = null;
    let currentChapterLines = [];
    let lineNumber = 0;

    // Track seen chapter numbers per series to avoid duplicates (only use first instance)
    // Key format: "series:number" or "series:終"
    const seenChapterNumbers = new Set();
    // Track chapters by series and number for clash handling
    const chaptersByKey = new Map();
    // Track pending replacement for official series (only one at a time since we process sequentially)
    let activePendingReplacement = null; // {key, chapter, lines}

    const chapterMarkerPattern = new RegExp(
        `第(${DIGIT_PATTERN}+)(章|回|集|話|篇|部|卷)`
    );

    // Simple pattern: （1） （2） etc. - used for chapter detection
    // Also matches patterns like "（黑暗 4）" where there's text before the number
    // Also matches Chinese numbers like "（一）" or "（二）"
    // Allow matching anywhere in the line, not just at start
    const simplePattern = new RegExp(
        `[（(][^）)]*?(${DIGIT_PATTERN}+)[）)]`,
        "u"
    );

    // Patterns for extracting bookname and chapter info (old pattern)
    // Pattern 1: bookname (chapterNo.) [chapterName] - e.g., "我們的風箏線（3）騙子" or "妻的風箏線（２）" or "妻的風箏線（終）宴"
    // Include full-width digits: ０１２３４５６７８９
    // Allow matching anywhere in the line, not just at start
    const booknameChapterPattern = BOOKNAME_CHAPTER_PATTERN;

    // Helper function to find next available chapter number in a series
    function findNextAvailableNumber(series, startNumber) {
        let candidate = startNumber;
        while (true) {
            const key = `${series}:${candidate}`;
            if (!seenChapterNumbers.has(key)) {
                return candidate;
            }
            candidate++;
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Step 1: Use simple pattern to detect if this line is a chapter header
        let isChapterHeader = false;
        let detectedChapterNum = null;
        const simpleMatch = line.match(simplePattern);
        const chapterMarkerMatch = line.match(chapterMarkerPattern);
        if (simpleMatch || chapterMarkerMatch) {
            // Try to extract numeric value (works for Arabic digits)
            let chapterNum = 0;
            if (simpleMatch) {
                chapterNum = parseInt(simpleMatch[1], 10);
            } else if (chapterMarkerMatch) {
                chapterNum = parseInt(chapterMarkerMatch[1], 10);
            }

            // If we matched a pattern, it's a chapter header (even if parseInt failed for Chinese numbers)
            // extractChapterNumber will handle Chinese number conversion later
            if (!isNaN(chapterNum) && chapterNum > 0) {
                detectedChapterNum = chapterNum;
            }
            isChapterHeader = true;

            // Debug: log when we detect a potential chapter header
            logger.info("Simple pattern detected chapter header", {
                line: trimmedLine.substring(0, 100),
                lineNumber: lineNumber + 1,
                detectedChapterNum,
                Matched: simpleMatch ? simpleMatch[0] : chapterMarkerMatch[0],
                fullLine: line,
            });
        } else if (trimmedLine.includes("（") && trimmedLine.includes("）")) {
            // Log lines with parentheses that didn't match simple pattern
            logger.info("Line with parentheses but no simple pattern match", {
                line: trimmedLine.substring(0, 100),
                lineNumber: lineNumber + 1,
            });

            // if we found this, this is not a chapter header
            isChapterHeader = false;
            //we will consider it is still part of the last chapter
            currentChapterLines.push(line);
            continue;
        }

        // Step 2: If chapter detected, use old pattern to extract bookname/author info
        let chapterInfo = null;
        let extractedBookName = null;
        let chapterName = null;
        let booknameMatch = null; // Declare outside if block for logging

        if (isChapterHeader) {
            logger.info("Processing chapter header", {
                line: trimmedLine.substring(0, 100),
                lineNumber: lineNumber + 1,
                detectedChapterNum,
            });
            // Try to extract bookname and chapter info using old pattern
            booknameMatch = line.match(booknameChapterPattern);
            logger.info("booknameMatch result", {
                line: trimmedLine.substring(0, 100),
                hasMatch: !!booknameMatch,
                match: booknameMatch ? booknameMatch[0] : null,
            });
            if (booknameMatch) {
                extractedBookName = normalizeToHalfWidth(
                    booknameMatch[1].trim()
                );
                const chapterNumStr = booknameMatch[2].trim();
                chapterName = (booknameMatch[3] || "").trim(); // Handle optional chapter name

                // If it's "終", extract it directly; otherwise extract the number
                if (chapterNumStr === "終") {
                    chapterInfo = extractChapterNumber("（終）");
                } else {
                    // FIX: Pass the full parentheses content to extractChapterNumber
                    // so it can extract series names like "（黑暗 4）"
                    const fullParenthesesMatch = line.match(/[（(].*?[）)]/);
                    if (fullParenthesesMatch) {
                        // Pass the full parentheses content including series name
                        chapterInfo = extractChapterNumber(
                            fullParenthesesMatch[0]
                        );
                    } else {
                        // Fallback to just the number if no parentheses found
                        chapterInfo = extractChapterNumber(
                            `（${chapterNumStr}）`
                        );
                    }
                }
            } else {
                // No booknameMatch - this happens when line is just "（黑暗 4）" or similar
                // Try to extract directly from the line to get series info
                logger.info(
                    "No booknameMatch, trying extractChapterNumber on full line",
                    {
                        line: trimmedLine.substring(0, 100),
                        lineNumber: lineNumber + 1,
                    }
                );
                chapterInfo = extractChapterNumber(line);
                logger.info("extractChapterNumber result", {
                    line: trimmedLine.substring(0, 100),
                    chapterInfo: chapterInfo
                        ? {
                              number: chapterInfo.number,
                              series: chapterInfo.series,
                              format: chapterInfo.format,
                              isFinal: chapterInfo.isFinal,
                          }
                        : null,
                });

                // If that didn't work, try other patterns
                if (
                    !chapterInfo ||
                    (chapterInfo.number <= 0 && !chapterInfo.isFinal)
                ) {
                    const chapterPatterns = [
                        /第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/,
                        /[（(【〔〖〝「『][零一二三四五六七八九十百千万两0-9]+[）)】〕〗〞」』](?=\s*(?:章|回|集|話|篇|部|卷|$|\s|：|:))/,
                        /第[零一二三四五六七八九十百千万两0-9]+(?=\s*(?:章|回|集|話|篇|部|卷|$|\s|：|:))/,
                        /#{1,3}\s*第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/, // Markdown headers
                    ];
                    for (const pattern of chapterPatterns) {
                        if (pattern.test(line)) {
                            chapterInfo = extractChapterNumber(line);
                            if (
                                chapterInfo &&
                                (chapterInfo.number > 0 || chapterInfo.isFinal)
                            ) {
                                break;
                            }
                        }
                    }
                }
            }

            // If we still didn't get chapterInfo, try extracting from full line
            // This catches series names in parentheses like "（黑暗 4）"
            if (!chapterInfo && detectedChapterNum) {
                // Try to extract from full line first to get series info
                chapterInfo = extractChapterNumber(line);
                // Only fallback to basic info if extractChapterNumber returns null
                if (!chapterInfo) {
                    chapterInfo = {
                        number: detectedChapterNum,
                        format: "章",
                        series: "official",
                        isFinal: false,
                    };
                }
            }
        }

        if (isChapterHeader && chapterInfo) {
            // Create a unique key for this chapter number including series
            // For "終" chapters, use a special key since number is -1 initially
            let series = chapterInfo.series || "official";
            let chapterNumber = chapterInfo.number;
            let chapterKey = chapterInfo.isFinal
                ? `${series}:終`
                : `${series}:${chapterNumber}`;

            // Debug logging for chapter detection
            logger.info("Chapter detected and processed", {
                line: trimmedLine.substring(0, 100), // First 100 chars
                lineNumber: lineNumber + 1,
                detectedChapterNum,
                chapterInfo: {
                    number: chapterNumber,
                    series: series,
                    format: chapterInfo.format,
                    isFinal: chapterInfo.isFinal,
                },
                chapterKey,
                hasBooknameMatch: !!booknameMatch,
                extractedBookName: extractedBookName || null,
            });

            // Handle clashes
            if (seenChapterNumbers.has(chapterKey)) {
                // Check if this is official series (merge) or unofficial (shift)
                if (series === "official") {
                    // Official series: we'll compare content lengths later and keep longer version
                    // For now, start collecting this chapter as a potential replacement
                    // Save previous chapter if exists
                    if (currentChapter) {
                        currentChapter.endLine = lineNumber - 1;
                        currentChapter.content = currentChapterLines.join("\n");
                        chapters.push(currentChapter);
                        // Store in map for clash handling
                        const prevKey = currentChapter.isFinal
                            ? `${currentChapter.series}:終`
                            : `${currentChapter.series}:${currentChapter.number}`;
                        chaptersByKey.set(prevKey, currentChapter);
                    }

                    // Start collecting lines for potential replacement chapter
                    let title = normalizeChapterTitle(trimmedLine);
                    let extractedChapterName = chapterName || "";
                    if (extractedChapterName) {
                        title = extractedChapterName;
                    } else if (title) {
                        const nameMatch = title.match(/第[^章]*章\s*(.+)$/);
                        if (nameMatch && nameMatch[1]) {
                            extractedChapterName = nameMatch[1].trim();
                        }
                    }

                    let formattedTitle = chapterInfo.isFinal
                        ? `終章`
                        : `第${chapterNumber}章`;

                    const replacementChapter = {
                        number: chapterNumber,
                        series: series,
                        title: formattedTitle,
                        titleSimplified: formattedTitle,
                        name: extractedChapterName || "",
                        startLine: lineNumber,
                        endLine: null,
                        content: "",
                        lineStart: lineNumber + 1,
                        lineEnd: null,
                        extractedBookName: extractedBookName,
                        isFinal: chapterInfo.isFinal || false,
                    };

                    activePendingReplacement = {
                        key: chapterKey,
                        chapter: replacementChapter,
                        lines: [line],
                    };

                    currentChapter = null;
                    currentChapterLines = [];
                    lineNumber++;
                    continue;
                } else {
                    // Unofficial series: shift to next available number
                    chapterNumber = findNextAvailableNumber(
                        series,
                        chapterNumber
                    );
                    chapterKey = `${series}:${chapterNumber}`;
                    // Update chapterInfo with new number
                    chapterInfo.number = chapterNumber;
                }
            }

            // If we have an active pending replacement, finish it first (we're starting a new chapter)
            if (activePendingReplacement) {
                const { key, chapter, lines } = activePendingReplacement;
                const existingChapter = chaptersByKey.get(key);
                if (existingChapter) {
                    // Finish the pending chapter (end before this new chapter starts)
                    chapter.endLine = lineNumber - 1;
                    chapter.content = lines.join("\n");
                    chapter.lineEnd = lineNumber;

                    const existingLength = existingChapter.content
                        ? existingChapter.content.length
                        : 0;
                    const newLength = chapter.content
                        ? chapter.content.length
                        : 0;

                    if (newLength > existingLength) {
                        // Replace existing chapter with new one
                        const existingIndex = chapters.findIndex((ch) => {
                            const chKey = ch.isFinal
                                ? `${ch.series}:終`
                                : `${ch.series}:${ch.number}`;
                            return chKey === key;
                        });
                        if (existingIndex !== -1) {
                            chapters[existingIndex] = chapter;
                            chaptersByKey.set(key, chapter);
                        }
                    }
                    // If existing is longer or equal, discard the new one (do nothing)
                }
                activePendingReplacement = null;
            }

            // Mark this chapter number as seen
            seenChapterNumbers.add(chapterKey);

            // Save previous chapter if exists
            if (currentChapter) {
                currentChapter.endLine = lineNumber - 1;
                currentChapter.content = currentChapterLines.join("\n");
                chapters.push(currentChapter);
                // Store in map for clash handling
                const prevKey = currentChapter.isFinal
                    ? `${currentChapter.series}:終`
                    : `${currentChapter.series}:${currentChapter.number}`;
                chaptersByKey.set(prevKey, currentChapter);
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

            // Format chapter title as "第一章", "第二章" etc.
            let formattedTitle = chapterInfo.isFinal
                ? `終章`
                : `第${chapterNumber}章`;

            currentChapter = {
                number: chapterNumber,
                series: series,
                title: formattedTitle,
                titleSimplified: formattedTitle,
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
        } else if (activePendingReplacement) {
            // Add line to active pending replacement
            activePendingReplacement.lines.push(line);
        }

        lineNumber++;
    }

    // Save last chapter
    if (currentChapter) {
        currentChapter.endLine = lineNumber - 1;
        currentChapter.content = currentChapterLines.join("\n");
        chapters.push(currentChapter);
        // Store in map for clash handling
        const lastKey = currentChapter.isFinal
            ? `${currentChapter.series}:終`
            : `${currentChapter.series}:${currentChapter.number}`;
        chaptersByKey.set(lastKey, currentChapter);
    }

    // Handle final pending replacement if exists (end of file)
    if (activePendingReplacement) {
        const { key, chapter, lines } = activePendingReplacement;
        const existingChapter = chaptersByKey.get(key);
        if (existingChapter) {
            // Finish the pending chapter
            chapter.endLine = lineNumber - 1;
            chapter.content = lines.join("\n");
            chapter.lineEnd = lineNumber;

            const existingLength = existingChapter.content
                ? existingChapter.content.length
                : 0;
            const newLength = chapter.content ? chapter.content.length : 0;

            if (newLength > existingLength) {
                // Replace existing chapter with new one
                const existingIndex = chapters.findIndex((ch) => {
                    const chKey = ch.isFinal
                        ? `${ch.series}:終`
                        : `${ch.series}:${ch.number}`;
                    return chKey === key;
                });
                if (existingIndex !== -1) {
                    chapters[existingIndex] = chapter;
                    chaptersByKey.set(key, chapter);
                }
            }
            // If existing is longer or equal, discard the new one (do nothing)
        }
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

    // Keep "終" chapters as -1 (do not convert to max chapter number + 1)
    // Final chapters will remain with number: -1 and isFinal: true

    if (firstChapterMetadata && chapters.length > 0) {
        const first = chapters[0];
        if (firstChapterMetadata.bookName) {
            first.extractedBookName = firstChapterMetadata.bookName;
        }
        if (
            typeof firstChapterMetadata.chapterNumber === "number" &&
            firstChapterMetadata.chapterNumber !== 0 &&
            firstChapterMetadata.chapterNumber !== null &&
            firstChapterMetadata.chapterNumber !== undefined
        ) {
            first.number = firstChapterMetadata.chapterNumber;
        }
        if (firstChapterMetadata.chapterName && !first.name) {
            first.name = firstChapterMetadata.chapterName;
        }
        if (firstChapterMetadata.series) {
            first.series = firstChapterMetadata.series;
        }
        if (firstChapterMetadata.isFinal) {
            first.isFinal = true;
        }
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

        // Extract metadata from content (author, etc.)
        const metadata = extractMetadata(content);

        // Normalize book name: convert full-width English to half-width
        const normalizedBookName = bookName
            ? normalizeToHalfWidth(bookName.trim())
            : normalizeToHalfWidth(
                  originalFilename.replace(/\.[^/.]+$/, "").trim()
              );

        // Detect chapters - always use simple pattern for detection, old pattern for extraction
        let chapters = detectChapters(content);

        // If book name not found, try to extract from first chapter's extractedBookName
        if ((!bookName || bookName.length < 2) && chapters.length > 0) {
            const firstChapter = chapters[0];
            if (firstChapter.extractedBookName) {
                bookName = firstChapter.extractedBookName;
                // Re-normalize with extracted book name
                const renormalizedBookName = normalizeToHalfWidth(
                    bookName.trim()
                );
                if (renormalizedBookName && renormalizedBookName.length >= 2) {
                    // Re-detect chapters if we found book name
                    chapters = detectChapters(content);
                }
            }
        }

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
                    metadata.author = match[1].trim().slice(0, 20);
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
    parseTitleMetadata,
    extractBookNameFromFilename,
    extractMetadata,
};
