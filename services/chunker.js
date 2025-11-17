/**
 * Chunker Service
 * Splits master file into chunks (~1000 lines each)
 * Preserves TOC and chapter headers in each chunk
 *
 * CHUNKING PROCESS (createChunksFromChapters):
 * =============================================
 * The chunking process consists of the following steps:
 *
 * 1. Input Validation - Check if chapters array is valid and non-empty
 * 2. Sort Chapters - Sort chapters by series (official, 番外, doujinshii) then by chapter number
 *    - Regular chapters sorted ascending
 *    - Final chapters (-1) placed at the end of their series
 * 3. Generate TOC - Create full table of contents from all sorted chapters
 * 4. Build Chunks - Iterate through chapters and group them into chunks:
 *    a. For each chapter, check if adding it would exceed chunk size
 *    b. If chunk would exceed size and chunk is not empty, finalize current chunk:
 *       - Join chapter contents with separators
 *       - Process chunk content (add "# " headers for first occurrence of each chapter)
 *       - Calculate line ranges (1-indexed)
 *       - Determine first and last chapter numbers in chunk
 *       - Add TOC, metadata, and book title to chunk
 *       - Convert to Traditional Chinese
 *       - Create chunk object with metadata
 *    c. Add chapter to current chunk (with separator if needed)
 *    d. Track chapter line counts and positions
 * 5. Finalize Last Chunk - Process and finalize the last chunk if it has content
 * 6. Update Total Chunks - Update totalChunks count in all chunk objects and content strings
 * 7. Return Chunks - Return array of chunk objects with content and metadata
 *
 * Each chunk object contains:
 * - content: Formatted chunk content with TOC and metadata
 * - lineStart: Starting line number (1-indexed)
 * - lineEnd: Ending line number (1-indexed)
 * - chunkNumber: Chunk number (1-indexed)
 * - totalChunks: Total number of chunks
 * - chaptersInChunk: Array of chapter info in this chunk
 * - firstChapter: First chapter number in chunk
 * - lastChapter: Last chapter number in chunk
 * - chapterCount: Number of chapters in chunk
 */

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "1000");
const converter = require("./converter");
const textProcessor = require("./textProcessor");
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

// Debug log enable for each step
// for each phase
const debugChunkerSteps = [];
// it's an array of boolean values, one for each step
// the index of the array corresponds to the step number
// all are initial to be false;
for (let i = 0; i < 7; i++) {
    debugChunkerSteps.push(false);
}

//step 0: Input Validation - Check if chapters array is valid and non-empty
//step 1: Sort Chapters - Sort chapters by series then by chapter number
//step 2: Generate TOC - Create full table of contents from all sorted chapters
//step 3: Build Chunks - Iterate through chapters and group them into chunks
//step 4: Finalize Last Chunk - Process and finalize the last chunk if it has content
//step 5: Update Total Chunks - Update totalChunks count in all chunk objects and content strings
//step 6: Return Chunks - Return array of chunk objects with content and metadata

const debug_chunker = true;

if (debug_chunker) {
    // Enable specific steps for debugging
    debugChunkerSteps[0] = true; // Input Validation
    debugChunkerSteps[1] = true; // Sort Chapters
    debugChunkerSteps[2] = true; // Generate TOC
    debugChunkerSteps[3] = true; // Build Chunks
    debugChunkerSteps[4] = true; // Finalize Last Chunk
    debugChunkerSteps[5] = true; // Update Total Chunks
    debugChunkerSteps[6] = true; // Return Chunks
} else {
    // all are false
    debugChunkerSteps[0] = false;
    debugChunkerSteps[1] = false;
    debugChunkerSteps[2] = false;
    debugChunkerSteps[3] = false;
    debugChunkerSteps[4] = false;
    debugChunkerSteps[5] = false;
    debugChunkerSteps[6] = false;
}

/**
 * Sort chapters: by series (official, 番外, doujinshii), then by chapter number
 * Regular chapters first (ascending), final chapters (-1) at the end
 * @param {Array} chapters - Array of chapter objects with chapterNumber and series properties
 * @returns {Array} - Sorted chapters
 */
function sortChaptersForExport(chapters) {
    if (!chapters || chapters.length === 0) {
        return chapters;
    }

    // Create a copy to avoid mutating the original
    const sorted = [...chapters];

    // Sort: by series first (official first, then alphabetically), then by chapter number
    sorted.sort((a, b) => {
        // Get series names (default to "official" if not set)
        const seriesA = a.series || "official";
        const seriesB = b.series || "official";

        // "official" always comes first
        if (seriesA === "official" && seriesB !== "official") {
            return -1;
        }
        if (seriesA !== "official" && seriesB === "official") {
            return 1;
        }

        // If both are "official", or both are not "official", sort alphabetically
        if (seriesA !== seriesB) {
            return seriesA.localeCompare(seriesB);
        }

        // Within same series, sort by chapter number
        const numA = a.chapterNumber ?? a.number ?? 0;
        const numB = b.chapterNumber ?? b.number ?? 0;

        // If both are -1, maintain original order
        if (numA === -1 && numB === -1) {
            return 0;
        }

        // -1 always goes to the end within the same series
        if (numA === -1) {
            return 1;
        }
        if (numB === -1) {
            return -1;
        }

        // Regular chapters: sort in ascending order
        return numA - numB;
    });

    return sorted;
}

