/**
 * Runtime script to test chapter extraction on files in source folder
 * Checks if at least one chapter tag can be extracted from each file
 */

const fs = require("fs");
const path = require("path");
const {
    extractChapterNumber,
    normalizeChapterTitle,
} = require("./services/chapterExtractor");
const { normalizeToHalfWidth } = require("./services/converter");

const SOURCE_DIR = path.join(__dirname, "source");

/**
 * Read file content
 */
function readFileContent(filePath) {
    try {
        return fs.readFileSync(filePath, "utf-8");
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Standalone detectChapters function (copied from fileAnalyzer.js to avoid dependency issues)
 * This avoids importing fileAnalyzer.js which has Node.js 20+ dependencies
 */
function detectChapters(content) {
    if (!content) return [];

    const lines = content.split("\n");
    const chapters = [];
    let currentChapter = null;
    let currentChapterLines = [];
    let lineNumber = 0;

    // Track seen chapter numbers to avoid duplicates (only use first instance)
    const seenChapterNumbers = new Set();

    // Patterns for chapter headers
    const fullWidthDigits = "０１２３４５６７８９";
    const digitPattern = `[零一二三四五六七八九十百千万两0-9${fullWidthDigits}]`;
    const booknameChapterPattern = new RegExp(
        `^(.+?)[（(](${digitPattern}+|終)[）)](.*)$`
    );

    const chapterPatterns = [
        /^第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/,
        /^[（(【〔〖〝「『][零一二三四五六七八九十百千万两0-9]+[）)】〕〗〞」』](?=\s*(?:章|回|集|話|篇|部|卷|$|\s|：|:))/,
        /^第[零一二三四五六七八九十百千万两0-9]+(?=\s*(?:章|回|集|話|篇|部|卷|$|\s|：|:))/,
        /^#{1,3}\s*第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/,
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        let isChapterHeader = false;
        let chapterInfo = null;
        let extractedBookName = null;
        let chapterName = null;

        // First check for bookname (chapterNo.) [chapterName] format
        // This matches both "bookname（number）chapterName" and "bookname（number）" and "bookname（終）"
        const booknameMatch = trimmedLine.match(booknameChapterPattern);
        if (booknameMatch) {
            extractedBookName = normalizeToHalfWidth(booknameMatch[1].trim());
            const chapterNumStr = booknameMatch[2].trim();
            chapterName = (booknameMatch[3] || "").trim(); // Handle optional chapter name

            // If it's "終", extract it directly; otherwise extract the number
            if (chapterNumStr === "終") {
                chapterInfo = extractChapterNumber("（終）");
            } else {
                chapterInfo = extractChapterNumber(`（${chapterNumStr}）`);
            }
            if (
                chapterInfo &&
                (chapterInfo.number > 0 || chapterInfo.isFinal)
            ) {
                isChapterHeader = true;
            }
        }

        // If not matched, try other patterns
        if (!isChapterHeader) {
            for (const pattern of chapterPatterns) {
                if (pattern.test(trimmedLine)) {
                    chapterInfo = extractChapterNumber(trimmedLine);
                    if (
                        chapterInfo &&
                        (chapterInfo.number > 0 || chapterInfo.isFinal)
                    ) {
                        isChapterHeader = true;
                        break;
                    }
                }
            }
        }

        if (isChapterHeader && chapterInfo) {
            const chapterKey = chapterInfo.isFinal ? "終" : chapterInfo.number;

            // Skip if we've already seen this chapter number (only use first instance)
            if (seenChapterNumbers.has(chapterKey)) {
                if (currentChapter) {
                    currentChapterLines.push(line);
                }
                lineNumber++;
                continue;
            }

            seenChapterNumbers.add(chapterKey);
            if (currentChapter) {
                currentChapter.endLine = lineNumber - 1;
                currentChapter.content = currentChapterLines.join("\n");
                chapters.push(currentChapter);
            }

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

            currentChapter = {
                number: chapterInfo.number,
                title:
                    title ||
                    (chapterInfo.isFinal
                        ? `終${chapterInfo.format || "章"}`
                        : `第${chapterInfo.number}${
                              chapterInfo.format || "章"
                          }`),
                titleSimplified: title,
                name: extractedChapterName || "",
                startLine: lineNumber,
                endLine: null,
                content: "",
                lineStart: lineNumber + 1,
                lineEnd: null,
                extractedBookName: extractedBookName,
                isFinal: chapterInfo.isFinal || false,
            };
            currentChapterLines = [line];
        } else if (currentChapter) {
            currentChapterLines.push(line);
        }

        lineNumber++;
    }

    if (currentChapter) {
        currentChapter.endLine = lineNumber - 1;
        currentChapter.content = currentChapterLines.join("\n");
        chapters.push(currentChapter);
    }

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

    chapters.forEach((chapter, index) => {
        if (chapter.endLine === null) {
            chapter.endLine =
                index < chapters.length - 1
                    ? chapters[index + 1].startLine - 1
                    : lines.length - 1;
        }
        if (chapter.lineEnd === null || chapter.lineEnd === undefined) {
            chapter.lineEnd = chapter.endLine + 1;
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

    return chapters;
}

/**
 * Test chapter extraction on a single file
 * Uses detectChapters to test the actual extraction logic (with duplicate filtering)
 */
function testFile(filePath) {
    const filename = path.basename(filePath);
    const content = readFileContent(filePath);

    if (!content) {
        return {
            filename,
            success: false,
            error: "Could not read file",
            chaptersFound: 0,
            chapters: [],
            rawMatches: 0,
        };
    }

    const lines = content.split("\n");

    // Count raw matches (before duplicate filtering)
    let rawMatches = 0;
    const seenInRaw = new Set();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const chapterInfo = extractChapterNumber(line);
        if (chapterInfo) {
            const key = chapterInfo.isFinal ? "終" : chapterInfo.number;
            if (!seenInRaw.has(key)) {
                seenInRaw.add(key);
            }
            rawMatches++;
        }
    }

    // Use detectChapters to get actual extracted chapters (with duplicate filtering)
    const extractedChapters = detectChapters(content);

    return {
        filename,
        success: extractedChapters.length > 0,
        chaptersFound: extractedChapters.length,
        chapters: extractedChapters.map((ch) => {
            const lineNumber = ch.startLine + 1; // Convert to 1-indexed for display
            const lineContent = lines[ch.startLine] || ""; // Get the actual line content
            return {
                number: ch.number,
                title: ch.title,
                startLine: lineNumber,
                lineContent: lineContent.trim(),
                isFinal: ch.isFinal || false,
            };
        }),
        rawMatches: rawMatches,
        uniqueRawMatches: seenInRaw.size,
        totalLines: lines.length,
    };
}

/**
 * Main function
 */
function main() {
    console.log("=".repeat(80));
    console.log("Chapter Extraction Test");
    console.log("=".repeat(80));
    console.log(`Source directory: ${SOURCE_DIR}\n`);

    // Check if source directory exists
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`Error: Source directory does not exist: ${SOURCE_DIR}`);
        process.exit(1);
    }

    // Get all files in source directory
    const files = fs
        .readdirSync(SOURCE_DIR)
        .filter((file) => {
            const filePath = path.join(SOURCE_DIR, file);
            return fs.statSync(filePath).isFile();
        })
        .map((file) => path.join(SOURCE_DIR, file));

    if (files.length === 0) {
        console.log("No files found in source directory.");
        return;
    }

    console.log(`Found ${files.length} file(s) to test.\n`);

    const results = [];
    let totalWithChapters = 0;
    let totalWithoutChapters = 0;

    // Test each file
    for (const filePath of files) {
        const result = testFile(filePath);
        results.push(result);

        if (result.success) {
            totalWithChapters++;
        } else {
            totalWithoutChapters++;
        }
    }

    // Print results
    console.log("\n" + "=".repeat(80));
    console.log("RESULTS");
    console.log("=".repeat(80) + "\n");

    for (const result of results) {
        const status = result.success ? "✓" : "✗";
        const statusText = result.success
            ? `FOUND ${result.chaptersFound} unique chapter(s)`
            : "NO CHAPTERS FOUND";

        console.log(`${status} ${result.filename}`);
        console.log(`   ${statusText} (${result.totalLines} lines)`);

        if (result.rawMatches > 0) {
            const duplicates = result.rawMatches - result.uniqueRawMatches;
            if (duplicates > 0) {
                console.log(
                    `   Raw matches: ${result.rawMatches} (${result.uniqueRawMatches} unique, ${duplicates} duplicates filtered)`
                );
            } else {
                console.log(
                    `   Raw matches: ${result.rawMatches} (all unique)`
                );
            }
        }

        if (result.success && result.chapters.length > 0) {
            console.log(`   Extracted chapters:`);
            result.chapters.forEach((ch) => {
                const numDisplay = ch.isFinal ? "終" : ch.number;
                console.log(
                    `     - Chapter ${numDisplay} (line ${ch.startLine}): "${ch.title}"`
                );
                if (ch.lineContent) {
                    const preview =
                        ch.lineContent.length > 80
                            ? ch.lineContent.substring(0, 80) + "..."
                            : ch.lineContent;
                    console.log(`       Line content: "${preview}"`);
                }
            });
        }
        console.log();
    }

    // Summary
    console.log("=".repeat(80));
    console.log("SUMMARY");
    console.log("=".repeat(80));
    console.log(`Total files tested: ${results.length}`);
    console.log(
        `Files with chapters: ${totalWithChapters} (${(
            (totalWithChapters / results.length) *
            100
        ).toFixed(1)}%)`
    );
    console.log(
        `Files without chapters: ${totalWithoutChapters} (${(
            (totalWithoutChapters / results.length) *
            100
        ).toFixed(1)}%)`
    );
    console.log("=".repeat(80));
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { testFile };
