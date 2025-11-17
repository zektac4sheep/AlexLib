const express = require("express");
const router = express.Router();
const joplinService = require("../services/joplinService");
const oneNoteService = require("../services/oneNoteService");
const joplinSourceService = require("../services/joplinSourceService");
const settingsService = require("../services/settingsService");
const JoplinJob = require("../models/joplinJob");
const logger = require("../utils/logger");

// Test connection - supports both Joplin and OneNote
router.post("/test-connection", async (req, res) => {
    try {
        const { port, token } = req.body;
        
        // If port and token are provided, test Joplin connection
        if (port && token) {
            const apiUrl = `http://localhost:${port}`;
            const isConnected = await joplinService.testConnection({
                apiUrl,
                apiToken: token,
            });

            res.json({
                connected: isConnected,
                message: isConnected
                    ? "Connection successful"
                    : "Connection failed",
            });
        } else {
            // Otherwise, test OneNote connection (uses environment variables)
            const isConnected = await oneNoteService.testConnection();

            res.json({
                connected: isConnected,
                message: isConnected
                    ? "Connection successful"
                    : "Connection failed",
            });
        }
    } catch (error) {
        logger.error("Error testing connection", { error });
        res.status(500).json({
            error: "Failed to test connection",
            message: error.message,
        });
    }
});

// ========== OneNote OAuth Routes ==========

// Get OAuth authorization URL
router.get("/onenote/auth", async (req, res) => {
    try {
        const authUrl = oneNoteService.getAuthUrl();
        //redirect the user to the authUrl
        res.redirect(authUrl);
        return;

        res.json({
            authUrl,
            message: "Redirect user to this URL to authorize OneNote access",
        });
    } catch (error) {
        logger.error("Error generating OneNote auth URL", { error });
        res.status(500).json({
            error: "Failed to generate authorization URL",
            message: error.message,
        });
    }
});

// OAuth callback - handles redirect from Microsoft after authorization
router.get("/onenote/callback", async (req, res) => {
    try {
        const { code, error, error_description, state } = req.query;

        if (error) {
            logger.error("OneNote OAuth callback error", {
                error,
                error_description,
            });
            return res.status(400).send(`
                <html>
                    <head><title>OneNote Authorization Failed</title></head>
                    <body>
                        <h1>Authorization Failed</h1>
                        <p>Error: ${error}</p>
                        <p>${error_description || "Unknown error"}</p>
                        <p><a href="/">Return to app</a></p>
                    </body>
                </html>
            `);
        }

        if (!code) {
            return res.status(400).send(`
                <html>
                    <head><title>OneNote Authorization Failed</title></head>
                    <body>
                        <h1>Authorization Failed</h1>
                        <p>No authorization code received from Microsoft.</p>
                        <p><a href="/">Return to app</a></p>
                    </body>
                </html>
            `);
        }

        // Exchange authorization code for tokens
        const tokens = await oneNoteService.exchangeCodeForTokens(code);

        // Display success page with refresh token
        // User should copy this to their .env file
        const refreshTokenHtml = tokens.refreshToken
            ? `
                <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <h3>✅ Authorization Successful!</h3>
                    <p><strong>Important:</strong> Copy the refresh token below and add it to your <code>.env</code> file:</p>
                    <pre style="background: white; padding: 10px; border: 1px solid #ddd; overflow-x: auto; word-break: break-all;">ONENOTE_REFRESH_TOKEN=${tokens.refreshToken}</pre>
                    <p><strong>Steps:</strong></p>
                    <ol>
                        <li>Copy the entire line above (starting with ONENOTE_REFRESH_TOKEN=)</li>
                        <li>Add it to your <code>.env</code> file (or update the existing ONENOTE_REFRESH_TOKEN value)</li>
                        <li>Restart your server</li>
                        <li>Test the connection again</li>
                    </ol>
                    <p><em>Access token expires in ${tokens.expiresIn} seconds. The refresh token is long-lived and will be used to get new access tokens automatically.</em></p>
                </div>
            `
            : `
                <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <h3>⚠️ Authorization Successful, but no refresh token received</h3>
                    <p>This may happen if the "offline_access" scope was not granted. Please try again and ensure all permissions are granted.</p>
                </div>
            `;

        res.send(`
            <html>
                <head>
                    <title>OneNote Authorization Success</title>
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
                        pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
                    </style>
                </head>
                <body>
                    <h1>OneNote Authorization</h1>
                    ${refreshTokenHtml}
                    <p><a href="/">Return to app</a></p>
                </body>
            </html>
        `);
    } catch (error) {
        logger.error("Error handling OneNote OAuth callback", { error });
        res.status(500).send(`
            <html>
                <head><title>OneNote Authorization Error</title></head>
                <body>
                    <h1>Authorization Error</h1>
                    <p>Failed to exchange authorization code for tokens.</p>
                    <p><strong>Error:</strong> ${error.message}</p>
                    <p><a href="/">Return to app</a></p>
                </body>
            </html>
        `);
    }
});