/**
 * Generate Table of Contents from chapters
 * @param {Array} chapters - Array of chapter objects with {chapterNumber, chapterTitle}
 * @returns {string} - TOC markdown
 */
function generateTOC(chapters) {
    if (!chapters || chapters.length === 0) {
        return "";
    }

    let toc = "# 目錄\n\n";
    toc += "[[toc]]\n\n";
    toc += "## 章節目錄\n\n";

    chapters.forEach((chapter) => {
        const num = chapter.chapterNumber || "";
        let title = chapter.chapterTitle || "";
        const format = chapter.chapterFormat || "章";

        // Process chapter title: clean text and limit name length
        if (title) {
            title = textProcessor.processChapterTitle(title);
        }

        if (num && title) {
            toc += `- [第${num}${format} ${title}](#第${num}${format}-${title.replace(
                /\s+/g,
                "-"
            )})\n`;
        } else if (num) {
            toc += `- [第${num}${format}](#第${num}${format})\n`;
        }
    });

    toc += "\n---\n\n";
    return toc;
}

/**
 * Add TOC to chunk content
 * @param {string} chunkContent - Chunk content
 * @param {string} fullTOC - Full TOC markdown
 * @param {string} bookTitle - Book title
 * @param {Object} metadata - Additional metadata (author, category, description, etc.)
 * @param {Object} chunkInfo - Chunk information (chunkNumber, totalChunks, firstChapter, lastChapter, lineStart, lineEnd)
 * @returns {string} - Chunk with TOC
 */
function addTOCToChunk(
    chunkContent,
    fullTOC,
    bookTitle,
    metadata = {},
    chunkInfo = {}
) {
    if (!chunkContent) return "";

    let content = "";

    // First line: 【book_name】 (chapter_from - chapter_to) 作者：author_name
    if (bookTitle) {
        let chapterRange = "";
        if (chunkInfo.firstChapter !== null && chunkInfo.lastChapter !== null) {
            if (chunkInfo.firstChapter === chunkInfo.lastChapter) {
                chapterRange = `(${chunkInfo.firstChapter})`;
            } else {
                chapterRange = `(${chunkInfo.firstChapter} - ${chunkInfo.lastChapter})`;
            }
        }
        const authorPart = metadata.author ? ` 作者：${metadata.author}` : "";
        content += `【${bookTitle}】${chapterRange}${authorPart}\n\n`;
    }

    // Add metadata block
    if (metadata.author || metadata.category || metadata.description) {
        content += "---\n\n";
        if (metadata.author) {
            content += `**作者：** ${metadata.author}\n\n`;
        }
        if (metadata.category) {
            content += `**分類：** ${metadata.category}\n\n`;
        }
        if (metadata.description) {
            content += `**簡介：** ${metadata.description}\n\n`;
        }
        content += "---\n\n";
    }

    // Add chunk information
    if (chunkInfo.chunkNumber && chunkInfo.totalChunks) {
        content += `**分塊資訊：** 第 ${chunkInfo.chunkNumber} / ${chunkInfo.totalChunks} 塊\n\n`;
    }
    if (chunkInfo.firstChapter !== null && chunkInfo.lastChapter !== null) {
        if (chunkInfo.firstChapter === chunkInfo.lastChapter) {
            content += `**章節範圍：** 第 ${chunkInfo.firstChapter} 章\n\n`;
        } else {
            content += `**章節範圍：** 第 ${chunkInfo.firstChapter} 章 至 第 ${chunkInfo.lastChapter} 章\n\n`;
        }
    }
    if (chunkInfo.lineStart && chunkInfo.lineEnd) {
        content += `**行數範圍：** 第 ${chunkInfo.lineStart} 行 至 第 ${chunkInfo.lineEnd} 行\n\n`;
    }
    if (chunkInfo.chunkSize) {
        content += `**最大行數：** ${chunkInfo.chunkSize} 行\n\n`;
    }

    content += "---\n\n";

    // Add TOC
    if (fullTOC) {
        content += fullTOC;
    }

    // Add header after TOC for the first chapter in this chunk
    if (chunkInfo.firstChapterInChunk) {
        const firstChapter = chunkInfo.firstChapterInChunk;
        let chapterTitle = firstChapter.chapterTitle || "";

        // Process chapter title: clean text and limit name length
        chapterTitle = textProcessor.processChapterTitle(chapterTitle);

        const chapterName = chapterTitle.replace(/^第\d+章\s*/, "").trim();
        const series = firstChapter.series || "official";
        const seriesPrefix = series !== "official" ? `[${series}] ` : "";
        content += `【${bookTitle}】 (${firstChapter.chapterNumber}) ${seriesPrefix}${chapterName}\n\n`;
    }

    // Add chunk content
    content += chunkContent;

    return content;
}

