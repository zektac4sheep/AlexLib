/**
 * Chunker Service
 * Splits master file into chunks (~1000 lines each)
 * Preserves TOC and chapter headers in each chunk
 */

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '1000');
const converter = require('./converter');

/**
 * Sort chapters: regular chapters first (ascending), final chapters (-1) at the end
 * @param {Array} chapters - Array of chapter objects with chapterNumber property
 * @returns {Array} - Sorted chapters
 */
function sortChaptersForExport(chapters) {
    if (!chapters || chapters.length === 0) {
        return chapters;
    }
    
    // Create a copy to avoid mutating the original
    const sorted = [...chapters];
    
    // Sort: regular chapters (>= 0) first in ascending order, then -1 chapters at the end
    sorted.sort((a, b) => {
        const numA = a.chapterNumber ?? a.number ?? 0;
        const numB = b.chapterNumber ?? b.number ?? 0;
        
        // If both are -1, maintain original order
        if (numA === -1 && numB === -1) {
            return 0;
        }
        
        // -1 always goes to the end
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
        return '';
    }

    let toc = '# 目錄\n\n';
    toc += '[[toc]]\n\n';
    toc += '## 章節目錄\n\n';

    chapters.forEach(chapter => {
        const num = chapter.chapterNumber || '';
        const title = chapter.chapterTitle || '';
        const format = chapter.chapterFormat || '章';

        if (num && title) {
            toc += `- [第${num}${format} ${title}](#第${num}${format}-${title.replace(/\s+/g, '-')})\n`;
        } else if (num) {
            toc += `- [第${num}${format}](#第${num}${format})\n`;
        }
    });

    toc += '\n---\n\n';
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
function addTOCToChunk(chunkContent, fullTOC, bookTitle, metadata = {}, chunkInfo = {}) {
    if (!chunkContent) return '';

    let content = '';

    // First line: 【book_name】 (chapter_from - chapter_to) 作者：author_name
    if (bookTitle) {
        let chapterRange = '';
        if (chunkInfo.firstChapter !== null && chunkInfo.lastChapter !== null) {
            if (chunkInfo.firstChapter === chunkInfo.lastChapter) {
                chapterRange = `(${chunkInfo.firstChapter})`;
            } else {
                chapterRange = `(${chunkInfo.firstChapter} - ${chunkInfo.lastChapter})`;
            }
        }
        const authorPart = metadata.author ? ` 作者：${metadata.author}` : '';
        content += `【${bookTitle}】${chapterRange}${authorPart}\n\n`;
    }

    // Add metadata block
    if (metadata.author || metadata.category || metadata.description) {
        content += '---\n\n';
        if (metadata.author) {
            content += `**作者：** ${metadata.author}\n\n`;
        }
        if (metadata.category) {
            content += `**分類：** ${metadata.category}\n\n`;
        }
        if (metadata.description) {
            content += `**簡介：** ${metadata.description}\n\n`;
        }
        content += '---\n\n';
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

    content += '---\n\n';

    // Add TOC
    if (fullTOC) {
        content += fullTOC;
    }

    // Add header after TOC for the first chapter in this chunk
    if (chunkInfo.firstChapterInChunk) {
        const firstChapter = chunkInfo.firstChapterInChunk;
        const chapterTitle = firstChapter.chapterTitle || '';
        const chapterName = chapterTitle.replace(/^第\d+章\s*/, '').trim();
        content += `【${bookTitle}】 (${firstChapter.chapterNumber}) ${chapterName}\n\n`;
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

    const lines = masterContent.split('\n');
    const chunks = [];

    // If content is smaller than chunk size, return as single chunk
    if (lines.length <= chunkSize) {
        return [masterContent];
    }

    // Split into chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
        const chunkLines = lines.slice(i, i + chunkSize);
        chunks.push(chunkLines.join('\n'));
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
 * @returns {Array<Object>} - Array of chunk objects {content, lineStart, lineEnd, chunkNumber}
 */
function createChunksFromChapters(chapters, bookTitle, chunkSize = CHUNK_SIZE, metadata = {}) {
    if (!chapters || chapters.length === 0) {
        return [];
    }

    // Sort chapters: regular chapters first, final chapters (-1) at the end
    const sortedChapters = sortChaptersForExport(chapters);

    // Generate full TOC
    const fullTOC = generateTOC(sortedChapters);

    // Build chunks by adding complete chapters
    const chunks = [];
    let currentChunkContent = [];
    let currentChunkChapters = [];
    let currentChunkLineCount = 0;
    let currentLineInMaster = 0;
    const seenChapters = new Set(); // Track which chapters have been seen across all chunks

    sortedChapters.forEach((chapter, chapterIndex) => {
        const chapterContent = chapter.content || '';
        const chapterLines = chapterContent.split('\n');
        const chapterLineCount = chapterLines.length;
        const needsSeparator = currentChunkContent.length > 0; // Need separator if chunk already has content
        const separatorLineCount = needsSeparator ? 1 : 0; // One empty line separator
        const totalLinesForChapter = chapterLineCount + separatorLineCount;

        // Check if adding this chapter would exceed chunk size
        // If current chunk is empty, always add the chapter (even if it's over chunkSize)
        // If current chunk has content and adding this chapter would exceed chunkSize, start new chunk
        const wouldExceed = currentChunkLineCount > 0 && 
                           (currentChunkLineCount + totalLinesForChapter > chunkSize);

        if (wouldExceed) {
            // Finalize current chunk
            const chunkContent = currentChunkContent.join('\n');
            const chunkNumber = chunks.length + 1;
            
            // Process chunk content to add "# " header for first occurrence of each chapter
            const processedChunk = processChunkContent(chunkContent, currentChunkChapters, seenChapters);

            // Calculate line ranges (1-indexed)
            const lineStart = currentLineInMaster - currentChunkLineCount + 1;
            const lineEnd = currentLineInMaster;

            // Determine first and last chapter numbers
            const chapterNumbers = currentChunkChapters
                .map(ch => ch.chapterNumber)
                .filter(num => num !== null && num !== undefined && num !== -1)
                .sort((a, b) => a - b);
            
            const firstChapter = chapterNumbers.length > 0 ? chapterNumbers[0] : null;
            const lastChapter = chapterNumbers.length > 0 ? chapterNumbers[chapterNumbers.length - 1] : null;

            // Get the first chapter in this chunk for the header
            const firstChapterInChunk = currentChunkChapters.length > 0 
                ? currentChunkChapters.find(ch => ch.chapterNumber === firstChapter) || currentChunkChapters[0]
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
                    firstChapterInChunk: firstChapterInChunk
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
                chaptersInChunk: currentChunkChapters.map(ch => ({
                    chapterNumber: ch.chapterNumber,
                    chapterTitle: ch.chapterTitle,
                    lineStart: ch.lineStart,
                    lineEnd: ch.lineEnd,
                    originalStartLine: ch.originalStartLine,
                    originalEndLine: ch.originalEndLine
                })),
                firstChapter: firstChapter,
                lastChapter: lastChapter,
                chapterCount: currentChunkChapters.length
            });

            // Start new chunk
            currentChunkContent = [];
            currentChunkChapters = [];
            currentChunkLineCount = 0;
        }

        // Add chapter to current chunk
        // Add separator if needed (before adding chapter content)
        if (currentChunkContent.length > 0) {
            currentChunkContent.push(''); // Empty line separator
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
            lineStart: chapterStartLineInMaster + 1, // 1-indexed
            lineEnd: chapterStartLineInMaster + chapterLineCount, // 1-indexed
            originalStartLine: chapterStartLineInMaster, // 0-indexed
            originalEndLine: chapterStartLineInMaster + chapterLineCount - 1 // 0-indexed
        });

        // Update line counts
        currentChunkLineCount += chapterLineCount;
        currentLineInMaster += chapterLineCount;
    });

    // Finalize last chunk
    if (currentChunkContent.length > 0) {
        const chunkContent = currentChunkContent.join('\n');
        const chunkNumber = chunks.length + 1;
        
        // Process chunk content to add "# " header for first occurrence of each chapter
        const processedChunk = processChunkContent(chunkContent, currentChunkChapters, seenChapters);

        // Calculate line ranges
        const lineStart = currentLineInMaster - currentChunkLineCount + 1; // 1-indexed
        const lineEnd = currentLineInMaster; // 1-indexed

        // Determine first and last chapter numbers
        const chapterNumbers = currentChunkChapters
            .map(ch => ch.chapterNumber)
            .filter(num => num !== null && num !== undefined && num !== -1)
            .sort((a, b) => a - b);
        
        const firstChapter = chapterNumbers.length > 0 ? chapterNumbers[0] : null;
        const lastChapter = chapterNumbers.length > 0 ? chapterNumbers[chapterNumbers.length - 1] : null;

        // Get the first chapter in this chunk for the header
        const firstChapterInChunk = currentChunkChapters.length > 0 
            ? currentChunkChapters.find(ch => ch.chapterNumber === firstChapter) || currentChunkChapters[0]
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
                firstChapterInChunk: firstChapterInChunk
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
            chaptersInChunk: currentChunkChapters.map(ch => ({
                chapterNumber: ch.chapterNumber,
                chapterTitle: ch.chapterTitle,
                lineStart: ch.lineStart,
                lineEnd: ch.lineEnd,
                originalStartLine: ch.originalStartLine,
                originalEndLine: ch.originalEndLine
            })),
            firstChapter: firstChapter,
            lastChapter: lastChapter,
            chapterCount: currentChunkChapters.length
        });
    }

    // Update totalChunks for all chunks (both object property and content string)
    const totalChunks = chunks.length;
    chunks.forEach(chunk => {
        chunk.totalChunks = totalChunks;
        // Update the content string's totalChunks in the metadata
        // Replace pattern like "第 X / Y 塊" where Y needs to be updated
        const oldPattern = new RegExp(`第 ${chunk.chunkNumber} / \\d+ 塊`, 'g');
        const newReplacement = `第 ${chunk.chunkNumber} / ${totalChunks} 塊`;
        chunk.content = chunk.content.replace(oldPattern, newReplacement);
    });

    return chunks;
}