// Start sync structure job (background) - Joplin only
router.post("/sync-structure", async (req, res) => {
    try {
        const { port, token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        const apiUrl = port ? `http://localhost:${port}` : "http://localhost:41184";

        // Create job
        const jobId = await JoplinJob.create("sync_structure", apiUrl, token, {});

        // Start processing in background (non-blocking)
        joplinService.processSyncStructureJob(jobId, apiUrl, token).catch((err) => {
            logger.error("Error processing sync structure job", {
                jobId,
                error: err,
            });
        });

        res.json({
            message: "Sync structure job started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting sync structure job", { error });
        res.status(500).json({ error: "Failed to start sync structure job" });
    }
});

// Start sync books job (background) - supports both Joplin and OneNote
router.post("/sync-books", async (req, res) => {
    try {
        const { port, token } = req.body;
        
        // If port and token are provided, sync to Joplin
        if (port && token) {
            const apiUrl = `http://localhost:${port}`;
            
            // Create job
            const jobId = await JoplinJob.create("sync_books", apiUrl, token, {});

            // Start processing in background (non-blocking)
            joplinService.processSyncBooksJob(jobId, apiUrl, token).catch((err) => {
                logger.error("Error processing Joplin sync books job", {
                    jobId,
                    error: err,
                });
            });

            res.json({
                message: "Joplin sync books job started",
                jobId,
            });
        } else {
            // Otherwise, sync to OneNote (uses environment variables)
            const jobId = await JoplinJob.create("sync_books", "", "", {});

            // Start processing in background (non-blocking)
            oneNoteService.processOneNoteSyncBooksJob(jobId).catch((err) => {
                logger.error("Error processing OneNote sync books job", {
                    jobId,
                    error: err,
                });
            });

            res.json({
                message: "OneNote sync books job started",
                jobId,
            });
        }
    } catch (error) {
        logger.error("Error starting sync books job", { error });
        res.status(500).json({ error: "Failed to start sync books job" });
    }
});

// Start sync tagged books job (background) - Joplin only
router.post("/sync-tagged-books", async (req, res) => {
    try {
        const { port, token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        const apiUrl = port ? `http://localhost:${port}` : "http://localhost:41184";

        // Create job
        const jobId = await JoplinJob.create("sync_tagged_books", apiUrl, token, {});

        // Start processing in background (non-blocking)
        joplinService.processSyncTaggedBooksJob(jobId, apiUrl, token).catch((err) => {
            logger.error("Error processing sync tagged books job", {
                jobId,
                error: err,
            });
        });

        res.json({
            message: "Sync tagged books job started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting sync tagged books job", { error });
        res.status(500).json({ error: "Failed to start sync tagged books job" });
    }
});

// Force sync books to Joplin - rebuilds chunks and syncs (Joplin only)
router.post("/force-sync-books", async (req, res) => {
    try {
        const { port, token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        const apiUrl = port ? `http://localhost:${port}` : "http://localhost:41184";
        const Book = require("../models/book");
        const { getDatabase } = require("../models/database");
        const db = getDatabase();

        // Get all books marked for sync
        const booksToSync = await new Promise((resolve, reject) => {
            db.all(
                "SELECT * FROM books WHERE sync_to_joplin = 1",
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                }
            );
        });

        // Set rebuild_chunks flag for all books to force rebuild
        for (const book of booksToSync) {
            await Book.update(book.id, { rebuild_chunks: true });
        }

        // Create job
        const jobId = await JoplinJob.create("sync_books", apiUrl, token, {
            forceSync: true,
        });

        // Start processing in background (non-blocking)
        joplinService.processSyncBooksJob(jobId, apiUrl, token).catch((err) => {
            logger.error("Error processing force sync books job", {
                jobId,
                error: err,
            });
        });

        res.json({
            message: "Force sync books job started (chunks will be rebuilt)",
            jobId,
            booksCount: booksToSync.length,
        });
    } catch (error) {
        logger.error("Error starting force sync books job", { error });
        res.status(500).json({ error: "Failed to start force sync books job" });
    }
});

// Remove "Ebooks" folder - NOT SUPPORTED FOR ONENOTE
// OneNote uses notebooks/sections structure, not folders
router.post("/remove-ebooks-folder", async (req, res) => {
    res.status(501).json({
        error: "Remove ebooks folder is not supported for OneNote",
        message:
            "OneNote uses notebooks and sections, not folders. Use sync-books with sync_to_onenote=0 to remove sections.",
    });
});

// Remove and recreate book section (background) - OneNote version
router.post("/recreate-book-folder/:bookId", async (req, res) => {
    try {
        const { bookId } = req.params;
        // OneNote uses environment variables for authentication, no params needed

        // Create job (apiUrl and token are not used for OneNote but kept for compatibility)
        const jobId = await JoplinJob.create("recreate_book_folder", "", "", {
            bookId,
        });

        // Start processing in background (non-blocking)
        oneNoteService
            .processRecreateBookSectionJob(jobId, bookId)
            .catch((err) => {
                logger.error("Error processing recreate book section job", {
                    jobId,
                    bookId,
                    error: err,
                });
            });

        res.json({
            message: "Recreate book section job started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting recreate book section job", { error });
        res.status(500).json({
            error: "Failed to start recreate book section job",
        });
    }
});

// Get job status
router.get("/jobs/:jobId", async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await JoplinJob.findById(parseInt(jobId));

        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }

        res.json(job);
    } catch (error) {
        logger.error("Error fetching job status", { error });
        res.status(500).json({ error: "Failed to fetch job status" });
    }
});

// List all jobs
router.get("/jobs", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const jobs = await JoplinJob.findAll(limit);
        res.json(jobs);
    } catch (error) {
        logger.error("Error fetching jobs", { error });
        res.status(500).json({ error: "Failed to fetch jobs" });
    }
});

