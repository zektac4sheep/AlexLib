#!/usr/bin/env node

/**
 * Script to scan the source_joplin_folders database for debugging
 * Usage: node scripts/scan-joplin-db.js [folderName]
 */

const path = require("path");
const sqlite3 = require("sqlite3").verbose();

// Get database path (matches database.js default)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../data/books.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
        process.exit(1);
    }
    console.log("Connected to database:", DB_PATH);
});

const searchTerm = process.argv[2];
const isId = searchTerm && searchTerm.length === 32 && /^[a-f0-9]+$/i.test(searchTerm);
const folderName = searchTerm || "xMVPold";

console.log(`\n=== Scanning for folder: "${folderName}" ${isId ? "(by ID)" : "(by name)"} ===\n`);

// 1. Search for the folder (by ID or name)
const query = isId 
    ? `SELECT * FROM source_joplin_folders WHERE id = ?`
    : `SELECT * FROM source_joplin_folders WHERE LOWER(title) LIKE LOWER(?) ORDER BY title`;
const params = isId ? [folderName] : [`%${folderName}%`];

db.all(query, params,
    (err, folders) => {
        if (err) {
            console.error("Error searching folders:", err);
            db.close();
            return;
        }

        console.log(`Found ${folders.length} matching folder(s):\n`);
        folders.forEach((folder, idx) => {
            console.log(`${idx + 1}. ${folder.title}`);
            console.log(`   ID: ${folder.id}`);
            console.log(`   Parent ID: ${folder.parent_id || "(null/empty)"}`);
            console.log(`   Created: ${new Date(folder.created_time).toISOString()}`);
            console.log(`   Updated: ${new Date(folder.updated_time).toISOString()}`);
            console.log();
        });

        // 2. Check if parent exists for each folder
        if (folders.length > 0) {
            folders.forEach((folder) => {
                if (folder.parent_id) {
                    db.get(
                        "SELECT id, title FROM source_joplin_folders WHERE id = ?",
                        [folder.parent_id],
                        (err, parent) => {
                            if (err) {
                                console.error(`Error checking parent for ${folder.title}:`, err);
                            } else if (parent) {
                                console.log(`✓ Parent exists for "${folder.title}": "${parent.title}" (${parent.id})`);
                            } else {
                                console.log(`✗ Parent MISSING for "${folder.title}": parent_id=${folder.parent_id} (should be treated as root)`);
                            }
                        }
                    );
                } else {
                    console.log(`✓ "${folder.title}" is a root folder (no parent_id)`);
                }
            });
        }

        // 3. Get all root folders
        db.all(
            `SELECT * FROM source_joplin_folders 
             WHERE parent_id IS NULL OR parent_id = '' 
             ORDER BY title`,
            [],
            (err, rootFolders) => {
                if (err) {
                    console.error("Error fetching root folders:", err);
                } else {
                    console.log(`\n=== Root Folders (${rootFolders.length} total) ===\n`);
                    rootFolders.forEach((folder, idx) => {
                        console.log(`${idx + 1}. ${folder.title} (${folder.id})`);
                    });
                }

                // 4. Get folders with missing parents
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
                            console.error("Error fetching orphaned folders:", err);
                        } else {
                            console.log(`\n=== Folders with Missing Parents (${orphanedFolders.length} total) ===\n`);
                            if (orphanedFolders.length === 0) {
                                console.log("(none)");
                            } else {
                                orphanedFolders.forEach((folder, idx) => {
                                    console.log(`${idx + 1}. ${folder.title} (${folder.id})`);
                                    console.log(`   Missing parent_id: ${folder.parent_id}`);
                                });
                            }
                        }

                        // 5. Get total folder count
                        db.get(
                            "SELECT COUNT(*) as count FROM source_joplin_folders",
                            [],
                            (err, row) => {
                                if (err) {
                                    console.error("Error counting folders:", err);
                                } else {
                                    console.log(`\n=== Summary ===`);
                                    console.log(`Total folders in database: ${row.count}`);
                                    console.log(`Root folders: ${rootFolders.length}`);
                                    console.log(`Orphaned folders (missing parent): ${orphanedFolders.length}`);
                                }

                                db.close((err) => {
                                    if (err) {
                                        console.error("Error closing database:", err);
                                    } else {
                                        console.log("\nDatabase connection closed.");
                                    }
                                });
                            }
                        );
                    }
                );
            }
        );
    }
);