/**
 * Split content into chunks
 * @param {string} masterContent - Master file content
 * @param {number} chunkSize - Lines per chunk (default: 1000)
 * @returns {Array<string>} - Array of chunk contents
 */
function chunkContent(masterContent, chunkSize = CHUNK_SIZE) {
    if (!masterContent) return [];

    const lines = masterContent.split("\n");
    const chunks = [];

    // If content is smaller than chunk size, return as single chunk
    if (lines.length <= chunkSize) {
        return [masterContent];
    }

    // Split into chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
        const chunkLines = lines.slice(i, i + chunkSize);
        chunks.push(chunkLines.join("\n"));
    }

    return chunks;
}

/**
 * Create chunks from chapters with TOC
 * Chapters remain intact - only starts new chunk when adding next chapter would exceed chunkSize
 * @param {Array} chapters - Array of chapter objects with {content, chapterNumber, chapterTitle}
 * @param {string} bookTitle - Book title
 * @param {number} chunkSize - Lines per chunk
 * @param {Object} metadata - Book metadata (author, category, description, etc.)
 * @param {boolean|undefined} detailedLog - Whether to enable detailed logging (overrides env var)
 * @returns {Array<Object>} - Array of chunk objects {content, lineStart, lineEnd, chunkNumber}
 */
