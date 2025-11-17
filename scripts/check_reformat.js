#!/usr/bin/env node

/**
 * Test script to debug reformat and chunker functions
 * Usage: node scripts/check_reformat.js <filename>
 *        or: yarn check_reformat <filename>
 */

const fs = require("fs");
const path = require("path");
const fileAnalyzer = require("../services/fileAnalyzer");
const textProcessor = require("../services/textProcessor");
const chunker = require("../services/chunker");
const logger = require("../utils/logger");

// Enable detailed logging for this script
process.env.DETAILED_LOG = "true";

async function main() {
    // Get filename from command line arguments
    const filename = process.argv[2];

    if (!filename) {
        console.error("Usage: node scripts/check_reformat.js <filename>");
        console.error("   or: yarn check_reformat <filename>");
        process.exit(1);
    }

    //empty the folder if it exists
    const outputDir = path.join(process.cwd(), "format_output");
    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true });
    }

    // Check if file exists
    const filePath = path.resolve(filename);
    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
    }

    try {
        console.log(`\n=== Processing file: ${filename} ===\n`);

        // Read and analyze file
        const originalFilename = path.basename(filename);
        console.log("Step 1: Analyzing file...");
        const analysis = await fileAnalyzer.analyzeFile(
            filePath,
            originalFilename
        );

        console.log("Analysis complete:");
        console.log(`  Book Name: ${analysis.bookName || "(not detected)"}`);
        console.log(
            `  Author: ${analysis.metadata?.author || "(not detected)"}`
        );
        console.log(
            `  Category: ${analysis.metadata?.category || "(not detected)"}`
        );
        console.log(`  Total Chapters: ${analysis.totalChapters}`);
        console.log(`  File Size: ${analysis.fileSize} bytes\n`);

        // Create output directories
        const outputDir = path.join(process.cwd(), "format_output");
        const chapDir = path.join(outputDir, "chap");
        const chunkDir = path.join(outputDir, "chunk");

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        if (!fs.existsSync(chapDir)) {
            fs.mkdirSync(chapDir, { recursive: true });
        }
        if (!fs.existsSync(chunkDir)) {
            fs.mkdirSync(chunkDir, { recursive: true });
        }

        // Write book information
        console.log("Step 2: Writing book information...");
        const bookInfo = [];
        bookInfo.push("# Book Information\n");
        bookInfo.push(
            `**Book Name:** ${analysis.bookName || "(not detected)"}\n`
        );
        bookInfo.push(
            `**Book Name (Simplified):** ${
                analysis.bookNameSimplified || "(not detected)"
            }\n`
        );

        if (analysis.metadata) {
            if (analysis.metadata.author) {
                bookInfo.push(`**Author:** ${analysis.metadata.author}\n`);
            }
            if (analysis.metadata.category) {
                bookInfo.push(`**Category:** ${analysis.metadata.category}\n`);
            }
            if (analysis.metadata.description) {
                bookInfo.push(
                    `**Description:** ${analysis.metadata.description}\n`
                );
            }
            if (analysis.metadata.sourceUrl) {
                bookInfo.push(
                    `**Source URL:** ${analysis.metadata.sourceUrl}\n`
                );
            }
        }

        bookInfo.push(`\n**Total Chapters:** ${analysis.totalChapters}\n`);
        bookInfo.push(`**File Size:** ${analysis.fileSize} bytes\n`);

        bookInfo.push("\n## Chapter List\n\n");
        analysis.chapters.forEach((chapter, index) => {
            const chapterNum = chapter.isFinal
                ? "終"
                : chapter.number || index + 1;
            const chapterTitle = chapter.title || chapter.titleSimplified || "";
            const chapterName = chapter.name || "";
            bookInfo.push(
                `${index + 1}. 第${chapterNum}章 ${chapterTitle}${
                    chapterName ? ` - ${chapterName}` : ""
                }\n`
            );
            bookInfo.push(`   - Series: ${chapter.series || "official"}\n`);
            bookInfo.push(
                `   - Lines: ${chapter.lineStart || chapter.startLine + 1} - ${
                    chapter.lineEnd || chapter.endLine + 1
                }\n`
            );
        });

        const bookInfoPath = path.join(outputDir, "book.md");
        fs.writeFileSync(bookInfoPath, bookInfo.join(""), "utf-8");
        console.log(`  Written to: ${bookInfoPath}\n`);

        // Reformat each chapter and write to separate files
        console.log("Step 3: Reformatting chapters...");
        const chaptersForChunking = [];

        for (let i = 0; i < analysis.chapters.length; i++) {
            const chapter = analysis.chapters[i];
            const chapterNum = chapter.isFinal ? "終" : chapter.number || i + 1;
            const chapterTitle =
                chapter.title || chapter.titleSimplified || `第${chapterNum}章`;

            console.log(`  Processing chapter ${chapterNum}...`);

            // Reformat chapter content with detailed logging
            const reformattedContent = textProcessor.reformatChapterContent(
                chapter.content || "",
                chapterTitle,
                true, // Convert to Traditional Chinese
                true // Enable detailed logging
            );

            // Write chapter to file - use chapter number for filename
            // For final chapters, use '終', otherwise use the number
            const chapterNumForFile = chapter.isFinal
                ? "終"
                : String(chapter.number || i + 1);
            const chapterFilename = `chap${chapterNumForFile}.md`;
            const chapterPath = path.join(chapDir, chapterFilename);
            fs.writeFileSync(chapterPath, reformattedContent, "utf-8");
            console.log(`    Written to: ${chapterPath}`);

            // Prepare chapter for chunking
            // Keep the original number (-1 for final chapters) for chunker
            chaptersForChunking.push({
                chapterNumber: chapter.number,
                chapterTitle: chapterTitle,
                series: chapter.series || "official",
                content: reformattedContent,
            });
        }
        console.log("");

        // Create chunks
        console.log("Step 4: Creating chunks...");
        const bookTitle =
            analysis.bookName || originalFilename.replace(/\.[^/.]+$/, "");
        const metadata = {
            author: analysis.metadata?.author,
            category: analysis.metadata?.category,
            description: analysis.metadata?.description,
        };

        const chunks = chunker.createChunksFromChapters(
            chaptersForChunking,
            bookTitle,
            1000, // Default chunk size
            metadata,
            true // Enable detailed logging
        );

        console.log(`  Created ${chunks.length} chunk(s)\n`);

        // Write each chunk to file
        console.log("Step 5: Writing chunks...");
        chunks.forEach((chunk) => {
            const chunkFilename = `chunks-${chunk.chunkNumber}.md`;
            const chunkPath = path.join(chunkDir, chunkFilename);
            fs.writeFileSync(chunkPath, chunk.content, "utf-8");
            console.log(
                `  Written chunk ${chunk.chunkNumber}/${chunks.length} to: ${chunkPath}`
            );
            console.log(
                `    Chapters: ${chunk.firstChapter || "N/A"} - ${
                    chunk.lastChapter || "N/A"
                }`
            );
            console.log(`    Lines: ${chunk.lineStart} - ${chunk.lineEnd}`);
        });

        console.log("\n=== Processing complete ===\n");
        console.log(`Output directory: ${outputDir}`);
        console.log(`  - Book info: ${bookInfoPath}`);
        console.log(`  - Chapters: ${chapDir}/`);
        console.log(`  - Chunks: ${chunkDir}/`);

        // Test idempotency: reformat the first chapter again and compare
        if (analysis.chapters.length > 0) {
            console.log("\n=== Testing Idempotency ===\n");
            const testChapter = analysis.chapters[0];
            const testChapterNum = testChapter.isFinal
                ? "終"
                : testChapter.number || 1;
            const testChapterTitle =
                testChapter.title ||
                testChapter.titleSimplified ||
                `第${testChapterNum}章`;

            console.log(`Testing idempotency on chapter ${testChapterNum}...`);

            // First format
            const firstFormat = textProcessor.reformatChapterContent(
                testChapter.content || "",
                testChapterTitle,
                true,
                false // Disable detailed logging for idempotency test
            );

            // Second format (should be identical)
            const secondFormat = textProcessor.reformatChapterContent(
                firstFormat,
                testChapterTitle,
                true,
                false
            );

            // Compare results
            if (firstFormat === secondFormat) {
                console.log(
                    "✓ Idempotency test PASSED: Second format matches first"
                );
            } else {
                console.log(
                    "✗ Idempotency test FAILED: Second format differs from first"
                );
                console.log(`  First format length: ${firstFormat.length}`);
                console.log(`  Second format length: ${secondFormat.length}`);

                // Find first difference
                const minLength = Math.min(
                    firstFormat.length,
                    secondFormat.length
                );
                for (let i = 0; i < minLength; i++) {
                    if (firstFormat[i] !== secondFormat[i]) {
                        const start = Math.max(0, i - 50);
                        const end = Math.min(minLength, i + 50);
                        console.log(`  First difference at position ${i}:`);
                        console.log(
                            `  First:  ...${firstFormat.substring(
                                start,
                                end
                            )}...`
                        );
                        console.log(
                            `  Second: ...${secondFormat.substring(
                                start,
                                end
                            )}...`
                        );
                        break;
                    }
                }
                if (firstFormat.length !== secondFormat.length) {
                    console.log(
                        `  Length difference: ${Math.abs(
                            firstFormat.length - secondFormat.length
                        )} characters`
                    );
                }
            }

            // Test third format as well
            const thirdFormat = textProcessor.reformatChapterContent(
                secondFormat,
                testChapterTitle,
                true,
                false
            );

            if (secondFormat === thirdFormat) {
                console.log(
                    "✓ Idempotency test PASSED: Third format matches second"
                );
            } else {
                console.log(
                    "✗ Idempotency test FAILED: Third format differs from second"
                );
            }
        }
    } catch (error) {
        console.error("\nError processing file:", error);
        logger.error("Error in check_reformat script", {
            error: error.message,
            stack: error.stack,
        });
        process.exit(1);
    }
}

// Run the script
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
