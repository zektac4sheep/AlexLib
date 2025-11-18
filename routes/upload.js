const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Book = require("../models/book");
const Chapter = require("../models/chapter");
const { analyzeFile } = require("../services/fileAnalyzer");
const { toTraditional, normalizeToHalfWidth } = require("../services/converter");
const { sortChaptersForExport } = require("../services/chunker");
const botStatusService = require("../services/botStatusService");
const logger = require("../utils/logger");

const SOURCE_FOLDER =
    process.env.SOURCE_FOLDER || path.join(__dirname, "../source");
const BACKUP_FOLDER =
    process.env.BACKUP_FOLDER || path.join(__dirname, "../source_backup");

// Ensure source folder exists
if (!fs.existsSync(SOURCE_FOLDER)) {
    fs.mkdirSync(SOURCE_FOLDER, { recursive: true });
}

// Ensure backup folder exists
if (!fs.existsSync(BACKUP_FOLDER)) {
    fs.mkdirSync(BACKUP_FOLDER, { recursive: true });
}

/**
 * Backup file to backup folder when chapter extraction fails
 * @param {string} filePath - Path to the file to backup
 * @param {string} originalName - Original filename
 * @returns {Promise<string>} - Path to the backed up file
 */
async function backupFileForChapterExtraction(filePath, originalName) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const backupFilename = `${timestamp}_${safeName}`;
        const backupPath = path.join(BACKUP_FOLDER, backupFilename);
        
        // Copy file to backup folder
        await fs.promises.copyFile(filePath, backupPath);
        
        logger.info("File backed up for chapter extraction improvement", {
            originalPath: filePath,
            backupPath: backupPath,
            originalName: originalName,
        });
        
        return backupPath;
    } catch (error) {
        logger.error("Error backing up file", {
            filePath,
            originalName,
            error: error.message,
        });
        throw error;
    }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, SOURCE_FOLDER);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(
            null,
            file.fieldname +
                "-" +
                uniqueSuffix +
                path.extname(file.originalname)
        );
    },
});

const upload = multer({ storage });

// Upload file
router.post("/", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    res.json({
        message: "File uploaded successfully",
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
    });
});

// Analyze uploaded file
router.post("/analyze", async (req, res) => {
    try {
        const { filename, originalName } = req.body;

        if (!filename) {
            return res.status(400).json({ error: "filename is required" });
        }

        const filePath = path.join(SOURCE_FOLDER, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "File not found" });
        }

        // Analyze file
        const analysis = await analyzeFile(filePath, originalName || filename);

        // Backup file if no chapters were extracted
        if (analysis.totalChapters === 0) {
            try {
                await backupFileForChapterExtraction(filePath, originalName || filename);
                logger.info("File backed up due to no chapters extracted", {
                    filename: originalName || filename,
                    bookName: analysis.bookNameSimplified,
                });
            } catch (error) {
                logger.error("Failed to backup file", {
                    filename: originalName || filename,
                    error: error.message,
                });
                // Continue even if backup fails
            }
        }

        // Check for existing books with similar names
        // Normalize both names to half-width for comparison
        const normalizedDetectedName = normalizeToHalfWidth(analysis.bookNameSimplified).trim().toLowerCase();
        const existingBooks = await Book.findAll();
        const matchedBooks = existingBooks.filter((book) => {
            const normalizedBookName = normalizeToHalfWidth(book.book_name_simplified || "").trim().toLowerCase();
            return (
                normalizedBookName === normalizedDetectedName ||
                normalizedBookName.includes(normalizedDetectedName) ||
                normalizedDetectedName.includes(normalizedBookName)
            );
        });

        // Convert chapter titles to traditional for display
        const chaptersForDisplay = analysis.chapters.map((ch) => ({
            ...ch,
            titleTraditional: toTraditional(ch.title),
        }));

        res.json({
            ...analysis,
            chapters: chaptersForDisplay,
            matchedBooks: matchedBooks.map((book) => ({
                id: book.id,
                book_name_simplified: book.book_name_simplified,
                book_name_traditional: book.book_name_traditional,
                total_chapters: book.total_chapters,
            })),
        });
    } catch (error) {
        logger.error("Error analyzing file", { error });
        res.status(500).json({
            error: "Failed to analyze file",
            message: error.message,
        });
    }
});