function createChunksFromChapters(
    chapters,
    bookTitle,
    chunkSize = CHUNK_SIZE,
    metadata = {},
    detailedLog = undefined
) {
    // Step 0: Input Validation
    if (!chapters || chapters.length === 0) {
        if (debugChunkerSteps[0]) {
            logger.info(
                "[Chunker] Step 0: Input Validation - Empty or invalid chapters array"
            );
        }
        return [];
    }

    if (debugChunkerSteps[0]) {
        logger.info("[Chunker] Step 0: Input Validation", {
            totalChapters: chapters.length,
            chunkSize,
            bookTitle,
        });
    }

    const isDetailedLog = getDetailedLogFlag(detailedLog);

    if (isDetailedLog) {
        logger.debug("[Chunker] Starting chunk creation", {
            totalChapters: chapters.length,
            chunkSize,
            bookTitle,
        });
    }

    // Step 1: Sort Chapters
    const sortedChapters = sortChaptersForExport(chapters);
    if (debugChunkerSteps[1]) {
        logger.info("[Chunker] Step 1: Sort Chapters", {
            totalChapters: sortedChapters.length,
            chapterNumbers: sortedChapters.map((ch) => ({
                number: ch.chapterNumber ?? ch.number,
                series: ch.series || "official",
            })),
        });
        // print the chapter number one by one if in debug mode
        sortedChapters.forEach((chapter) => {
            logger.info("[Chunker] Step 1: Sort Chapters - Chapter number", {
                chapterNumber: chapter.chapterNumber,
            });
        });
    }

    // Step 2: Generate TOC
    const fullTOC = generateTOC(sortedChapters);
    if (debugChunkerSteps[2]) {
        logger.info("[Chunker] Step 2: Generate TOC", {
            tocLength: fullTOC.length,
            chapterCount: sortedChapters.length,
        });
    }

    // Step 3: Build Chunks
    const chunks = [];
    let currentChunkContent = [];
    let currentChunkChapters = [];
    let currentChunkLineCount = 0;
    let currentLineInMaster = 0;
    const seenChapters = new Set(); // Track which chapters have been seen across all chunks

    if (debugChunkerSteps[3]) {
        logger.info(
            "[Chunker] Step 3: Build Chunks - Starting to build chunks",
            {
                totalChapters: sortedChapters.length,
                chunkSize,
            }
        );
    }

    sortedChapters.forEach((chapter, chapterIndex) => {
        const chapterContent = chapter.content || "";
        const chapterLines = chapterContent.split("\n");
        const chapterLineCount = chapterLines.length;
        const needsSeparator = currentChunkContent.length > 0; // Need separator if chunk already has content
        const separatorLineCount = needsSeparator ? 1 : 0; // One empty line separator
        const totalLinesForChapter = chapterLineCount + separatorLineCount;

        // print the chapter number one by one if in debug mode
        if (debugChunkerSteps[3]) {
            logger.info("[Chunker] Step 3: Build Chunks - Chapter number", {
                chapterNumber: chapter.chapterNumber,
            });
        }

        // Check if adding this chapter would exceed chunk size
        // If current chunk is empty, always add the chapter (even if it's over chunkSize)
        // If current chunk has content and adding this chapter would exceed chunkSize, start new chunk
        const wouldExceed =
            currentChunkLineCount > 0 &&
            currentChunkLineCount + totalLinesForChapter > chunkSize;

        if (wouldExceed) {
            // Finalize current chunk
            const chunkContent = currentChunkContent.join("\n");
            const chunkNumber = chunks.length + 1;

            // Process chunk content to add "# " header for first occurrence of each chapter
            const processedChunk = processChunkContent(
                chunkContent,
                currentChunkChapters,
                seenChapters
            );

            // Calculate line ranges (1-indexed)
            const lineStart = currentLineInMaster - currentChunkLineCount + 1;
            const lineEnd = currentLineInMaster;

            // Determine first and last chapter numbers
            const chapterNumbers = currentChunkChapters
                .map((ch) => ch.chapterNumber)
                .filter(
                    (num) => num !== null && num !== undefined && num !== -1
                )
                .sort((a, b) => a - b);

            const firstChapter =
                chapterNumbers.length > 0 ? chapterNumbers[0] : null;
            const lastChapter =
                chapterNumbers.length > 0
                    ? chapterNumbers[chapterNumbers.length - 1]
                    : null;

            if (debugChunkerSteps[3]) {
                logger.info(
                    "[Chunker] Step 3: Build Chunks - Finalizing chunk",
                    {
                        chunkNumber,
                        firstChapter,
                        lastChapter,
                        chapterCount: currentChunkChapters.length,
                        lineStart,
                        lineEnd,
                        lineCount: currentChunkLineCount,
                    }
                );
            }

            // Get the first chapter in this chunk for the header
            const firstChapterInChunk =
                currentChunkChapters.length > 0
                    ? currentChunkChapters.find(
                          (ch) => ch.chapterNumber === firstChapter
                      ) || currentChunkChapters[0]
                    : null;

            // Add TOC and book title to chunk with metadata
            const chunkWithTOC = addTOCToChunk(
                processedChunk,
                fullTOC,
                bookTitle,
                metadata,
                {
                    chunkNumber: chunkNumber,
                    totalChunks: 0, // Will update later
                    firstChapter: firstChapter,
                    lastChapter: lastChapter,
                    lineStart: lineStart,
                    lineEnd: lineEnd,
                    chunkSize: chunkSize,
                    firstChapterInChunk: firstChapterInChunk,
                }
            );

            // Convert chunk content to Traditional Chinese
            const traditionalContent = converter.toTraditional(chunkWithTOC);

            chunks.push({
                content: traditionalContent,
                lineStart: lineStart,
                lineEnd: lineEnd,
                chunkNumber: chunkNumber,
                totalChunks: 0, // Will update later
                chaptersInChunk: currentChunkChapters.map((ch) => ({
                    chapterNumber: ch.chapterNumber,
                    chapterTitle: ch.chapterTitle,
                    lineStart: ch.lineStart,
                    lineEnd: ch.lineEnd,
                    originalStartLine: ch.originalStartLine,
                    originalEndLine: ch.originalEndLine,
                })),
                firstChapter: firstChapter,
                lastChapter: lastChapter,
                chapterCount: currentChunkChapters.length,
            });

            // Start new chunk
            currentChunkContent = [];
            currentChunkChapters = [];
            currentChunkLineCount = 0;
        }

        // Add chapter to current chunk
        // Add separator if needed (before adding chapter content)
        if (currentChunkContent.length > 0) {
            currentChunkContent.push(""); // Empty line separator
            currentChunkLineCount += 1;
            currentLineInMaster += 1;
        }

        // Track chapter start (0-indexed in master content)
        const chapterStartLineInMaster = currentLineInMaster;

        // Add chapter content
        currentChunkContent.push(chapterContent);

        // Track chapter info (1-indexed for display)
        currentChunkChapters.push({
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.chapterTitle,
            series: chapter.series || "official",
            lineStart: chapterStartLineInMaster + 1, // 1-indexed
            lineEnd: chapterStartLineInMaster + chapterLineCount, // 1-indexed
            originalStartLine: chapterStartLineInMaster, // 0-indexed
            originalEndLine: chapterStartLineInMaster + chapterLineCount - 1, // 0-indexed
        });

        // Update line counts
        currentChunkLineCount += chapterLineCount;
        currentLineInMaster += chapterLineCount;

        if (debugChunkerSteps[3]) {
            logger.info(
                "[Chunker] Step 3: Build Chunks - Added chapter to current chunk",
                {
                    chapterNumber: chapter.chapterNumber,
                    chapterTitle: chapter.chapterTitle,
                    chapterLineCount,
                    currentChunkLineCount,
                    chaptersInChunk: currentChunkChapters.length,
                }
            );
        }
    });

    // Step 4: Finalize Last Chunk
    if (currentChunkContent.length > 0) {
        const chunkContent = currentChunkContent.join("\n");
        const chunkNumber = chunks.length + 1;

        // Process chunk content to add "# " header for first occurrence of each chapter
        const processedChunk = processChunkContent(
            chunkContent,
            currentChunkChapters,
            seenChapters
        );

        // Calculate line ranges
        const lineStart = currentLineInMaster - currentChunkLineCount + 1; // 1-indexed
        const lineEnd = currentLineInMaster; // 1-indexed

        // Determine first and last chapter numbers
        const chapterNumbers = currentChunkChapters
            .map((ch) => ch.chapterNumber)
            .filter((num) => num !== null && num !== undefined && num !== -1)
            .sort((a, b) => a - b);

        const firstChapter =
            chapterNumbers.length > 0 ? chapterNumbers[0] : null;
        const lastChapter =
            chapterNumbers.length > 0
                ? chapterNumbers[chapterNumbers.length - 1]
                : null;

        if (debugChunkerSteps[4]) {
            logger.info("[Chunker] Step 4: Finalize Last Chunk", {
                chunkNumber,
                firstChapter,
                lastChapter,
                chapterCount: currentChunkChapters.length,
                lineStart,
                lineEnd,
                lineCount: currentChunkLineCount,
            });
        }

        // Get the first chapter in this chunk for the header
        const firstChapterInChunk =
            currentChunkChapters.length > 0
                ? currentChunkChapters.find(
                      (ch) => ch.chapterNumber === firstChapter
                  ) || currentChunkChapters[0]
                : null;

        // Add TOC and book title to chunk with metadata
        const chunkWithTOC = addTOCToChunk(
            processedChunk,
            fullTOC,
            bookTitle,
            metadata,
            {
                chunkNumber: chunkNumber,
                totalChunks: chunkNumber,
                firstChapter: firstChapter,
                lastChapter: lastChapter,
                lineStart: lineStart,
                lineEnd: lineEnd,
                chunkSize: chunkSize,
                firstChapterInChunk: firstChapterInChunk,
            }
        );

        // Convert chunk content to Traditional Chinese
        const traditionalContent = converter.toTraditional(chunkWithTOC);

        chunks.push({
            content: traditionalContent,
            lineStart: lineStart,
            lineEnd: lineEnd,
            chunkNumber: chunkNumber,
            totalChunks: chunkNumber,
            chaptersInChunk: currentChunkChapters.map((ch) => ({
                chapterNumber: ch.chapterNumber,
                chapterTitle: ch.chapterTitle,
                lineStart: ch.lineStart,
                lineEnd: ch.lineEnd,
                originalStartLine: ch.originalStartLine,
                originalEndLine: ch.originalEndLine,
            })),
            firstChapter: firstChapter,
            lastChapter: lastChapter,
            chapterCount: currentChunkChapters.length,
        });
    }

    // Step 5: Update Total Chunks
    const totalChunks = chunks.length;
    chunks.forEach((chunk) => {
        chunk.totalChunks = totalChunks;
        // Update the content string's totalChunks in the metadata
        // Replace pattern like "第 X / Y 塊" where Y needs to be updated
        const oldPattern = new RegExp(`第 ${chunk.chunkNumber} / \\d+ 塊`, "g");
        const newReplacement = `第 ${chunk.chunkNumber} / ${totalChunks} 塊`;
        chunk.content = chunk.content.replace(oldPattern, newReplacement);
    });

    if (debugChunkerSteps[5]) {
        logger.info("[Chunker] Step 5: Update Total Chunks", {
            totalChunks,
            chunks: chunks.map((ch) => ({
                chunkNumber: ch.chunkNumber,
                totalChunks: ch.totalChunks,
            })),
        });
    }

    if (isDetailedLog) {
        logger.info("[Chunker] Chunk creation completed", {
            totalChunks,
            chunks: chunks.map((ch) => ({
                chunkNumber: ch.chunkNumber,
                firstChapter: ch.firstChapter,
                lastChapter: ch.lastChapter,
                chapterCount: ch.chapterCount,
                lineStart: ch.lineStart,
                lineEnd: ch.lineEnd,
            })),
        });
    }

    // Step 6: Return Chunks
    if (debugChunkerSteps[6]) {
        logger.debug("[Chunker] Step 6: Return Chunks", {
            totalChunks,
            chunks: chunks.map((ch) => ({
                chunkNumber: ch.chunkNumber,
                firstChapter: ch.firstChapter,
                lastChapter: ch.lastChapter,
                chapterCount: ch.chapterCount,
                lineStart: ch.lineStart,
                lineEnd: ch.lineEnd,
            })),
        });
    }

    return chunks;
}

