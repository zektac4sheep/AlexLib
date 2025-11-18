#!/usr/bin/env node

/**
 * Script to check if a folder exists in the source Joplin API
 * Usage: node scripts/check-source-joplin.js [folderName]
 */

require('dotenv').config();
const axios = require('axios');
const settingsService = require('../services/settingsService');

async function checkSourceJoplin() {
    try {
        // Get credentials
        const apiUrl = await settingsService.getSettingValue('source_joplin_api_url') || 
                      process.env.SOURCE_JOPLIN_API_URL || 
                      'http://localhost:41184';
        const apiToken = await settingsService.getSettingValue('source_joplin_api_token') || 
                        process.env.SOURCE_JOPLIN_API_TOKEN || 
                        '';

        if (!apiToken) {
            console.error('Error: Source Joplin API token is not configured.');
            console.log('Please set it in the UI or via SOURCE_JOPLIN_API_TOKEN environment variable.');
            process.exit(1);
        }

        console.log(`\n=== Checking Source Joplin API ===`);
        console.log(`API URL: ${apiUrl}`);
        console.log(`Token: ${apiToken.substring(0, 10)}...\n`);

        // Search for folders
        const folderName = process.argv[2] || 'xMVPold';
        console.log(`Searching for folder: "${folderName}"\n`);

        // Get all folders
        const response = await axios.get(`${apiUrl}/folders`, {
            params: {
                token: apiToken,
                fields: 'id,title,parent_id'
            }
        });

        const folders = response.data.items || [];
        console.log(`Total folders in source Joplin: ${folders.length}\n`);

        // Search for matching folder
        const matching = folders.filter(f => 
            f.title && f.title.toLowerCase().includes(folderName.toLowerCase())
        );

        if (matching.length > 0) {
            console.log(`Found ${matching.length} matching folder(s):\n`);
            matching.forEach((folder, idx) => {
                console.log(`${idx + 1}. ${folder.title}`);
                console.log(`   ID: ${folder.id}`);
                console.log(`   Parent ID: ${folder.parent_id || '(null/empty)'}`);
                
                // Check if parent exists
                if (folder.parent_id) {
                    const parent = folders.find(f => f.id === folder.parent_id);
                    if (parent) {
                        console.log(`   Parent: "${parent.title}" (${parent.id})`);
                    } else {
                        console.log(`   Parent: MISSING (parent_id=${folder.parent_id})`);
                    }
                } else {
                    console.log(`   Parent: (root folder)`);
                }
                console.log();
            });
        } else {
            console.log(`No folders found matching "${folderName}"\n`);
        }

        // Show root folders
        const rootFolders = folders.filter(f => !f.parent_id || f.parent_id === '');
        console.log(`\n=== Root Folders (${rootFolders.length} total) ===\n`);
        rootFolders.forEach((folder, idx) => {
            console.log(`${idx + 1}. ${folder.title} (${folder.id})`);
        });

        // Show folders with missing parents
        const folderMap = {};
        folders.forEach(f => { folderMap[f.id] = f; });

        const orphanedFolders = folders.filter(f => {
            if (!f.parent_id || f.parent_id === '') return false;
            return !folderMap[f.parent_id];
        });

        if (orphanedFolders.length > 0) {
            console.log(`\n=== Folders with Missing Parents (${orphanedFolders.length} total) ===\n`);
            orphanedFolders.forEach((folder, idx) => {
                console.log(`${idx + 1}. ${folder.title} (${folder.id})`);
                console.log(`   Missing parent_id: ${folder.parent_id}`);
            });
        }

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        process.exit(1);
    }
}

checkSourceJoplin();