// Process uploaded file
router.post("/process", async (req, res) => {
    const uploadId = `upload-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
    let operationRegistered = false;

    try {
        const { filename, originalName, bookId, bookName, bookMetadata } =
            req.body;

        if (!filename) {
            return res.status(400).json({ error: "filename is required" });
        }

        const filePath = path.join(SOURCE_FOLDER, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "File not found" });
        }

        // Register upload operation
        botStatusService.registerOperation("upload", uploadId, {
            filename: originalName || filename,
            bookId: bookId || null,
            bookName: bookName || null,
            totalChapters: 0,
            completedChapters: 0,
            failedChapters: 0,
        });
        operationRegistered = true;

        // Analyze file to get chapters
        const analysis = await analyzeFile(filePath, originalName || filename);

        // Backup file if no chapters were extracted
        if (analysis.totalChapters === 0) {
            try {
                await backupFileForChapterExtraction(filePath, originalName || filename);
                logger.info("File backed up due to no chapters extracted", {
                    filename: originalName || filename,
                    bookName: analysis.bookNameSimplified,
                });
            } catch (error) {
                logger.error("Failed to backup file", {
                    filename: originalName || filename,
                    error: error.message,
                });
                // Continue even if backup fails
            }
        }

        // Update operation with total chapters
        botStatusService.updateOperation("upload", uploadId, {
            totalChapters: analysis.totalChapters,
        });

        let finalBookId = bookId;
        let finalBookName = bookName || analysis.bookNameSimplified;
        
        // Normalize book name to half-width
        finalBookName = normalizeToHalfWidth(finalBookName.trim());

        // Create or use existing book
        if (!finalBookId) {
            // Check if book with same normalized name already exists
            const normalizedName = normalizeToHalfWidth(finalBookName).trim().toLowerCase();
            const existingBooks = await Book.findAll();
            const existingBook = existingBooks.find((book) => {
                const normalizedBookName = normalizeToHalfWidth(book.book_name_simplified || "").trim().toLowerCase();
                return normalizedBookName === normalizedName;
            });
            
            if (existingBook) {
                // Use existing book instead of creating new one
                finalBookId = existingBook.id;
                finalBookName = existingBook.book_name_simplified;
                logger.info("Using existing book with same normalized name", {
                    bookId: finalBookId,
                    bookName: finalBookName,
                    detectedName: analysis.bookNameSimplified,
                });
            } else {
                // Create new book - use metadata from file analysis as primary source
                // User-provided metadata can override if explicitly provided
                const bookNameTraditional = toTraditional(finalBookName);
            const metadata = {
                // Prioritize file metadata when creating new book, user can override
                author:
                    bookMetadata?.author && bookMetadata.author.trim()
                        ? bookMetadata.author.trim()
                        : analysis.metadata?.author || null,
                category:
                    bookMetadata?.category && bookMetadata.category.trim()
                        ? bookMetadata.category.trim()
                        : analysis.metadata?.category || null,
                description:
                    bookMetadata?.description && bookMetadata.description.trim()
                        ? bookMetadata.description.trim()
                        : analysis.metadata?.description || null,
                sourceUrl:
                    bookMetadata?.sourceUrl && bookMetadata.sourceUrl.trim()
                        ? bookMetadata.sourceUrl.trim()
                        : analysis.metadata?.sourceUrl || null,
            };

                finalBookId = await Book.create(
                    finalBookName,
                    bookNameTraditional,
                    metadata
                );
                logger.info("Created new book", {
                    bookId: finalBookId,
                    bookName: finalBookName,
                });
            }
        } else {
            // Verify book exists
            const existingBook = await Book.findById(finalBookId);
            if (!existingBook) {
                botStatusService.updateOperation("upload", uploadId, {
                    status: "failed",
                    error: "Book not found",
                });
                return res.status(404).json({ error: "Book not found" });
            }
            finalBookName = existingBook.book_name_simplified;
        }

        // Update operation with book info
        botStatusService.updateOperation("upload", uploadId, {
            bookId: finalBookId,
            bookName: finalBookName,
        });

        // Process and insert chapters
        let insertedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;

        // Sort chapters: regular chapters first, final chapters (-1) at the end
        const sortedChapters = sortChaptersForExport(analysis.chapters);

        for (let i = 0; i < sortedChapters.length; i++) {
            const chapter = sortedChapters[i];
            try {
                const chapterTitleTraditional = toTraditional(chapter.title);

                const chapterData = {
                    book_id: finalBookId,
                    chapter_number: chapter.number,
                    chapter_title: chapterTitleTraditional,
                    chapter_title_simplified:
                        chapter.titleSimplified || chapter.title,
                    chapter_name: chapter.name || "", // Store chapter name if available
                    content: chapter.content,
                    line_start: chapter.lineStart,
                    line_end: chapter.lineEnd,
                    status: "downloaded",
                };

                // Check if chapter already exists
                const existingChapter = await Chapter.findByBookAndNumber(
                    finalBookId,
                    chapter.number
                );

                if (existingChapter) {
                    // Update existing chapter
                    await Chapter.updateByBookAndNumber(
                        finalBookId,
                        chapter.number,
                        chapterData
                    );
                    updatedCount++;
                } else {
                    // Create new chapter
                    await Chapter.create(chapterData);
                    insertedCount++;
                }

                // Update progress
                botStatusService.updateOperation("upload", uploadId, {
                    completedChapters: i + 1,
                });
            } catch (error) {
                logger.error("Error processing chapter", {
                    bookId: finalBookId,
                    chapterNumber: chapter.number,
                    error,
                });
                errorCount++;
                botStatusService.updateOperation("upload", uploadId, {
                    failedChapters: errorCount,
                });
            }
        }

        // Update book's total chapters count
        const allChapters = await Chapter.findByBookId(finalBookId);
        await Book.update(finalBookId, {
            total_chapters: allChapters.length,
        });

        // Keep uploaded file for debugging (commented out deletion)
        // try {
        //     fs.unlinkSync(filePath);
        // } catch (error) {
        //     logger.warn("Failed to delete uploaded file", { filePath, error });
        // }
        logger.info("Uploaded file kept for debugging", { filePath, filename });

        // Mark operation as completed
        botStatusService.updateOperation("upload", uploadId, {
            status: "completed",
            chaptersInserted: insertedCount,
            chaptersUpdated: updatedCount,
            chaptersErrored: errorCount,
        });

        res.json({
            message: "File processed successfully",
            bookId: finalBookId,
            bookName: finalBookName,
            chaptersInserted: insertedCount,
            chaptersUpdated: updatedCount,
            chaptersErrored: errorCount,
            totalChapters: analysis.totalChapters,
        });
    } catch (error) {
        logger.error("Error processing file", { error });

        // Mark operation as failed if it was registered
        if (operationRegistered) {
            botStatusService.updateOperation("upload", uploadId, {
                status: "failed",
                error: error.message,
            });
        }

        res.status(500).json({
            error: "Failed to process file",
            message: error.message,
        });
    }
});

// Extract book information from file and create new book
router.post("/extract-and-create", async (req, res) => {
    const uploadId = `upload-extract-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
    let operationRegistered = false;

    try {
        const { filename, originalName } = req.body;

        if (!filename) {
            return res.status(400).json({ error: "filename is required" });
        }

        const filePath = path.join(SOURCE_FOLDER, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "File not found" });
        }

        // Register upload operation
        botStatusService.registerOperation("upload", uploadId, {
            filename: originalName || filename,
            bookId: null,
            bookName: null,
            totalChapters: 0,
            completedChapters: 0,
            failedChapters: 0,
        });
        operationRegistered = true;

        // Analyze file to extract book information and chapters
        const analysis = await analyzeFile(filePath, originalName || filename);

        // Backup file if no chapters were extracted
        if (analysis.totalChapters === 0) {
            try {
                await backupFileForChapterExtraction(filePath, originalName || filename);
                logger.info("File backed up due to no chapters extracted", {
                    filename: originalName || filename,
                    bookName: analysis.bookNameSimplified,
                });
            } catch (error) {
                logger.error("Failed to backup file", {
                    filename: originalName || filename,
                    error: error.message,
                });
                // Continue even if backup fails
            }
        }

        // Update operation with total chapters
        botStatusService.updateOperation("upload", uploadId, {
            totalChapters: analysis.totalChapters,
        });

        // Check if book already exists
        const bookNameSimplified = analysis.bookNameSimplified || 
            (originalName || filename).replace(/\.[^/.]+$/, "");
        const normalizedDetectedName = normalizeToHalfWidth(bookNameSimplified).trim().toLowerCase();
        
        // Find existing books with matching names
        const existingBooks = await Book.findAll();
        let existingBook = existingBooks.find((book) => {
            const normalizedBookName = normalizeToHalfWidth(book.book_name_simplified || "").trim().toLowerCase();
            return (
                normalizedBookName === normalizedDetectedName ||
                normalizedBookName.includes(normalizedDetectedName) ||
                normalizedDetectedName.includes(normalizedBookName)
            );
        });

        let bookId;
        let isNewBook = false;
        let finalBookName = bookNameSimplified;
        let finalBookNameTraditional = toTraditional(bookNameSimplified);
        let finalMetadata = null;

        if (existingBook) {
            // Use existing book
            bookId = existingBook.id;
            finalBookName = existingBook.book_name_simplified;
            finalBookNameTraditional = existingBook.book_name_traditional;
            logger.info("Using existing book for file extraction", {
                bookId,
                bookName: bookNameSimplified,
                existingBookName: existingBook.book_name_simplified,
            });
        } else {
            // Create new book with extracted metadata
            isNewBook = true;
            finalMetadata = {
                author: analysis.metadata?.author || null,
                category: analysis.metadata?.category || null,
                description: analysis.metadata?.description || null,
                sourceUrl: analysis.metadata?.sourceUrl || null,
            };

            bookId = await Book.create(
                bookNameSimplified,
                finalBookNameTraditional,
                finalMetadata
            );

            logger.info("Created new book from file extraction", {
                bookId,
                bookName: bookNameSimplified,
                metadata: finalMetadata,
            });
        }

        // Update operation with book info
        botStatusService.updateOperation("upload", uploadId, {
            bookId,
            bookName: bookNameSimplified,
        });

        // Process and insert chapters
        let insertedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;

        if (!analysis.chapters || analysis.chapters.length === 0) {
            logger.warn("No chapters found in file analysis", {
                filename,
                bookName: bookNameSimplified,
            });
        }

        // Sort chapters: regular chapters first, final chapters (-1) at the end
        const sortedChaptersExtract = sortChaptersForExport(analysis.chapters);

        for (let i = 0; i < sortedChaptersExtract.length; i++) {
            const chapter = sortedChaptersExtract[i];
            try {
                // Validate chapter number
                if (chapter.number === null || chapter.number === undefined) {
                    logger.warn("Chapter number is null or undefined, skipping", {
                        bookId,
                        chapterIndex: i,
                        chapterTitle: chapter.title,
                    });
                    errorCount++;
                    continue;
                }

                const chapterTitleTraditional = toTraditional(chapter.title || "");

                const chapterData = {
                    book_id: bookId,
                    chapter_number: chapter.number,
                    chapter_title: chapterTitleTraditional,
                    chapter_title_simplified:
                        chapter.titleSimplified || chapter.title || "",
                    chapter_name: chapter.name || "",
                    content: chapter.content || "",
                    line_start: chapter.lineStart || null,
                    line_end: chapter.lineEnd || null,
                    status: "downloaded",
                };

                // Check if chapter already exists
                const existingChapter = await Chapter.findByBookAndNumber(
                    bookId,
                    chapter.number
                );

                if (existingChapter) {
                    // Update existing chapter
                    await Chapter.updateByBookAndNumber(
                        bookId,
                        chapter.number,
                        chapterData
                    );
                    updatedCount++;
                    logger.debug("Updated existing chapter", {
                        bookId,
                        chapterNumber: chapter.number,
                    });
                } else {
                    // Create new chapter
                    await Chapter.create(chapterData);
                    insertedCount++;
                    logger.debug("Created new chapter", {
                        bookId,
                        chapterNumber: chapter.number,
                    });
                }

                // Update progress
                botStatusService.updateOperation("upload", uploadId, {
                    completedChapters: i + 1,
                });
            } catch (error) {
                logger.error("Error processing chapter", {
                    bookId,
                    chapterNumber: chapter?.number,
                    chapterIndex: i,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        name: error.name,
                    },
                });
                errorCount++;
                botStatusService.updateOperation("upload", uploadId, {
                    failedChapters: errorCount,
                });
            }
        }

        // Update book's total chapters count
        const allChapters = await Chapter.findByBookId(bookId);
        await Book.update(bookId, {
            total_chapters: allChapters.length,
        });

        // Keep uploaded file for debugging (commented out deletion)
        // try {
        //     fs.unlinkSync(filePath);
        // } catch (error) {
        //     logger.warn("Failed to delete uploaded file", { filePath, error });
        // }
        logger.info("Uploaded file kept for debugging", { filePath, filename });

        // Mark operation as completed
        botStatusService.updateOperation("upload", uploadId, {
            status: "completed",
            chaptersInserted: insertedCount,
            chaptersUpdated: updatedCount,
            chaptersErrored: errorCount,
        });

        // Log summary
        logger.info("File extraction completed", {
            bookId,
            bookName: finalBookName,
            isNewBook,
            chaptersInserted: insertedCount,
            chaptersUpdated: updatedCount,
            chaptersErrored: errorCount,
            totalChaptersInFile: analysis.totalChapters,
        });

        res.json({
            message: isNewBook 
                ? "Book created successfully from file" 
                : "Chapters merged to existing book",
            bookId,
            bookName: finalBookName,
            bookNameTraditional: finalBookNameTraditional,
            metadata: finalMetadata,
            isNewBook,
            isMerged: !isNewBook,
            chaptersInserted: insertedCount,
            chaptersUpdated: updatedCount,
            chaptersErrored: errorCount,
            totalChapters: analysis.totalChapters,
            success: errorCount === 0 && (insertedCount > 0 || updatedCount > 0),
        });
    } catch (error) {
        logger.error("Error extracting and creating book from file", { error });

        // Mark operation as failed if it was registered
        if (operationRegistered) {
            botStatusService.updateOperation("upload", uploadId, {
                status: "failed",
                error: error.message,
            });
        }

        res.status(500).json({
            error: "Failed to extract and create book from file",
            message: error.message,
        });
    }
});

module.exports = router;