/**
 * Check if a line is a conversation/dialogue line
 * @param {string} line - Line to check
 * @returns {boolean} - True if line starts with dialogue markers
 */
function isConversationLine(line) {
    const trimmed = line.trim();
    // Check for Chinese quotation marks or regular quotes at start
    return (
        trimmed.startsWith("「") ||
        trimmed.startsWith("『") ||
        trimmed.startsWith('"') ||
        trimmed.startsWith("'")
    );
}

/**
 * Check if a line is a chapter header
 * @param {string} line - Line to check
 * @returns {boolean} - True if line is a chapter header
 */
function isChapterHeader(line) {
    const trimmed = line.trim();
    // Check for markdown headers (# or ##)
    if (trimmed.startsWith("#")) {
        return true;
    }
    // Check for chapter patterns like "## （N）" or "## 第N章"
    const chapterPattern = /^##\s*[（(]?\d+[）)]?/;
    return chapterPattern.test(trimmed);
}

/**
 * Process a dense text block by merging lines and adding breaks at punctuation
 * Each line should be at most maxLineLength characters, breaking at punctuation when possible
 * For blocks spanning multiple lines (5-7 lines), prefer breaking at punctuation from line 5 onwards
 * @param {string} mergedText - Merged text block (no newlines)
 * @param {number} maxLineLength - Maximum line length (default: 50)
 * @returns {Array<string>} - Array of processed lines with breaks
 */
