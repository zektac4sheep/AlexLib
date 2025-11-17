const axios = require("axios");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { getDatabase } = require("../models/database");
const settingsService = require("./settingsService");
const textProcessor = require("./textProcessor");

const DEFAULT_SOURCE_URL =
    process.env.SOURCE_JOPLIN_API_URL || "http://localhost:41184";
const DEFAULT_TOKEN = process.env.SOURCE_JOPLIN_API_TOKEN || "";
const NOTE_BATCH_SIZE = 100;
const SOURCE_NOTES_DIR =
    process.env.SOURCE_FOLDER || path.join(__dirname, "../source");

function ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

ensureDirectory(SOURCE_NOTES_DIR);

function sanitizeFilename(name) {
    return (name || "untitled")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
}

function getNoteFilePath(note) {
    const folderSegment = note.parent_id || "__root";
    const folderDir = path.join(SOURCE_NOTES_DIR, folderSegment);
    ensureDirectory(folderDir);
    const safeTitle = sanitizeFilename(note.title || "note");
    return path.join(folderDir, `${safeTitle}-${note.id}.md`);
}

function writeNoteToFile(note) {
    const filePath = getNoteFilePath(note);
    fs.writeFileSync(filePath, note.body || "", "utf-8");
    return filePath;
}

function clearSourceNoteFiles() {
    if (fs.existsSync(SOURCE_NOTES_DIR)) {
        fs.rmSync(SOURCE_NOTES_DIR, { recursive: true, force: true });
    }
    ensureDirectory(SOURCE_NOTES_DIR);
}

async function getSourceCredentials(overrides = {}) {
    const storedUrl =
        overrides.apiUrl ||
        (await settingsService.getSettingValue("source_joplin_api_url")) ||
        DEFAULT_SOURCE_URL;
    const storedToken =
        overrides.apiToken ||
        (await settingsService.getSettingValue("source_joplin_api_token")) ||
        DEFAULT_TOKEN;

    if (!storedToken) {
        throw new Error(
            "Source Joplin API token is missing. Please configure it in the Joplin tab."
        );
    }

    return {
        apiUrl: storedUrl,
        apiToken: storedToken,
    };
}

