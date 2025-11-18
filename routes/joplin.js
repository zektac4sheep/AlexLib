const express = require("express");
const router = express.Router();
const joplinService = require("../services/joplinService");
const joplinSourceService = require("../services/joplinSourceService");
const settingsService = require("../services/settingsService");
const JoplinJob = require("../models/joplinJob");
const logger = require("../utils/logger");

// Test Joplin connection
router.post("/test-connection", async (req, res) => {
    try {
        const { port = 41184, token } = req.body;

        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

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
    } catch (error) {
        logger.error("Error testing Joplin connection", { error });
        res.status(500).json({
            error: "Failed to test connection",
            message: error.message,
        });
    }
});

// Start sync structure job (background)
router.post("/sync-structure", async (req, res) => {
    try {
        const { port = 41184, token } = req.body;

        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        const apiUrl = `http://localhost:${port}`;

        // Create job
        const jobId = await JoplinJob.create(
            "sync_structure",
            apiUrl,
            token,
            {}
        );

        // Start processing in background (non-blocking)
        joplinService
            .processSyncStructureJob(jobId, apiUrl, token)
            .catch((err) => {
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

// Start sync books job (background) - sync all books marked with sync_to_joplin=1
router.post("/sync-books", async (req, res) => {
    try {
        const { port = 41184, token } = req.body;

        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        const apiUrl = `http://localhost:${port}`;

        // Create job
        const jobId = await JoplinJob.create("sync_books", apiUrl, token, {});

        // Start processing in background (non-blocking)
        joplinService.processSyncBooksJob(jobId, apiUrl, token).catch((err) => {
            logger.error("Error processing sync books job", {
                jobId,
                error: err,
            });
        });

        res.json({
            message: "Sync books job started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting sync books job", { error });
        res.status(500).json({ error: "Failed to start sync books job" });
    }
});

// Start sync tagged books job (background) - sync all books that have tags
router.post("/sync-tagged-books", async (req, res) => {
    try {
        const { port = 41184, token } = req.body;

        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        const apiUrl = `http://localhost:${port}`;

        // Create job
        const jobId = await JoplinJob.create(
            "sync_tagged_books",
            apiUrl,
            token,
            {}
        );

        // Start processing in background (non-blocking)
        joplinService
            .processSyncTaggedBooksJob(jobId, apiUrl, token)
            .catch((err) => {
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
        res.status(500).json({
            error: "Failed to start sync tagged books job",
        });
    }
});

// Remove and recreate book folder (background)
router.post("/recreate-book-folder/:bookId", async (req, res) => {
    try {
        const { bookId } = req.params;
        const { port = 41184, token } = req.body;

        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        const apiUrl = `http://localhost:${port}`;

        // Create job
        const jobId = await JoplinJob.create(
            "recreate_book_folder",
            apiUrl,
            token,
            { bookId }
        );

        // Start processing in background (non-blocking)
        joplinService
            .processRecreateBookFolderJob(
                jobId,
                apiUrl,
                token,
                parseInt(bookId)
            )
            .catch((err) => {
                logger.error("Error processing recreate book folder job", {
                    jobId,
                    bookId,
                    error: err,
                });
            });

        res.json({
            message: "Recreate book folder job started",
            jobId,
        });
    } catch (error) {
        logger.error("Error starting recreate book folder job", { error });
        res.status(500).json({
            error: "Failed to start recreate book folder job",
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

// Get synced folders from database
router.get("/folders", async (req, res) => {
    try {
        const { getDatabase } = require("../models/database");
        const db = getDatabase();

        db.all(
            "SELECT * FROM joplin_folders ORDER BY title",
            [],
            (err, rows) => {
                if (err) {
                    logger.error("Error fetching folders", { error: err });
                    return res
                        .status(500)
                        .json({ error: "Failed to fetch folders" });
                }
                res.json(rows);
            }
        );
    } catch (error) {
        logger.error("Error fetching folders", { error });
        res.status(500).json({ error: "Failed to fetch folders" });
    }
});

// Get synced notes from database
router.get("/notes", async (req, res) => {
    try {
        const { getDatabase } = require("../models/database");
        const db = getDatabase();
        const limit = parseInt(req.query.limit) || 100;

        db.all(
            "SELECT * FROM joplin_notes ORDER BY updated_time DESC LIMIT ?",
            [limit],
            (err, rows) => {
                if (err) {
                    logger.error("Error fetching notes", { error: err });
                    return res
                        .status(500)
                        .json({ error: "Failed to fetch notes" });
                }
                res.json(rows);
            }
        );
    } catch (error) {
        logger.error("Error fetching notes", { error });
        res.status(500).json({ error: "Failed to fetch notes" });
    }
});

// ========== Source Joplin Routes ==========

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