function processDenseTextBlock(mergedText, maxLineLength = 50) {
    if (!mergedText || mergedText.trim().length === 0) {
        return [];
    }

    const result = [];
    let remainingText = mergedText.trim();
    const PREFERRED_PUNCTUATION = ["！", "。", "...", "…"];
    const FALLBACK_PUNCTUATION = [
        "，",
        "、",
        "；",
        "：",
        "？",
        "！",
        "。",
        ".",
        ",",
        ";",
        ":",
        "?",
    ];
    const LINE_5_START = maxLineLength * 4; // Start of line 5 (position 200)
    const LINE_7_END = maxLineLength * 7; // End of line 7 (position 350)

    while (remainingText.length > 0) {
        // If remaining text fits in one line, just add it
        if (remainingText.length <= maxLineLength) {
            if (remainingText.trim().length > 0) {
                result.push(remainingText.trim());
            }
            break;
        }

        // Find break point - default to maxLineLength
        let breakIndex = maxLineLength;

        // If we're processing a long block (past line 5), look for punctuation from line 5 to line 7
        if (remainingText.length > LINE_5_START) {
            const searchStart = LINE_5_START;
            const searchEnd = Math.min(remainingText.length, LINE_7_END);
            const searchText = remainingText.substring(searchStart, searchEnd);

            // First, try to find preferred punctuation (！。...) from line 5 onwards
            let latestPreferredIndex = -1;
            for (const punct of PREFERRED_PUNCTUATION) {
                const index = searchText.lastIndexOf(punct);
                if (index !== -1) {
                    const absoluteIndex = searchStart + index + punct.length;
                    // Must be at least at maxLineLength (we need to break at least at line 1)
                    if (absoluteIndex >= maxLineLength) {
                        if (
                            latestPreferredIndex === -1 ||
                            absoluteIndex > latestPreferredIndex
                        ) {
                            latestPreferredIndex = absoluteIndex;
                        }
                    }
                }
            }
            if (latestPreferredIndex !== -1) {
                breakIndex = latestPreferredIndex;
            } else {
                // If no preferred punctuation found, try fallback punctuation from line 5 to line 7
                let latestFallbackIndex = -1;
                for (const punct of FALLBACK_PUNCTUATION) {
                    const index = searchText.lastIndexOf(punct);
                    if (index !== -1) {
                        const absoluteIndex =
                            searchStart + index + punct.length;
                        if (absoluteIndex >= maxLineLength) {
                            if (
                                latestFallbackIndex === -1 ||
                                absoluteIndex > latestFallbackIndex
                            ) {
                                latestFallbackIndex = absoluteIndex;
                            }
                        }
                    }
                }
                if (latestFallbackIndex !== -1) {
                    breakIndex = latestFallbackIndex;
                } else {
                    // No punctuation found, break at maxLineLength (each line at 50 chars)
                    breakIndex = maxLineLength;
                }
            }
        } else {
            // For shorter blocks, break at maxLineLength but look for punctuation nearby
            // Search around maxLineLength for a good break point
            const searchStart = Math.max(0, maxLineLength - 15);
            const searchEnd = Math.min(
                remainingText.length,
                maxLineLength + 15
            );
            const searchText = remainingText.substring(searchStart, searchEnd);

            // Try preferred punctuation first
            let bestIndex = -1;
            for (const punct of PREFERRED_PUNCTUATION) {
                const index = searchText.lastIndexOf(punct);
                if (index !== -1) {
                    const absoluteIndex = searchStart + index + punct.length;
                    // Prefer punctuation close to maxLineLength
                    if (
                        absoluteIndex >= maxLineLength - 10 &&
                        absoluteIndex <= maxLineLength + 10
                    ) {
                        if (
                            bestIndex === -1 ||
                            Math.abs(absoluteIndex - maxLineLength) <
                                Math.abs(bestIndex - maxLineLength)
                        ) {
                            bestIndex = absoluteIndex;
                        }
                    }
                }
            }

            // If no preferred punctuation, try fallback
            if (bestIndex === -1) {
                for (const punct of FALLBACK_PUNCTUATION) {
                    const index = searchText.lastIndexOf(punct);
                    if (index !== -1) {
                        const absoluteIndex =
                            searchStart + index + punct.length;
                        if (
                            absoluteIndex >= maxLineLength - 10 &&
                            absoluteIndex <= maxLineLength + 10
                        ) {
                            if (
                                bestIndex === -1 ||
                                Math.abs(absoluteIndex - maxLineLength) <
                                    Math.abs(bestIndex - maxLineLength)
                            ) {
                                bestIndex = absoluteIndex;
                            }
                        }
                    }
                }
            }

            if (bestIndex !== -1) {
                breakIndex = bestIndex;
            }
            // Otherwise, breakIndex remains at maxLineLength
        }

        // Extract text before break
        const beforeBreak = remainingText.substring(0, breakIndex).trim();
        if (beforeBreak.length > 0) {
            result.push(beforeBreak);
        }

        // Add empty line after break
        result.push("");

        // Get remaining text
        remainingText = remainingText.substring(breakIndex).trim();
    }

    return result;
}