// Get synced folders from database - NOT SUPPORTED FOR ONENOTE
// OneNote uses notebooks/sections, not folders stored in database
router.get("/folders", async (req, res) => {
    res.status(501).json({
        error: "Folders endpoint is not supported for OneNote",
        message:
            "OneNote uses notebooks and sections, not folders stored in database",
    });
});

// Get synced notes from database - NOT SUPPORTED FOR ONENOTE
// OneNote pages are not stored in database like Joplin notes
router.get("/notes", async (req, res) => {
    res.status(501).json({
        error: "Notes endpoint is not supported for OneNote",
        message: "OneNote pages are not stored in database like Joplin notes",
    });
});

// ========== OneNote Structure Routes ==========

// Get OneNote structure (full tree)
router.get("/onenote/structure", async (req, res) => {
    try {
        const structure = await oneNoteService.getOneNoteStructure();
        res.json(structure);
    } catch (error) {
        logger.error("Error fetching OneNote structure", { error });
        res.status(500).json({
            error: "Failed to fetch OneNote structure",
            message: error.message,
        });
    }
});

// Get OneNote notebooks
router.get("/onenote/notebooks", async (req, res) => {
    try {
        const notebooks = await oneNoteService.getOneNoteNotebooks();
        res.json(notebooks);
    } catch (error) {
        logger.error("Error fetching OneNote notebooks", { error });
        res.status(500).json({
            error: "Failed to fetch OneNote notebooks",
            message: error.message,
        });
    }
});