/**
 * Process chunk content to add "# " header for first occurrence of each chapter
 * @param {string} chunkContent - Raw chunk content
 * @param {Array} chaptersInChunk - Array of chapter info objects
 * @param {Set} seenChapters - Set of chapter numbers already seen
 * @returns {string} - Processed chunk content with headers
 */
function processChunkContent(chunkContent, chaptersInChunk, seenChapters) {
    if (!chunkContent || chaptersInChunk.length === 0) return chunkContent;

    const lines = chunkContent.split('\n');
    const processedLines = [];
    let chapterIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if this is the start of a new chapter
        // Chapters are separated by empty lines, and we know the order from chaptersInChunk
        if (chapterIndex < chaptersInChunk.length) {
            const chapter = chaptersInChunk[chapterIndex];
            const chapterKey = chapter.chapterNumber;
            
            // Check if we're at the start of this chapter
            // First chapter starts at line 0, subsequent chapters start after an empty line
            const isFirstChapter = chapterIndex === 0;
            const isChapterStart = isFirstChapter ? (i === 0) : (i > 0 && lines[i - 1] === '' && line !== '');
            
            if (isChapterStart && !seenChapters.has(chapterKey)) {
                seenChapters.add(chapterKey);
                // Add "# " header before the chapter content
                processedLines.push(`# ${chapter.chapterTitle || `第${chapter.chapterNumber}章`}`);
                chapterIndex++;
            } else if (isChapterStart) {
                // Chapter already seen, just move to next chapter
                chapterIndex++;
            }
        }
        
        processedLines.push(line);
    }

    return processedLines.join('\n');
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
        .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
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
    sortChaptersForExport
};