/**
 * Add line breaks for dense text
 * Dense text blocks are separated by:
 * 1. Conversation lines
 * 2. Chapter headers
 * 3. End of chapter (empty lines)
 *
 * For dense text blocks:
 * - Group text together without newlines
 * - Try to find preferred punctuation (！。...) from line 5 (if split by width limit)
 * - If can't find till line 7, also break at ， and any other punctuation
 * - After punctuation, add break (and empty line)
 * - Remaining block goes to another iteration until all are printed out
 *
 * For conversation blocks (more than one line):
 * - Only add one break before the first line of conversation
 *
 * @param {string} content - Content to process
 * @returns {string} - Content with added line breaks
 */
function addLineBreaksForDenseText(content) {
    if (!content) return content;

    const lines = content.split("\n");
    const processedLines = [];
    const MAX_LINE_LENGTH = 50; // Based on FormatGuide.md recommendation

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const isEmpty = line.trim().length === 0;
        const isConversation = isConversationLine(line);
        const isChapter = isChapterHeader(line);

        // Handle empty lines (end of chapter/block)
        if (isEmpty) {
            processedLines.push(line);
            i++;
            continue;
        }

        // Handle chapter headers
        if (isChapter) {
            processedLines.push(line);
            i++;
            continue;
        }

        // Handle conversation blocks
        if (isConversation) {
            // Check if this is the start of a conversation block (multiple conversation lines)
            let conversationBlockEnd = i;
            while (conversationBlockEnd < lines.length) {
                const nextLine = lines[conversationBlockEnd];
                if (
                    nextLine.trim().length === 0 ||
                    isChapterHeader(nextLine) ||
                    !isConversationLine(nextLine)
                ) {
                    break;
                }
                conversationBlockEnd++;
            }

            // If it's a multi-line conversation block, add break before first line
            if (conversationBlockEnd > i + 1) {
                // Check if last processed line is not already empty
                if (
                    processedLines.length > 0 &&
                    processedLines[processedLines.length - 1].trim().length > 0
                ) {
                    processedLines.push("");
                }
            }

            // Add all conversation lines
            for (let j = i; j < conversationBlockEnd; j++) {
                processedLines.push(lines[j]);
            }
            i = conversationBlockEnd;
            continue;
        }

        // Handle dense text block
        // Collect consecutive non-empty, non-conversation, non-chapter lines
        const denseBlockStart = i;
        let denseBlockEnd = i;
        const denseBlockLines = [];

        while (denseBlockEnd < lines.length) {
            const currentLine = lines[denseBlockEnd];
            const currentIsEmpty = currentLine.trim().length === 0;
            const currentIsConversation = isConversationLine(currentLine);
            const currentIsChapter = isChapterHeader(currentLine);

            if (currentIsEmpty || currentIsConversation || currentIsChapter) {
                break;
            }

            denseBlockLines.push(currentLine);
            denseBlockEnd++;
        }

        // Process dense text block
        if (denseBlockLines.length > 0) {
            // Merge all lines together (remove newlines, join with spaces)
            const mergedText = denseBlockLines
                .map((l) => l.trim())
                .filter((l) => l.length > 0)
                .join(" ");

            // Process the merged text to add breaks at punctuation
            const processedBlock = processDenseTextBlock(
                mergedText,
                MAX_LINE_LENGTH
            );

            // Add processed block to result
            for (const processedLine of processedBlock) {
                processedLines.push(processedLine);
            }
        }

        i = denseBlockEnd;
    }

    return processedLines.join("\n");
}