// Get section groups for a notebook
router.get("/onenote/notebooks/:id/section-groups", async (req, res) => {
    try {
        const { id } = req.params;
        const sectionGroups = await oneNoteService.getOneNoteSectionGroups(id);
        res.json(sectionGroups);
    } catch (error) {
        logger.error("Error fetching OneNote section groups", { error });
        res.status(500).json({
            error: "Failed to fetch OneNote section groups",
            message: error.message,
        });
    }
});

// Get sections (from notebook or section group)
router.get("/onenote/sections", async (req, res) => {
    try {
        const { parentPath } = req.query;
        if (!parentPath) {
            return res.status(400).json({
                error: "parentPath query parameter is required",
            });
        }
        const sections = await oneNoteService.getOneNoteSections(parentPath);
        res.json(sections);
    } catch (error) {
        logger.error("Error fetching OneNote sections", { error });
        res.status(500).json({
            error: "Failed to fetch OneNote sections",
            message: error.message,
        });
    }
});

// Get pages in a section
router.get("/onenote/sections/:id/pages", async (req, res) => {
    try {
        const { id } = req.params;
        const pages = await oneNoteService.getOneNotePages(id);
        res.json(pages);
    } catch (error) {
        logger.error("Error fetching OneNote pages", { error });
        res.status(500).json({
            error: "Failed to fetch OneNote pages",
            message: error.message,
        });
    }
});

// ========== Source Joplin Routes ==========

// Get Joplin sync settings
router.get("/settings", async (req, res) => {
    try {
        const apiUrl =
            (await settingsService.getSettingValue("joplin_api_url")) ||
            "http://localhost:41184";
        const apiToken =
            (await settingsService.getSettingValue("joplin_api_token")) || "";

        res.json({
            apiUrl,
            apiToken,
        });
    } catch (error) {
        logger.error("Error fetching Joplin settings", { error });
        res.status(500).json({ error: "Failed to fetch Joplin settings" });
    }
});

// Save Joplin sync settings
router.post("/settings", async (req, res) => {
    try {
        const { apiUrl, apiToken } = req.body;

        if (apiUrl) {
            await settingsService.setSettingValue("joplin_api_url", apiUrl);
        }
        if (apiToken !== undefined) {
            await settingsService.setSettingValue("joplin_api_token", apiToken);
        }

        res.json({
            message: "Joplin settings saved successfully",
        });
    } catch (error) {
        logger.error("Error saving Joplin settings", { error });
        res.status(500).json({ error: "Failed to save Joplin settings" });
    }
});

// Get source Joplin settings
router.get("/source/settings", async (req, res) => {
    try {
        const apiUrl = await settingsService.getSettingValue(
            "source_joplin_api_url"
        );
        const apiToken = await settingsService.getSettingValue(
            "source_joplin_api_token"
        );
        res.json({
            apiUrl:
                apiUrl ||
                process.env.SOURCE_JOPLIN_API_URL ||
                "http://localhost:41184",
            apiToken: apiToken || "",
        });
    } catch (error) {
        logger.error("Error fetching source Joplin settings", { error });
        res.status(500).json({ error: "Failed to fetch settings" });
    }
});

// Save source Joplin settings
router.post("/source/settings", async (req, res) => {
    try {
        const { apiUrl, apiToken } = req.body;
        if (apiUrl) {
            await settingsService.setSettingValue(
                "source_joplin_api_url",
                apiUrl
            );
        }
        if (apiToken) {
            await settingsService.setSettingValue(
                "source_joplin_api_token",
                apiToken
            );
        }
        res.json({ message: "Settings saved successfully" });
    } catch (error) {
        logger.error("Error saving source Joplin settings", { error });
        res.status(500).json({ error: "Failed to save settings" });
    }
});