async function apiRequest(method, endpoint, data = null, overrides = {}) {
    const { apiUrl, apiToken } = await getSourceCredentials(overrides);
    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${apiUrl}${endpoint}${separator}token=${encodeURIComponent(
        apiToken
    )}`;
    const config = {
        method,
        url,
        headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
        },
    };

    if (data) {
        config.data = data;
    }

    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        logger.error("Source Joplin API request failed", {
            method,
            endpoint,
            error: error.response?.data || error.message,
            status: error.response?.status,
        });
        throw error;
    }
}

async function clearSourceTables() {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Delete notes first (due to foreign key constraint)
            db.run("DELETE FROM source_joplin_notes", (noteErr) => {
                if (noteErr) {
                    logger.error("Error deleting source_joplin_notes", {
                        error: noteErr,
                    });
                    reject(noteErr);
                    return;
                }
                // Then delete folders
                db.run("DELETE FROM source_joplin_folders", (folderErr) => {
                    if (folderErr) {
                        logger.error("Error deleting source_joplin_folders", {
                            error: folderErr,
                        });
                        reject(folderErr);
                    } else {
                        clearSourceNoteFiles();
                        logger.info(
                            "Source tables cleared: deleted all notes and folders"
                        );
                        resolve();
                    }
                });
            });
        });
    });
}

async function insertFolders(items) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(
            `INSERT OR REPLACE INTO source_joplin_folders (
                id, title, parent_id, created_time, updated_time,
                user_created_time, user_updated_time, encryption_cipher_text,
                encryption_applied, is_shared, type_, sync_status, note_count, last_synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        );

        const targetFolderId = process.env.DEBUG_FOLDER_ID;

        db.serialize(() => {
            items.forEach((folder) => {
                // Log if this is the target folder we're looking for
                if (targetFolderId && folder.id === targetFolderId) {
                    logger.info(
                        `Inserting target folder: "${folder.title}" (${
                            folder.id
                        }), parent_id: ${folder.parent_id || "(null)"}`
                    );
                }

                stmt.run([
                    folder.id,
                    folder.title,
                    folder.parent_id || null,
                    folder.created_time || null,
                    folder.updated_time || null,
                    folder.user_created_time || null,
                    folder.user_updated_time || null,
                    folder.encryption_cipher_text || null,
                    folder.encryption_applied || 0,
                    folder.is_shared || 0,
                    folder.type_ || 1,
                    folder.sync_status || 0,
                    folder.note_count || 0, // Note count will be set when counting notes
                ]);
            });
            stmt.finalize((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

async function insertNotes(items) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(
            `INSERT OR REPLACE INTO source_joplin_notes (
                id, parent_id, title, body, created_time, updated_time,
                user_created_time, user_updated_time, encryption_cipher_text,
                encryption_applied, is_todo, todo_due, todo_completed,
                source_url, source_application, application_data,
                order_, latitude, longitude, altitude, author, source, size,
                last_synced_at, file_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
        );

        let inserted = 0;
        let errors = 0;

        db.serialize(() => {
            items.forEach((note) => {
                const bodySize =
                    note._bodySize !== undefined
                        ? note._bodySize
                        : note.body
                        ? Buffer.byteLength(note.body, "utf8")
                        : 0;
                stmt.run(
                    [
                        note.id,
                        note.parent_id,
                        note.title || "",
                        note.body || null,
                        note.created_time || null,
                        note.updated_time || null,
                        note.user_created_time || null,
                        note.user_updated_time || null,
                        note.encryption_cipher_text || null,
                        note.encryption_applied || 0,
                        note.is_todo || 0,
                        note.todo_due || null,
                        note.todo_completed || null,
                        note.source_url || null,
                        note.source_application || null,
                        note.application_data || null,
                        note.order_ || 0,
                        note.latitude || null,
                        note.longitude || null,
                        note.altitude || null,
                        note.author || null,
                        note.source || null,
                        bodySize,
                        note.file_path || null,
                    ],
                    (err) => {
                        if (err) {
                            errors++;
                            logger.error("Error inserting note", {
                                noteId: note.id,
                                noteTitle: note.title,
                                parentId: note.parent_id,
                                error: err,
                            });
                        } else {
                            inserted++;
                        }
                    }
                );
            });
            stmt.finalize((err) => {
                if (err) {
                    logger.error("Error finalizing note insert statement", {
                        error: err,
                    });
                    reject(err);
                } else {
                    logger.info(
                        `Note insertion completed: ${inserted} inserted, ${errors} errors`
                    );
                    resolve();
                }
            });
        });
    });
}

async function updateFolderNoteCounts() {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        db.run(
            `
            UPDATE source_joplin_folders
            SET note_count = (
                SELECT COUNT(*)
                FROM source_joplin_notes sn
                WHERE sn.parent_id = source_joplin_folders.id
            )
            `,
            (err) => {
                if (err) {
                    logger.error("Error updating folder note counts", {
                        error: err,
                    });
                    reject(err);
                } else {
                    logger.info("Folder note counts updated successfully");
                    resolve();
                }
            }
        );
    });
}

async function mirrorSourceTree(overrides = {}, progressCb = null) {
    // Clear existing source data before syncing
    logger.info("Clearing source Joplin tables before sync");
    try {
        await clearSourceTables();
        logger.info("Source Joplin tables cleared successfully");
    } catch (error) {
        logger.error("Error clearing source Joplin tables", {
            error: error.message,
        });
        throw new Error(`Failed to clear source tables: ${error.message}`);
    }

    logger.info("Fetching folders from source Joplin API");

    // Fetch folders with pagination (Joplin API paginates results)
    let allFolders = [];
    let folderPage = 1;
    let hasMoreFolders = true;
    const FOLDER_BATCH_SIZE = 100; // Joplin API default page size

    while (hasMoreFolders) {
        logger.info(
            `Fetching folders page ${folderPage} (batch size: ${FOLDER_BATCH_SIZE})`
        );
        const folders = await apiRequest(
            "GET",
            `/folders?fields=id,title,parent_id,created_time,updated_time,user_created_time,user_updated_time,encryption_cipher_text,encryption_applied,is_shared&limit=${FOLDER_BATCH_SIZE}&page=${folderPage}`,
            null,
            overrides
        );

        const pageFolderCount = folders.items?.length || 0;
        logger.info(
            `Fetched ${pageFolderCount} folders from page ${folderPage}`
        );

        if (pageFolderCount > 0) {
            allFolders.push(...folders.items);
            // Check if there are more pages (Joplin API returns has_more or we check if we got a full page)
            if (pageFolderCount < FOLDER_BATCH_SIZE) {
                hasMoreFolders = false;
                logger.info(
                    `Last page reached (got ${pageFolderCount} folders, less than batch size ${FOLDER_BATCH_SIZE})`
                );
            } else {
                folderPage += 1;
            }
        } else {
            hasMoreFolders = false;
            logger.info(
                `No more folders to fetch (page ${folderPage} returned empty)`
            );
        }
    }

    const folderCount = allFolders.length;
    logger.info(
        `Fetched total ${folderCount} folders from source Joplin (across ${folderPage} page(s))`
    );

    // Log specific folder IDs for debugging
    if (allFolders.length > 0) {
        const folderIds = allFolders.map((f) => f.id);
        logger.info(
            `Folder IDs in sync: ${folderIds.slice(0, 10).join(", ")}${
                folderIds.length > 10 ? ` ... (${folderIds.length} total)` : ""
            }`
        );

        // Check for specific folder if provided
        const targetFolderId = process.env.DEBUG_FOLDER_ID;
        if (targetFolderId) {
            const found = allFolders.find((f) => f.id === targetFolderId);
            if (found) {
                logger.info(
                    `Target folder found: "${found.title}" (${
                        found.id
                    }), parent_id: ${found.parent_id || "(null)"}`
                );
            } else {
                logger.warn(
                    `Target folder NOT found in sync: ${targetFolderId}`
                );
            }
        }
    }

    if (allFolders.length) {
        logger.info(`Inserting ${allFolders.length} folders into database`);
        await insertFolders(allFolders);
        logger.info(`Successfully inserted ${allFolders.length} folders`);

        // Log folder structure info
        const rootFolders = allFolders.filter(
            (f) => !f.parent_id || f.parent_id === ""
        );
        const childFolders = allFolders.filter(
            (f) => f.parent_id && f.parent_id !== ""
        );
        logger.info(
            `Folder structure: ${rootFolders.length} root folders, ${childFolders.length} child folders`
        );

        if (progressCb) {
            progressCb({ folders: allFolders.length, notes: 0 });
        }
    } else {
        logger.warn("No folders found in source Joplin");
    }

    // === Fetch notes ===
    logger.info("Fetching notes from source Joplin API");
    let totalNotes = 0;
    let notesPage = 1;
    let hasMoreNotes = true;

    while (hasMoreNotes) {
        logger.info(
            `Fetching notes page ${notesPage} (batch size: ${NOTE_BATCH_SIZE})`
        );
        const notesResponse = await apiRequest(
            "GET",
            `/notes?fields=id,parent_id,title,body,created_time,updated_time,user_created_time,user_updated_time,encryption_cipher_text,encryption_applied,is_todo,todo_due,todo_completed,source_url,source_application,application_data,latitude,longitude,altitude,author,source&limit=${NOTE_BATCH_SIZE}&page=${notesPage}`,
            null,
            overrides
        );

        const pageNoteCount = notesResponse.items?.length || 0;
        logger.info(`Fetched ${pageNoteCount} notes from page ${notesPage}`);

        if (pageNoteCount > 0) {
            const notesWithFiles = notesResponse.items.map((note) => {
                let filePath = null;
                try {
                    filePath = writeNoteToFile(note);
                } catch (error) {
                    logger.error("Failed to write note to file during sync", {
                        noteId: note.id,
                        error,
                    });
                }

                const bodySize = note.body
                    ? Buffer.byteLength(note.body, "utf8")
                    : 0;

                return {
                    ...note,
                    body: null,
                    file_path: filePath,
                    _bodySize: bodySize,
                };
            });

            await insertNotes(notesWithFiles);
            totalNotes += notesWithFiles.length;

            if (progressCb) {
                progressCb({
                    folders: folderCount,
                    notes: totalNotes,
                });
            }

            if (pageNoteCount < NOTE_BATCH_SIZE) {
                hasMoreNotes = false;
                logger.info(
                    `Last note page reached (got ${pageNoteCount} notes, less than batch size ${NOTE_BATCH_SIZE})`
                );
            } else {
                notesPage += 1;
            }
        } else {
            hasMoreNotes = false;
            logger.info(
                `No more notes to fetch (page ${notesPage} returned empty)`
            );
        }
    }

    logger.info(
        `Fetched total ${totalNotes} notes from source Joplin (across ${notesPage} page(s))`
    );

    // Update folder note counts based on inserted notes
    await updateFolderNoteCounts();

    logger.info(
        `Sync completed: ${folderCount} folders and ${totalNotes} notes synced`
    );

    if (progressCb) {
        progressCb({
            folders: folderCount,
            notes: totalNotes,
        });
    }

    return {
        folders: folderCount,
        notes: totalNotes,
    };
}

async function getSourceFolders() {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM source_joplin_folders ORDER BY title",
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

async function getSourceNotesByFolder(parentId) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        // Handle root level notes (parentId is null or empty)
        if (!parentId || parentId === "") {
            db.all(
                "SELECT * FROM source_joplin_notes WHERE parent_id IS NULL OR parent_id = '' ORDER BY title",
                [],
                (err, rows) => {
                    if (err) {
                        logger.error("Error fetching root level notes", {
                            error: err,
                        });
                        reject(err);
                    } else {
                        logger.info(
                            `Fetched ${rows?.length || 0} root level notes`
                        );
                        resolve(rows || []);
                    }
                }
            );
        } else {
            db.all(
                "SELECT * FROM source_joplin_notes WHERE parent_id = ? ORDER BY title",
                [parentId],
                (err, rows) => {
                    if (err) {
                        logger.error("Error fetching notes for folder", {
                            folderId: parentId,
                            error: err,
                        });
                        reject(err);
                    } else {
                        logger.info(
                            `Fetched ${
                                rows?.length || 0
                            } notes for folder ${parentId}`
                        );
                        resolve(rows || []);
                    }
                }
            );
        }
    });
}

async function getSourceNotes(limit = 500) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM source_joplin_notes ORDER BY updated_time DESC LIMIT ?",
            [limit],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

async function getNoteById(noteId) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT * FROM source_joplin_notes WHERE id = ?",
            [noteId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            }
        );
    });
}

/**
 * Search notes by content subtext
 * @param {string} subtext - The text to search for
 * @param {number} limit - Maximum number of results (default: 100)
 * @returns {Promise<Array>} Array of notes containing the subtext
 */
async function searchNotesByContent(subtext, limit = 100) {
    if (!subtext || subtext.trim().length === 0) {
        return [];
    }

    const db = getDatabase();
    return new Promise((resolve, reject) => {
        // Search in both body (from file) and title
        // First try to read from file_path if available, otherwise use body from DB
        db.all(
            `SELECT id, parent_id, title, body, file_path, updated_time, created_time
             FROM source_joplin_notes
             WHERE title LIKE ? OR body LIKE ?
             ORDER BY updated_time DESC
             LIMIT ?`,
            [`%${subtext}%`, `%${subtext}%`, limit],
            async (err, rows) => {
                if (err) {
                    logger.error("Error searching notes by content", {
                        error: err,
                        subtext,
                    });
                    reject(err);
                    return;
                }

                // For notes with file_path, read the file content to search
                const results = [];
                for (const row of rows) {
                    let content = row.body || "";

                    // If file_path exists, try to read from file
                    if (row.file_path && fs.existsSync(row.file_path)) {
                        try {
                            const fileContent = fs.readFileSync(
                                row.file_path,
                                "utf-8"
                            );
                            // Check if subtext is in file content
                            if (
                                fileContent.includes(subtext) ||
                                row.title.includes(subtext)
                            ) {
                                // Extract context around the match (first 500 chars)
                                const index = fileContent.indexOf(subtext);
                                const start = Math.max(0, index - 100);
                                const end = Math.min(
                                    fileContent.length,
                                    index + subtext.length + 400
                                );
                                const context = fileContent.substring(
                                    start,
                                    end
                                );

                                results.push({
                                    ...row,
                                    body: fileContent, // Full content
                                    matchContext: context, // Context around match
                                    matchInTitle: row.title.includes(subtext),
                                    matchInContent:
                                        fileContent.includes(subtext),
                                });
                            }
                        } catch (fileError) {
                            logger.warn("Error reading note file", {
                                filePath: row.file_path,
                                error: fileError.message,
                            });
                            // Fallback to DB body if file read fails
                            if (content.includes(subtext)) {
                                results.push({
                                    ...row,
                                    matchContext: content.substring(
                                        0,
                                        Math.min(500, content.length)
                                    ),
                                    matchInTitle: row.title.includes(subtext),
                                    matchInContent: content.includes(subtext),
                                });
                            }
                        }
                    } else {
                        // No file, use DB body
                        if (
                            content.includes(subtext) ||
                            row.title.includes(subtext)
                        ) {
                            results.push({
                                ...row,
                                matchContext: content.substring(
                                    0,
                                    Math.min(500, content.length)
                                ),
                                matchInTitle: row.title.includes(subtext),
                                matchInContent: content.includes(subtext),
                            });
                        }
                    }
                }

                resolve(results);
            }
        );
    });
}

async function refreshNote(noteId, overrides = {}) {
    const note = await apiRequest("GET", `/notes/${noteId}`, null, overrides);
    if (note) {
        let filePath = null;
        try {
            filePath = writeNoteToFile(note);
        } catch (error) {
            logger.error("Failed to refresh note file", {
                noteId,
                error,
            });
        }

        const bodySize = note.body ? Buffer.byteLength(note.body, "utf8") : 0;

        await insertNotes([
            {
                ...note,
                body: null,
                file_path: filePath,
                _bodySize: bodySize,
            },
        ]);
    }
    return getNoteById(noteId);
}

async function buildTree() {
    logger.info("Building source Joplin tree structure");
    const folders = await getSourceFolders();
    const notes = await getSourceNotes();

    logger.info(
        `Building tree from ${folders.length} folders and ${notes.length} notes`
    );

    const folderMap = {};
    const orphanedNotes = [];

    // Build folder map
    folders.forEach((folder) => {
        folderMap[folder.id] = {
            id: folder.id,
            title: folder.title,
            parent_id: folder.parent_id || null,
            type: "folder",
            children: [],
        };
    });

    logger.info(
        `Created folder map with ${Object.keys(folderMap).length} folders`
    );

    // Build folder hierarchy
    Object.values(folderMap).forEach((folder) => {
        if (folder.parent_id && folderMap[folder.parent_id]) {
            // Valid parent exists, add to parent's children
            folderMap[folder.parent_id].children.push(folder);
        } else if (folder.parent_id) {
            // Parent doesn't exist - treat as root level folder (not orphaned)
            // This happens when parent folder wasn't synced or was deleted
            logger.warn(
                `Folder with missing parent treated as root: ${folder.title} (id: ${folder.id}, parent_id: ${folder.parent_id})`
            );
            // Don't add to orphanedFolders - it will be included in roots below
        }
        // If no parent_id, it's already a root folder and will be included in roots filter
    });

    // Add notes to folders
    notes.forEach((note) => {
        const node = {
            id: note.id,
            title: note.title || "(無標題)",
            parent_id: note.parent_id,
            type: "note",
            note,
        };
        if (note.parent_id && folderMap[note.parent_id]) {
            folderMap[note.parent_id].children.push(node);
        } else if (note.parent_id) {
            // Orphaned note (parent folder doesn't exist)
            orphanedNotes.push(node);
            logger.warn(
                `Orphaned note found: ${node.title} (id: ${node.id}, parent_id: ${note.parent_id})`
            );
        } else {
            // Note without parent_id (root level note)
            orphanedNotes.push(node);
        }
    });

    // Get root folders:
    // 1. Folders without parent_id or with empty parent_id
    // 2. Folders whose parent_id doesn't exist in folderMap (missing parent)
    const roots = Object.values(folderMap).filter((folder) => {
        if (folder.type !== "folder") return false;

        // True root folders (no parent_id)
        if (!folder.parent_id || folder.parent_id === "") {
            return true;
        }

        // Folders with missing parents should be treated as root
        if (!folderMap[folder.parent_id]) {
            logger.info(
                `Treating folder as root (parent missing): ${folder.title} (id: ${folder.id}, parent_id: ${folder.parent_id})`
            );
            return true;
        }

        return false;
    });

    logger.info(`Found ${roots.length} root folders`);

    // If there are orphaned notes (notes with missing parents), create a special root folder for them
    if (orphanedNotes.length > 0) {
        logger.info(
            `Creating root folder for ${orphanedNotes.length} orphaned notes`
        );
        const orphanedRoot = {
            id: "__orphaned",
            title: "未分類/孤立筆記",
            type: "folder",
            children: orphanedNotes,
        };
        roots.push(orphanedRoot);
    }

    // If no root folders found but we have folders, something is wrong - log warning
    if (roots.length === 0 && folders.length > 0) {
        logger.warn(
            "No root folders found despite having folders - this should not happen"
        );
        // Fallback: show all folders as root
        roots.push(
            ...Object.values(folderMap).filter((f) => f.type === "folder")
        );
    }

    logger.info(`Tree built successfully: ${roots.length} root items`);
    return roots;
}

function stripTags(content) {
    if (!content) return "";

    // Remove Joplin tags (format: #tag or #tag1 #tag2)
    // Tags can be at the beginning, middle, or end of lines
    // Also remove [toc] tags
    let cleaned = content;

    // Remove [toc] tags (case insensitive)
    cleaned = cleaned.replace(/\[toc\]/gi, "");

    // Remove Joplin tags (#tag format)
    // Match # followed by alphanumeric characters, underscores, hyphens, or Chinese characters
    // Tags can be standalone or at the start/end of lines
    cleaned = cleaned.replace(/#[\w\u4e00-\u9fff-]+/g, "");

    // Clean up extra whitespace that might be left behind
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, "\n\n"); // Multiple blank lines to double
    cleaned = cleaned.replace(/^\s+|\s+$/gm, ""); // Trim each line

    return cleaned.trim();
}

async function getFolderNoteCountFromDB(folderId) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        // Use note_count column from folders table (set during sync)
        db.get(
            "SELECT note_count FROM source_joplin_folders WHERE id = ?",
            [folderId],
            (err, row) => {
                if (err) {
                    logger.error("Error getting note count for folder", {
                        folderId,
                        error: err,
                    });
                    reject(err);
                } else {
                    resolve(row?.note_count || 0);
                }
            }
        );
    });
}

/**
 * Get folder ID and all its subfolder IDs recursively
 * @param {string} folderId - The folder ID to start from
 * @returns {Promise<string[]>} Array of folder IDs including the folder itself and all subfolders
 */
async function getFolderAndSubfolderIds(folderId) {
    const folders = await getSourceFolders();
    const folderIds = new Set([folderId]);
    const queue = [folderId];

    // Recursively find all subfolders
    while (queue.length > 0) {
        const current = queue.shift();
        folders
            .filter((f) => f.parent_id === current)
            .forEach((child) => {
                if (!folderIds.has(child.id)) {
                    folderIds.add(child.id);
                    queue.push(child.id);
                }
            });
    }

    return Array.from(folderIds);
}

/**
 * Get folder name by ID from database
 * @param {string} folderId - Folder ID
 * @returns {Promise<string>} Folder name or fallback string
 */
async function getFolderNameById(folderId) {
    const db = getDatabase();
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT title FROM source_joplin_folders WHERE id = ?",
            [folderId],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row?.title || `[Folder ID: ${folderId}]`);
                }
            }
        );
    });
}

async function collectNotesFromFolders(folderIds) {
    if (!folderIds || folderIds.length === 0) {
        return [];
    }

    const uniqueFolderIds = [...new Set(folderIds)];
    const db = getDatabase();

    logger.info(
        `[Source DB] Collecting notes for ${uniqueFolderIds.length} folder(s) from local cache`
    );

    return new Promise((resolve, reject) => {
        const placeholders = uniqueFolderIds.map(() => "?").join(",");
        const sql = `
            SELECT *
            FROM source_joplin_notes
            WHERE parent_id IN (${placeholders})
        `;
        db.all(sql, uniqueFolderIds, (err, rows) => {
            if (err) {
                logger.error("Error collecting notes from database", { err });
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

/**
 * Collect notes from a single folder (not including subfolders)
 * @param {string} folderId - The folder ID to collect notes from
 * @returns {Promise<Array>} Array of all notes from the folder only (not subfolders)
 */
async function collectNotesForFolder(folderId) {
    return await collectNotesFromFolders([folderId]);
}

async function processSourceSyncJob(jobId, overrides = {}) {
    const JoplinJob = require("../models/joplinJob");
    try {
        await JoplinJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        const result = await mirrorSourceTree(overrides, (progress) => {
            JoplinJob.update(jobId, {
                progress_data: progress,
                completed_items: progress.notes,
                total_items: progress.notes,
            }).catch((err) =>
                logger.error("Error updating source sync progress", { err })
            );
        });

        await JoplinJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
            progress_data: result,
            completed_items: result.notes,
            total_items: result.notes,
        });
    } catch (error) {
        logger.error("Source Joplin sync job failed", {
            jobId,
            message: error.message,
        });
        await JoplinJob.update(jobId, {
            status: "failed",
            error_message: error.message,
            completed_at: new Date().toISOString(),
        });
    }
}

/**
 * Background job processor for importing notes from source Joplin
 * @param {number} jobId - Job ID
 * @param {Object} config - Job configuration with noteIds, folderIds, and overrides
 */
async function processSourceImportJob(jobId, config = {}) {
    const JoplinJob = require("../models/joplinJob");
    const { noteIds = [], folderIds = [], overrides = {} } = config;

    try {
        await JoplinJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        // Get note content and process it
        const notesToImport = [];

        if (noteIds && noteIds.length > 0) {
            logger.info(
                `Fetching ${noteIds.length} direct note(s) from database`
            );
            for (const noteId of noteIds) {
                const note = await getNoteById(noteId);
                if (note) {
                    notesToImport.push(note);
                }
            }
        }

        if (folderIds && folderIds.length > 0) {
            const uniqueFolderIds = [...new Set(folderIds)];

            logger.info(
                `Loading cached notes from database for ${uniqueFolderIds.length} selected folder(s) (subfolders excluded)`
            );

            // Fetch notes from database for selected folders only (not subfolders)
            for (const folderId of uniqueFolderIds) {
                const folderNotes = await getSourceNotesByFolder(folderId);
                logger.info(
                    `Loaded ${folderNotes.length} note(s) from database for folder ${folderId}`
                );
                notesToImport.push(...folderNotes);
            }
        }

        // Remove duplicates (in case same note is selected directly and via folder)
        const uniqueNotesMap = new Map();
        for (const note of notesToImport) {
            if (note?.id) {
                uniqueNotesMap.set(note.id, note);
            }
        }
        const uniqueNotes = Array.from(uniqueNotesMap.values());
        const totalNotesToImport = uniqueNotes.length;

        // Log total number of notes to be processed
        logger.info(
            `Starting import: ${totalNotesToImport} unique note(s) to process (${
                noteIds?.length || 0
            } direct note(s), ${folderIds?.length || 0} folder(s))`
        );

        await JoplinJob.update(jobId, {
            total_items: totalNotesToImport,
            completed_items: 0,
        });

        // Process each note: strip tags, then send to upload processing
        const uploadService = require("../services/fileAnalyzer");
        const processedDir = path.join(SOURCE_NOTES_DIR, "_processed");
        ensureDirectory(processedDir);

        const results = [];
        let processedCount = 0;

        for (const note of uniqueNotes) {
            try {
                logger.info(
                    `[Import] Processing note: "${
                        note.title || "(無標題)"
                    }" (ID: ${note.id})`
                );

                // Prefer reading from file (source of truth after sync), fallback to DB body
                let noteContent = null;
                if (note.file_path) {
                    try {
                        if (fs.existsSync(note.file_path)) {
                            noteContent = fs.readFileSync(
                                note.file_path,
                                "utf-8"
                            );
                            logger.info(
                                `[Import] Read note content from file: ${note.file_path}`
                            );
                        } else {
                            logger.warn(
                                `[Import] Note file not found: ${note.file_path}, falling back to DB body`
                            );
                        }
                    } catch (error) {
                        logger.error("Failed to read cached note file", {
                            noteId: note.id,
                            filePath: note.file_path,
                            error: error.message,
                        });
                    }
                }

                // Fallback to DB body if file not available
                if (!noteContent) {
                    if (note.body) {
                        noteContent = note.body;
                        logger.info(
                            `[Import] Using note content from database (file not available)`
                        );
                    } else {
                        logger.warn(
                            `[Import] Note "${
                                note.title || "(無標題)"
                            }" has no content (neither file nor DB body); defaulting to empty body`
                        );
                        noteContent = "";
                    }
                }

                // Strip Joplin tags
                logger.info(
                    `[Import] Stripping tags from note "${
                        note.title || "(無標題)"
                    }" (content length: ${noteContent?.length || 0})`
                );
                const cleanedContent = stripTags(noteContent);

                // Create a temporary file
                const filename = `joplin-import-${Date.now()}-${Math.random()
                    .toString(36)
                    .substr(2, 9)}.md`;
                const filePath = path.join(processedDir, filename);

                logger.info(
                    `[Import] Writing cleaned content to temporary file: ${filePath} (length: ${
                        cleanedContent?.length || 0
                    })`
                );
                fs.writeFileSync(filePath, cleanedContent, "utf-8");

                logger.info(
                    `[Import] Analyzing note "${
                        note.title || "(無標題)"
                    }" for book and chapter extraction`
                );

                // Process the file through extract-and-create (automatically creates book and chapters)
                let analysis;
                try {
                    analysis = await uploadService.analyzeFile(
                        filePath,
                        note.title || filename
                    );
                    logger.info(
                        `[Import] Analysis completed for note "${
                            note.title || "(無標題)"
                        }": ${analysis?.chapters?.length || 0} chapter(s) found`
                    );
                } catch (analysisError) {
                    logger.error(
                        `[Import] Error during file analysis for note "${
                            note.title || "(無標題)"
                        }"`,
                        {
                            noteId: note.id,
                            filePath,
                            errorMessage: analysisError?.message,
                            errorStack: analysisError?.stack?.substring(0, 500),
                        }
                    );
                    throw analysisError;
                }
                const Book = require("../models/book");
                const Chapter = require("../models/chapter");
                const {
                    toTraditional,
                    normalizeToHalfWidth,
                } = require("../services/converter");
                const {
                    sortChaptersForExport,
                } = require("../services/chunker");

                // Process the analysis result
                let bookId;
                let isNewBook = false;
                const bookNameSimplified =
                    analysis.bookNameSimplified ||
                    (note.title || filename).replace(/\.[^/.]+$/, "");
                const normalizedDetectedName = normalizeToHalfWidth(
                    bookNameSimplified
                )
                    .trim()
                    .toLowerCase();

                logger.info(
                    `[Import] Extracted book name: "${bookNameSimplified}" from note "${
                        note.title || "(無標題)"
                    }"`
                );

                const existingBooks = await Book.findAll();
                let existingBook = existingBooks.find((book) => {
                    const normalizedBookName = normalizeToHalfWidth(
                        book.book_name_simplified || ""
                    )
                        .trim()
                        .toLowerCase();
                    return (
                        normalizedBookName === normalizedDetectedName ||
                        normalizedBookName.includes(normalizedDetectedName) ||
                        normalizedDetectedName.includes(normalizedBookName)
                    );
                });

                if (existingBook) {
                    bookId = existingBook.id;
                    logger.info(
                        `[Import] Using existing book: "${bookNameSimplified}" (ID: ${bookId})`
                    );
                } else {
                    isNewBook = true;
                    const finalMetadata = {
                        author: analysis.metadata?.author
                            ? analysis.metadata.author.slice(0, 20)
                            : null,
                        category: analysis.metadata?.category || null,
                        description: analysis.metadata?.description || null,
                        sourceUrl: analysis.metadata?.sourceUrl || null,
                    };
                    bookId = await Book.create(
                        bookNameSimplified,
                        toTraditional(bookNameSimplified),
                        finalMetadata
                    );
                    logger.info(
                        `[Import] Created new book: "${bookNameSimplified}" (ID: ${bookId})`
                    );
                }

                // Process chapters
                let insertedCount = 0;
                let updatedCount = 0;
                let errorCount = 0;

                const sortedChapters = sortChaptersForExport(
                    analysis.chapters || []
                );

                logger.info(
                    `[Import] Extracted ${
                        sortedChapters.length
                    } chapter(s) from note "${note.title || "(無標題)"}"`
                );

                for (const chapter of sortedChapters) {
                    try {
                        if (
                            chapter.number === null ||
                            chapter.number === undefined
                        ) {
                            logger.warn(
                                `[Import] Skipping chapter with invalid number (null/undefined) from note "${
                                    note.title || "(無標題)"
                                }"`
                            );
                            errorCount++;
                            continue;
                        }

                        const chapterTitleTraditional = toTraditional(
                            chapter.title || ""
                        );
                        const series = chapter.series || "official";
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
                            series: series,
                        };

                        logger.info(
                            `[Import] Processing chapter ${
                                chapter.number
                            } (${series}): "${
                                chapter.title || "(無標題)"
                            }" (Simplified: "${
                                chapter.titleSimplified || chapter.title || ""
                            }", Lines: ${chapter.lineStart || "?"}-${
                                chapter.lineEnd || "?"
                            })`
                        );

                        const existingChapter =
                            await Chapter.findByBookAndNumber(
                                bookId,
                                chapter.number,
                                series
                            );

                        if (existingChapter) {
                            await Chapter.updateByBookSeriesAndNumber(
                                bookId,
                                series,
                                chapter.number,
                                chapterData
                            );
                            updatedCount++;
                            logger.info(
                                `[Import] Updated existing chapter ${
                                    chapter.number
                                }: "${chapter.title || "(無標題)"}"`
                            );
                        } else {
                            await Chapter.create(chapterData);
                            insertedCount++;
                            logger.info(
                                `[Import] Created new chapter ${
                                    chapter.number
                                }: "${chapter.title || "(無標題)"}"`
                            );
                        }
                    } catch (error) {
                        logger.error(
                            `[Import] Error processing chapter ${
                                chapter?.number
                            } from note "${note.title || "(無標題)"}"`,
                            {
                                bookId,
                                chapterNumber: chapter?.number,
                                chapterTitle: chapter?.title,
                                error: error.message,
                            }
                        );
                        errorCount++;
                    }
                }

                logger.info(
                    `[Import] Completed processing note "${
                        note.title || "(無標題)"
                    }": ${insertedCount} inserted, ${updatedCount} updated, ${errorCount} errors`
                );

                // Update book's total chapters count
                const allChapters = await Chapter.findByBookId(bookId);
                await Book.update(bookId, {
                    total_chapters: allChapters.length,
                });

                results.push({
                    noteId: note.id,
                    noteTitle: note.title,
                    success: true,
                    bookId,
                    bookName: bookNameSimplified,
                    isNewBook,
                    chaptersInserted: insertedCount,
                    chaptersUpdated: updatedCount,
                    chaptersErrored: errorCount,
                });

                processedCount++;
                await JoplinJob.update(jobId, {
                    completed_items: processedCount,
                    progress_data: {
                        processed: processedCount,
                        total: totalNotesToImport,
                        successful: results.filter((r) => r.success).length,
                        failed: results.filter((r) => !r.success).length,
                    },
                });
            } catch (error) {
                const errorMessage =
                    error?.message || String(error) || "Unknown error";
                const errorStack = error?.stack || "";

                logger.error("Error importing note", {
                    noteId: note.id,
                    noteTitle: note.title,
                    errorMessage,
                    errorStack: errorStack.substring(0, 500), // Limit stack trace length
                    errorType: error?.constructor?.name || typeof error,
                });

                results.push({
                    noteId: note.id,
                    noteTitle: note.title,
                    success: false,
                    error: errorMessage,
                });

                processedCount++;
                await JoplinJob.update(jobId, {
                    completed_items: processedCount,
                    progress_data: {
                        processed: processedCount,
                        total: totalNotesToImport,
                        successful: results.filter((r) => r.success).length,
                        failed: results.filter((r) => !r.success).length,
                    },
                });
            }
        }

        await JoplinJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
            progress_data: {
                processed: processedCount,
                total: totalNotesToImport,
                successful: results.filter((r) => r.success).length,
                failed: results.filter((r) => !r.success).length,
                results,
            },
            completed_items: processedCount,
        });

        logger.info(
            `Import job ${jobId} completed: ${
                results.filter((r) => r.success).length
            } successful, ${results.filter((r) => !r.success).length} failed`
        );
    } catch (error) {
        logger.error("Source Joplin import job failed", {
            jobId,
            message: error.message,
        });
        await JoplinJob.update(jobId, {
            status: "failed",
            error_message: error.message,
            completed_at: new Date().toISOString(),
        });
    }
}

module.exports = {
    getSourceCredentials,
    apiRequest,
    mirrorSourceTree,
    buildTree,
    getSourceFolders,
    getSourceNotes,
    getSourceNotesByFolder,
    collectNotesForFolder,
    collectNotesFromFolders,
    getNoteById,
    refreshNote,
    stripTags,
    processSourceSyncJob,
    processSourceImportJob,
    getFolderNoteCountFromDB,
    searchNotesByContent,
};
