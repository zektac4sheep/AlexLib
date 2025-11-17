/**
 * Chunker Service
 * Splits master file into chunks (~1000 lines each)
 * Preserves TOC and chapter headers in each chunk
 */

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '1000');

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
 * @returns {string} - Chunk with TOC
 */
function addTOCToChunk(chunkContent, fullTOC, bookTitle) {
    if (!chunkContent) return '';

    let content = '';

    // Add book title header
    if (bookTitle) {
        content += `# ${bookTitle}\n\n`;
    }

    // Add TOC
    if (fullTOC) {
        content += fullTOC;
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
 * @param {Array} chapters - Array of chapter objects with {content, chapterNumber, chapterTitle}
 * @param {string} bookTitle - Book title
 * @param {number} chunkSize - Lines per chunk
 * @returns {Array<Object>} - Array of chunk objects {content, lineStart, lineEnd, chunkNumber}
 */
function createChunksFromChapters(chapters, bookTitle, chunkSize = CHUNK_SIZE) {
    if (!chapters || chapters.length === 0) {
        return [];
    }

    // Generate full TOC
    const fullTOC = generateTOC(chapters);

    // Merge all chapters into master content
    let masterContent = '';
    let currentLine = 0;
    const chapterLineRanges = [];

    chapters.forEach((chapter, index) => {
        const chapterContent = chapter.content || '';
        const startLine = currentLine;

        // Add chapter content
        masterContent += chapterContent;
        if (index < chapters.length - 1) {
            masterContent += '\n\n';
        }

        currentLine += chapterContent.split('\n').length;
        const endLine = currentLine - 1;

        chapterLineRanges.push({
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.chapterTitle,
            lineStart: startLine,
            lineEnd: endLine
        });
    });

    // Split into chunks
    const rawChunks = chunkContent(masterContent, chunkSize);
    const chunks = [];

    rawChunks.forEach((chunk, index) => {
        // Calculate line range for this chunk
        const chunkLines = chunk.split('\n');
        const lineStart = index * chunkSize;
        const lineEnd = lineStart + chunkLines.length - 1;

        // Add TOC and book title to each chunk
        const chunkWithTOC = addTOCToChunk(chunk, fullTOC, bookTitle);

        chunks.push({
            content: chunkWithTOC,
            lineStart: lineStart + 1, // 1-indexed for display
            lineEnd: lineEnd + 1,
            chunkNumber: index + 1,
            totalChunks: rawChunks.length
        });
    });

    return chunks;
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
    generateChunkFilename
};