// Test source Joplin connection
router.post("/source/test-connection", async (req, res) => {
    try {
        const { apiUrl, apiToken } = req.body;
        if (!apiToken) {
            return res.status(400).json({ error: "Token is required" });
        }
        const isConnected = await joplinService.testConnection({
            apiUrl: apiUrl || "http://localhost:41184",
            apiToken,
        });
        res.json({
            connected: isConnected,
            message: isConnected
                ? "Connection successful"
                : "Connection failed",
        });
    } catch (error) {
        logger.error("Error testing source Joplin connection", { error });
        res.status(500).json({
            error: "Failed to test connection",
            message: error.message,
        });
    }
});

// Start source sync job
router.post("/source/sync", async (req, res) => {
    try {
        const { apiUrl, apiToken } = req.body;
        if (!apiToken) {
            return res.status(400).json({ error: "Token is required" });
        }
        const finalApiUrl = apiUrl || "http://localhost:41184";

        // Save settings if provided
        if (apiUrl) {
            await settingsService.setSettingValue(
                "source_joplin_api_url",
                apiUrl
            );
        }
        if (apiToken) {
            await settingsService.setSettingValue(
                "source_joplin_api_token",
                apiToken
            );
        }

        // Create job
        const jobId = await JoplinJob.create(
            "source_sync",
            finalApiUrl,
            apiToken,
            {}
        );

        // Start processing in background
        joplinSourceService
            .processSourceSyncJob(jobId, { apiUrl: finalApiUrl, apiToken })
            .catch((err) => {
                logger.error("Error processing source sync job", {
                    jobId,
                    error: err,
                });
            });

        res.json({
            message: "Source sync job started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting source sync job", { error });
        res.status(500).json({ error: "Failed to start source sync job" });
    }
});

// Get source tree structure
router.get("/source/tree", async (req, res) => {
    try {
        const tree = await joplinSourceService.buildTree();
        res.json(tree);
    } catch (error) {
        logger.error("Error fetching source tree", { error });
        res.status(500).json({ error: "Failed to fetch source tree" });
    }
});

// Get source folders
router.get("/source/folders", async (req, res) => {
    try {
        const folders = await joplinSourceService.getSourceFolders();
        res.json(folders);
    } catch (error) {
        logger.error("Error fetching source folders", { error });
        res.status(500).json({ error: "Failed to fetch source folders" });
    }
});

// Get source notes
router.get("/source/notes", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 1000;
        const folderId = req.query.folderId; // Optional: filter by folder
        let notes;
        if (folderId !== undefined) {
            // Handle empty string as null for root level notes
            const actualFolderId = folderId === "" ? null : folderId;
            notes = await joplinSourceService.getSourceNotesByFolder(
                actualFolderId
            );
        } else {
            notes = await joplinSourceService.getSourceNotes(limit);
        }
        res.json(notes);
    } catch (error) {
        logger.error("Error fetching source notes", { error });
        res.status(500).json({ error: "Failed to fetch source notes" });
    }
});

// Get folder note count
router.get("/source/folders/:folderId/note-count", async (req, res) => {
    try {
        const { folderId } = req.params;
        const count = await joplinSourceService.getFolderNoteCountFromDB(
            folderId
        );
        res.json({ folderId, count });
    } catch (error) {
        logger.error("Error fetching folder note count", { error });
        res.status(500).json({ error: "Failed to fetch folder note count" });
    }
});