/**
 * Process chunk content to add "# " header for first occurrence of each chapter
 * Replaces existing "## " headers with "# " for first occurrence, keeps "## " for subsequent
 * @param {string} chunkContent - Raw chunk content
 * @param {Array} chaptersInChunk - Array of chapter info objects
 * @param {Set} seenChapters - Set of chapter numbers already seen
 * @returns {string} - Processed chunk content with headers
 */
function processChunkContent(chunkContent, chaptersInChunk, seenChapters) {
    if (!chunkContent || chaptersInChunk.length === 0) return chunkContent;

    const lines = chunkContent.split("\n");
    const processedLines = [];
    let chapterIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if we're at a potential chapter start
        if (chapterIndex < chaptersInChunk.length) {
            const chapter = chaptersInChunk[chapterIndex];
            const chapterKey = chapter.chapterNumber;
            const chapterNumber = chapter.chapterNumber;

            // Check if this line matches the chapter header pattern
            // Look for patterns like "## （N）" or "## 第N章" where N matches chapterNumber
            // Escape special regex characters in chapterNumber
            const escapedChapterNum = String(chapterNumber).replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );
            const chapterHeaderPattern = new RegExp(
                `^##\\s*[（(]?${escapedChapterNum}[）)]?`,
                "u"
            );
            const trimmedLine = line.trim();
            const isChapterHeader = chapterHeaderPattern.test(trimmedLine);

            if (isChapterHeader) {
                // This is a chapter header line
                if (!seenChapters.has(chapterKey)) {
                    // First occurrence: replace H2 with H1
                    seenChapters.add(chapterKey);
                    // Process chapter title: clean text and limit name length
                    let chapterTitle =
                        chapter.chapterTitle || `第${chapterNumber}章`;
                    chapterTitle =
                        textProcessor.processChapterTitle(chapterTitle);
                    // Add series prefix if not "official"
                    const series = chapter.series || "official";
                    const seriesPrefix =
                        series !== "official" ? `[${series}] ` : "";
                    // Replace the H2 header with H1
                    processedLines.push(`# ${seriesPrefix}${chapterTitle}`);
                    // Skip the original H2 line - don't push it, move to next iteration
                    chapterIndex++;
                    continue;
                } else {
                    // Already seen: keep H2 header as is
                    processedLines.push(line);
                    chapterIndex++;
                    continue;
                }
            }
        }

        // For first chapter, if we haven't found a header yet and we're at the start
        if (chapterIndex === 0 && i === 0 && lines.length > 0) {
            const firstChapter = chaptersInChunk[0];
            const firstChapterKey = firstChapter.chapterNumber;
            // Check if first line is not a header (doesn't start with ##)
            if (!line.trim().startsWith("##")) {
                // First chapter but no header found at start - add H1 header
                if (!seenChapters.has(firstChapterKey)) {
                    seenChapters.add(firstChapterKey);
                    let chapterTitle =
                        firstChapter.chapterTitle ||
                        `第${firstChapter.chapterNumber}章`;
                    chapterTitle =
                        textProcessor.processChapterTitle(chapterTitle);
                    // Add series prefix if not "official"
                    const series = firstChapter.series || "official";
                    const seriesPrefix =
                        series !== "official" ? `[${series}] ` : "";
                    processedLines.push(`# ${seriesPrefix}${chapterTitle}`);
                }
            }
        }

        // Push the line as-is
        processedLines.push(line);
    }

    let result = processedLines.join("\n");

    // Add line breaks for dense text (more than 5 consecutive non-empty lines)
    result = addLineBreaksForDenseText(result);

    return result;
}

/**
 * Generate chunk filename
 * @param {string} bookName - Book name
 * @param {number} chunkNumber - Chunk number (1-indexed)
 * @param {number} totalChunks - Total number of chunks
 * @returns {string} - Filename (e.g., "書名.md", "書名_2.md")
 */
function generateChunkFilename(bookName, chunkNumber, totalChunks) {
    if (!bookName) {
        return `chunk_${chunkNumber}.md`;
    }

    // Clean book name for filename
    const cleanName = bookName
        .replace(/[<>:"/\\|?*]/g, "") // Remove invalid filename characters
        .trim();

    if (chunkNumber === 1 && totalChunks === 1) {
        return `${cleanName}.md`;
    } else if (chunkNumber === 1) {
        return `${cleanName}.md`;
    } else {
        return `${cleanName}_${chunkNumber}.md`;
    }
}

module.exports = {
    generateTOC,
    addTOCToChunk,
    chunkContent,
    createChunksFromChapters,
    generateChunkFilename,
    sortChaptersForExport,
};