// Remove all "Ebooks" folders from Joplin Source (delete from Joplin and clear database)
router.post("/source/remove-ebooks-folder", async (req, res) => {
    try {
        const { apiUrl, apiToken } =
            await joplinSourceService.getSourceCredentials();

        // Get all folders from Joplin Source
        const folders = await joplinSourceService.apiRequest(
            "GET",
            "/folders",
            null,
            {
                apiUrl,
                apiToken,
            }
        );

        const foldersList = folders.items || [];

        // Find ALL folders named "Ebooks" (case-sensitive exact match)
        const ebooksFolders = foldersList.filter(
            (folder) => folder.title === "Ebooks"
        );

        if (ebooksFolders.length === 0) {
            return res.json({
                message: "No Ebooks folders found in Joplin Source",
                deleted: false,
                deletedCount: 0,
            });
        }

        const db = require("../models/database").getDatabase();
        let totalDeletedFolders = 0;
        let totalDeletedNotes = 0;
        const deletedFolderIds = [];
        const errors = [];

        // Helper function to get all child folders recursively
        const getAllChildFolders = async (parentId) => {
            const childFolders = await new Promise((resolve, reject) => {
                db.all(
                    "SELECT id FROM source_joplin_folders WHERE parent_id = ?",
                    [parentId],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            let allFolders = [parentId];
            for (const folder of childFolders) {
                const subFolders = await getAllChildFolders(folder.id);
                allFolders = allFolders.concat(subFolders);
            }
            return allFolders;
        };

        // Process each "Ebooks" folder
        for (const ebooksFolder of ebooksFolders) {
            try {
                // Delete the "Ebooks" folder from Joplin Source (this will cascade delete all child folders and notes)
                try {
                    await joplinSourceService.apiRequest(
                        "DELETE",
                        `/folders/${ebooksFolder.id}`,
                        null,
                        { apiUrl, apiToken }
                    );
                } catch (deleteError) {
                    // Log warning but continue - folder might not exist in Joplin anymore
                    logger.warn(
                        "Error deleting Ebooks folder from Joplin Source (may not exist)",
                        {
                            folderId: ebooksFolder.id,
                            error: deleteError.message,
                        }
                    );
                }

                // Clean up from database
                const dbFolder = await new Promise((resolve, reject) => {
                    db.get(
                        "SELECT id FROM source_joplin_folders WHERE id = ?",
                        [ebooksFolder.id],
                        (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        }
                    );
                });

                if (dbFolder) {
                    const allFolderIds = await getAllChildFolders(
                        ebooksFolder.id
                    );

                    // Delete all notes in these folders
                    for (const folderId of allFolderIds) {
                        await new Promise((resolve, reject) => {
                            db.run(
                                "DELETE FROM source_joplin_notes WHERE parent_id = ?",
                                [folderId],
                                function (err) {
                                    if (err) reject(err);
                                    else {
                                        totalDeletedNotes += this.changes;
                                        resolve();
                                    }
                                }
                            );
                        });
                    }

                    // Delete all folders
                    for (const folderId of allFolderIds) {
                        await new Promise((resolve, reject) => {
                            db.run(
                                "DELETE FROM source_joplin_folders WHERE id = ?",
                                [folderId],
                                function (err) {
                                    if (err) reject(err);
                                    else {
                                        totalDeletedFolders += this.changes;
                                        resolve();
                                    }
                                }
                            );
                        });
                    }

                    deletedFolderIds.push(ebooksFolder.id);
                }
            } catch (error) {
                logger.error("Error processing Ebooks folder", {
                    folderId: ebooksFolder.id,
                    error: error.message,
                });
                errors.push({
                    folderId: ebooksFolder.id,
                    error: error.message,
                });
            }
        }

        res.json({
            message: `Removed ${ebooksFolders.length} Ebooks folder(s) from Joplin Source`,
            deleted: true,
            deletedCount: deletedFolderIds.length,
            totalDeletedFolders,
            totalDeletedNotes,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch (error) {
        logger.error("Error removing Ebooks folders from Joplin Source", {
            error,
        });
        res.status(500).json({
            error: "Failed to remove Ebooks folders",
            message: error.message,
        });
    }
});

// Search notes by content subtext
router.get("/source/search", async (req, res) => {
    try {
        const { subtext, limit } = req.query;

        if (!subtext || subtext.trim().length === 0) {
            return res.status(400).json({
                error: "subtext parameter is required",
            });
        }

        const searchLimit = limit ? parseInt(limit, 10) : 100;
        const results = await joplinSourceService.searchNotesByContent(
            subtext,
            searchLimit
        );

        // Get folder names for each result
        const resultsWithFolders = await Promise.all(
            results.map(async (note) => {
                let folderName = null;
                if (note.parent_id) {
                    try {
                        folderName =
                            await joplinSourceService.getFolderNameById(
                                note.parent_id
                            );
                    } catch (error) {
                        logger.warn("Error getting folder name", {
                            folderId: note.parent_id,
                            error: error.message,
                        });
                    }
                }
                return {
                    ...note,
                    folderName: folderName || "根目錄",
                };
            })
        );

        res.json({
            subtext,
            count: resultsWithFolders.length,
            results: resultsWithFolders,
        });
    } catch (error) {
        logger.error("Error searching notes", { error });
        res.status(500).json({
            error: "Failed to search notes",
            message: error.message,
        });
    }
});

// Import note from source
// Debug endpoint to scan database for specific folder
router.get("/source/debug/folder/:folderName", async (req, res) => {
    try {
        const { folderName } = req.params;
        const { getDatabase } = require("../models/database");
        const db = getDatabase();

        // Search for folder by name (case-insensitive)
        db.all(
            `SELECT * FROM source_joplin_folders 
             WHERE LOWER(title) LIKE LOWER(?) 
             ORDER BY title`,
            [`%${folderName}%`],
            (err, folders) => {
                if (err) {
                    logger.error("Error searching for folder", { error: err });
                    return res
                        .status(500)
                        .json({ error: "Failed to search folder" });
                }

                // For each matching folder, check if parent exists
                const results = folders.map((folder) => {
                    let parentExists = null;
                    if (folder.parent_id) {
                        db.get(
                            "SELECT id, title FROM source_joplin_folders WHERE id = ?",
                            [folder.parent_id],
                            (err, parent) => {
                                if (err) {
                                    logger.error("Error checking parent", {
                                        error: err,
                                    });
                                }
                            }
                        );
                    }
                    return {
                        ...folder,
                        parentExists: parentExists,
                    };
                });

                // Also check root folders
                db.all(
                    `SELECT * FROM source_joplin_folders 
                     WHERE parent_id IS NULL OR parent_id = '' 
                     ORDER BY title`,
                    [],
                    (err, rootFolders) => {
                        if (err) {
                            logger.error("Error fetching root folders", {
                                error: err,
                            });
                        }

                        // Check folders with missing parents
                        db.all(
                            `SELECT f1.* 
                             FROM source_joplin_folders f1
                             LEFT JOIN source_joplin_folders f2 ON f1.parent_id = f2.id
                             WHERE f1.parent_id IS NOT NULL 
                             AND f1.parent_id != ''
                             AND f2.id IS NULL
                             ORDER BY f1.title`,
                            [],
                            (err, orphanedFolders) => {
                                if (err) {
                                    logger.error(
                                        "Error fetching orphaned folders",
                                        { error: err }
                                    );
                                }

                                res.json({
                                    searchTerm: folderName,
                                    matchingFolders: folders,
                                    rootFolders: rootFolders || [],
                                    orphanedFolders: orphanedFolders || [],
                                    totalFolders: folders.length,
                                    totalRootFolders: (rootFolders || [])
                                        .length,
                                    totalOrphanedFolders: (
                                        orphanedFolders || []
                                    ).length,
                                });
                            }
                        );
                    }
                );
            }
        );
    } catch (error) {
        logger.error("Error in debug folder endpoint", { error });
        res.status(500).json({
            error: "Failed to debug folder",
            message: error.message,
        });
    }
});

// Debug endpoint to get all root folders and orphaned folders
router.get("/source/debug/root-folders", async (req, res) => {
    try {
        const { getDatabase } = require("../models/database");
        const db = getDatabase();

        // Get all folders
        db.all(
            "SELECT * FROM source_joplin_folders ORDER BY title",
            [],
            (err, allFolders) => {
                if (err) {
                    logger.error("Error fetching all folders", { error: err });
                    return res
                        .status(500)
                        .json({ error: "Failed to fetch folders" });
                }

                // Get root folders (no parent_id or empty parent_id)
                db.all(
                    `SELECT * FROM source_joplin_folders 
                 WHERE parent_id IS NULL OR parent_id = '' 
                 ORDER BY title`,
                    [],
                    (err, rootFolders) => {
                        if (err) {
                            logger.error("Error fetching root folders", {
                                error: err,
                            });
                            return res.status(500).json({
                                error: "Failed to fetch root folders",
                            });
                        }

                        // Get folders with missing parents
                        db.all(
                            `SELECT f1.* 
                         FROM source_joplin_folders f1
                         LEFT JOIN source_joplin_folders f2 ON f1.parent_id = f2.id
                         WHERE f1.parent_id IS NOT NULL 
                         AND f1.parent_id != ''
                         AND f2.id IS NULL
                         ORDER BY f1.title`,
                            [],
                            (err, orphanedFolders) => {
                                if (err) {
                                    logger.error(
                                        "Error fetching orphaned folders",
                                        { error: err }
                                    );
                                    return res.status(500).json({
                                        error: "Failed to fetch orphaned folders",
                                    });
                                }

                                // Build folder map to check parent relationships
                                const folderMap = {};
                                allFolders.forEach((f) => {
                                    folderMap[f.id] = f;
                                });

                                // Check each folder's parent status
                                const folderAnalysis = allFolders.map(
                                    (folder) => {
                                        const hasParent =
                                            folder.parent_id &&
                                            folder.parent_id !== "";
                                        const parentExists = hasParent
                                            ? folderMap[folder.parent_id] !==
                                              undefined
                                            : null;
                                        const isRoot = !hasParent;
                                        const isOrphaned =
                                            hasParent && !parentExists;

                                        return {
                                            id: folder.id,
                                            title: folder.title,
                                            parent_id: folder.parent_id,
                                            hasParent,
                                            parentExists,
                                            isRoot,
                                            isOrphaned,
                                        };
                                    }
                                );

                                res.json({
                                    totalFolders: allFolders.length,
                                    rootFolders: rootFolders || [],
                                    orphanedFolders: orphanedFolders || [],
                                    folderAnalysis: folderAnalysis.filter(
                                        (f) => f.isRoot || f.isOrphaned
                                    ),
                                    allFolders: allFolders.map((f) => ({
                                        id: f.id,
                                        title: f.title,
                                        parent_id: f.parent_id,
                                    })),
                                });
                            }
                        );
                    }
                );
            }
        );
    } catch (error) {
        logger.error("Error in debug root folders endpoint", { error });
        res.status(500).json({
            error: "Failed to debug root folders",
            message: error.message,
        });
    }
});

router.post("/source/import", async (req, res) => {
    try {
        const { noteIds, folderIds } = req.body;
        if (!noteIds && !folderIds) {
            return res
                .status(400)
                .json({ error: "noteIds or folderIds is required" });
        }

        // Get source credentials for the job
        const { apiUrl, apiToken } =
            await joplinSourceService.getSourceCredentials();

        // Create job with configuration
        const jobId = await JoplinJob.create(
            "source_import",
            apiUrl,
            apiToken,
            {
                noteIds: noteIds || [],
                folderIds: folderIds || [],
            }
        );

        logger.info(
            `Created source import job ${jobId} with ${
                noteIds?.length || 0
            } note(s) and ${folderIds?.length || 0} folder(s)`
        );

        // Start processing in background (non-blocking)
        joplinSourceService
            .processSourceImportJob(jobId, {
                noteIds: noteIds || [],
                folderIds: folderIds || [],
                overrides: { apiUrl, apiToken },
            })
            .catch((err) => {
                logger.error("Error processing source import job", {
                    jobId,
                    error: err,
                });
            });

        res.json({
            message: "Import job started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting source import job", { error });
        res.status(500).json({ error: "Failed to start import job" });
    }
});

module.exports = router;
