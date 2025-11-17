/**
 * OneNote Service – Using axios and @azure/msal-node
 * Full parity with Joplin: Structure, chunks, background jobs, error handling.
 */

const axios = require("axios");
const { ConfidentialClientApplication } = require("@azure/msal-node");
const logger = require("../utils/logger");
const converter = require("./converter");
const { getDatabase } = require("../models/database");
const Chunk = require("../models/chunk");
const ChunkJob = require("../models/chunkJob");
const Book = require("../models/book");

// load env variables from .env file
const dotenv = require("dotenv");
dotenv.config();

//map ONENOTE_TENANT_ID to tenantId
const tenantId =
    process.env.ONENOTE_TENANT_ID ||
    "e16dc3da-07d9-42ba-9a2d-d9d4bd79e0a3" ||
    "common";
const clientId = process.env.ONENOTE_CLIENT_ID;
const clientSecret = process.env.ONENOTE_CLIENT_SECRET;
const refreshToken = process.env.ONENOTE_REFRESH_TOKEN;
const redirectUri = process.env.ONENOTE_REDIRECT_URI || "http://localhost:3000";

const ONENOTE_ROOT_NOTEBOOK_NAME =
    process.env.ONENOTE_ROOT_NOTEBOOK_NAME || "Books";
const DEFAULT_CHUNK_SIZE = parseInt(
    process.env.DEFAULT_CHUNK_SIZE || "1000",
    10
);
const CHUNK_BUILD_TIMEOUT_MS = parseInt(
    process.env.CHUNK_BUILD_TIMEOUT_MS || `${10 * 60 * 1000}`,
    10
);
const CHUNK_BUILD_POLL_INTERVAL_MS = parseInt(
    process.env.CHUNK_BUILD_POLL_INTERVAL_MS || "2000",
    10
);

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

// Global token cache
let _accessToken = null;
let _tokenExpiry = 0;
let _msalClient = null;

// Initialize MSAL client
function getMsalClient() {
    if (_msalClient) {
        return _msalClient;
    }

    const clientId = process.env.ONENOTE_CLIENT_ID;
    const clientSecret = process.env.ONENOTE_CLIENT_SECRET;
    const tenantId = process.env.ONENOTE_TENANT_ID || "common";
    const redirectUri =
        process.env.ONENOTE_REDIRECT_URI || "http://localhost:3000";

    // print out all the value to console
    console.log("tenantId:", tenantId);
    console.log("clientId:", clientId);
    console.log("clientSecret:", clientSecret);
    console.log("redirectUri:", redirectUri);
    console.log("refreshToken:", refreshToken);

    if (!clientId || !clientSecret) {
        throw new Error(
            "OneNote: Missing ONENOTE_CLIENT_ID or ONENOTE_CLIENT_SECRET"
        );
    }

    const msalConfig = {
        auth: {
            clientId: clientId,
            authority: `https://login.microsoftonline.com/${tenantId}`,
            clientSecret: clientSecret,
        },
    };

    _msalClient = new ConfidentialClientApplication(msalConfig);
    return _msalClient;
}

// Get access token using refresh token
async function getAccessToken() {
    // Return cached token if still valid (with 5 minute buffer)
    if (_accessToken && Date.now() < _tokenExpiry - 300000) {
        return _accessToken;
    }

    console.log("getAccessToken called --");

    console.log("refreshToken:", refreshToken);
    console.log("clientId:", clientId);
    console.log("clientSecret:", clientSecret);
    console.log("redirectUri:", redirectUri);
    console.log("refreshToken:", refreshToken);

    // Normalize redirect URI: remove trailing slash, ensure exact format
    //    let redirectUri = (redirectUri || "http://localhost:3000").trim();
    redirectUri = redirectUri.replace(/\/$/, ""); // Remove trailing slash

    console.log("redirectUri:", redirectUri);
    // if we dont have refresh token, we need to get a new one
    if (!refreshToken || refreshToken.trim() === "") {
        const authUrl = getAuthUrl();
        console.log("authUrl:", authUrl);
        // can we send the url to the client to redirect to it

        return {
            authUrl: authUrl,
            status: "redirect",
            message: "Redirect user to this URL to authorize OneNote access",
        };
    }
    if (!refreshToken || !clientId || !clientSecret) {
        throw new Error(
            "OneNote: Missing ONENOTE_REFRESH_TOKEN, CLIENT_ID or CLIENT_SECRET"
        );
    }

    logger.info("Attempting to refresh OneNote access token", {
        redirectUri,
        tenantId,
        clientId: clientId ? `${clientId.substring(0, 8)}...` : "missing",
        hasRefreshToken: !!refreshToken,
    });

    try {
        // Use Microsoft token endpoint directly with refresh token
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

        const params = new URLSearchParams();
        params.append("client_id", clientId);
        params.append("client_secret", clientSecret);
        params.append("refresh_token", refreshToken);
        params.append("grant_type", "refresh_token");
        params.append("scope", "https://graph.microsoft.com/.default");
        // Include redirect_uri - must match EXACTLY the one used during initial authorization
        // For Azure AD, this must match the redirect URI registered in the app registration
        params.append("redirect_uri", redirectUri);

        console.log("params:", params.toString());
        const response = await axios.post(tokenUrl, params.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        console.log("response:", response.data);

        if (response.data && response.data.access_token) {
            _accessToken = response.data.access_token;
            // Set expiry (default to 1 hour if not provided)
            const expiresIn = response.data.expires_in || 3600;
            _tokenExpiry = Date.now() + expiresIn * 1000;

            // Optionally update refresh token if a new one is provided
            if (response.data.refresh_token) {
                // Note: You might want to save this to environment or config
                logger.info("New refresh token received from Microsoft");
            }

            logger.info("Successfully refreshed OneNote access token", {
                expiresIn,
            });

            return _accessToken;
        } else {
            throw new Error(
                "Failed to acquire access token: No token in response"
            );
        }
    } catch (err) {
        const errorData = err.response?.data;
        let errorMessage = err.message;

        // Provide more specific error messages based on the error response
        if (errorData) {
            if (errorData.error === "invalid_grant") {
                if (errorData.error_codes?.includes(9002313)) {
                    errorMessage = `Invalid refresh token or redirect_uri mismatch. 
                    
Current redirect_uri being used: "${redirectUri}"
                    
This must EXACTLY match the redirect URI that was used when the refresh token was obtained.
                    
Common issues:
1. The redirect URI in your Azure app registration is "${redirectUri}" but the refresh token was obtained with a different URI
2. The refresh token may be expired or invalid
3. There may be a trailing slash mismatch (e.g., "http://localhost" vs "http://localhost/")

To fix:
- Verify your Azure app registration has "${redirectUri}" as a redirect URI
- If the refresh token was obtained with a different redirect URI, you need to obtain a new refresh token using "${redirectUri}"
- Set ONENOTE_REDIRECT_URI environment variable to match exactly what's in Azure (should be "http://localhost" without port)`;
                } else {
                    errorMessage = `Refresh token is invalid or expired. Error: ${
                        errorData.error_description || errorData.error
                    }`;
                }
            } else if (errorData.error === "invalid_client") {
                errorMessage =
                    "Invalid client credentials. Please check ONENOTE_CLIENT_ID and ONENOTE_CLIENT_SECRET.";
            } else if (errorData.error_description) {
                errorMessage = errorData.error_description;
            }
        }

        logger.error("Failed to get access token", {
            error: errorMessage,
            redirectUri,
            response: errorData,
            errorCode: errorData?.error,
            errorCodes: errorData?.error_codes,
        });
        throw new Error(`OneNote authentication failed: ${errorMessage}`);
    }
}

// Make authenticated Graph API request
async function graphRequest(
    method,
    endpoint,
    data = null,
    params = null,
    contentType = "application/json"
) {
    const token = await getAccessToken();

    // Handle redirect case (no refresh token)
    if (token && typeof token === "object" && token.status === "redirect") {
        return {
            status: "redirect",
            authUrl: token.authUrl,
            message: token.message,
        };
    }

    // Handle error case
    if (token && typeof token === "object" && token.status === "error") {
        throw new Error(token.message || "Authentication failed");
    }

    // Token should be a string at this point
    if (typeof token !== "string") {
        throw new Error("Invalid token received from getAccessToken");
    }

    const config = {
        method,
        url: `${GRAPH_API_BASE}${endpoint}`,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": contentType,
        },
    };

    if (data) {
        config.data = data;
    }

    if (params) {
        config.params = params;
    }

    try {
        const response = await axios(config);
        return response.data;
    } catch (err) {
        // Handle pagination links
        if (err.response && err.response.status === 401) {
            // Token expired, clear cache and retry once
            _accessToken = null;
            _tokenExpiry = 0;
            const newToken = await getAccessToken();
            if (typeof newToken !== "string") {
                throw new Error("Failed to refresh token");
            }
            config.headers.Authorization = `Bearer ${newToken}`;
            const retryResponse = await axios(config);
            return retryResponse.data;
        }
        throw err;
    }
}

// Core helpers
async function getOrCreateRootNotebook() {
    try {
        const res = await graphRequest("GET", "/me/onenote/notebooks");
        const notebooks = res.value || [];

        for (const nb of notebooks) {
            if (nb.displayName === ONENOTE_ROOT_NOTEBOOK_NAME) return nb;
        }

        const created = await graphRequest("POST", "/me/onenote/notebooks", {
            displayName: ONENOTE_ROOT_NOTEBOOK_NAME,
        });

        logger.info("Created OneNote root notebook", {
            name: ONENOTE_ROOT_NOTEBOOK_NAME,
        });
        return created;
    } catch (err) {
        logger.error("Failed to get/create root notebook", {
            error: err.message,
        });
        throw err;
    }
}

async function getOrCreateSectionGroup(notebookId, name) {
    try {
        const res = await graphRequest(
            "GET",
            `/me/onenote/notebooks/${notebookId}/sectionGroups`
        );
        const sectionGroups = res.value || [];

        for (const sg of sectionGroups) {
            if (sg.displayName === name) return sg;
        }

        return await graphRequest(
            "POST",
            `/me/onenote/notebooks/${notebookId}/sectionGroups`,
            { displayName: name }
        );
    } catch (err) {
        logger.error("Failed to get/create section group", {
            error: err.message,
        });
        throw err;
    }
}

async function getOrCreateSection(parentPath, name) {
    // parentPath: e.g., /me/onenote/sectionGroups/{id} or /me/onenote/notebooks/{id}
    try {
        const res = await graphRequest("GET", `${parentPath}/sections`);
        const sections = res.value || [];

        for (const s of sections) {
            if (s.displayName === name) return s;
        }

        return await graphRequest("POST", `${parentPath}/sections`, {
            displayName: name,
        });
    } catch (err) {
        logger.error("Failed to get/create section", { error: err.message });
        throw err;
    }
}

async function createPage(sectionId, title, content = "") {
    const escapeHtml = (str) =>
        str.replace(
            /[&<>"']/g,
            (m) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                }[m])
        );
    const html = `<!DOCTYPE html>
<html><head><title>${escapeHtml(title)}</title></head>
<body><h1>${escapeHtml(title)}</h1><div>${content.replace(
        /\n/g,
        "<br>"
    )}</div></body></html>`;

    try {
        return await graphRequest(
            "POST",
            `/me/onenote/sections/${sectionId}/pages`,
            html,
            null,
            "text/html"
        );
    } catch (err) {
        if (err.response && err.response.status === 409) {
            logger.info("Page already exists, skipping", { title });
            return null;
        }
        throw err;
    }
}

async function deleteAllPagesInSection(sectionId) {
    let pages = [];
    let nextLink = null;

    do {
        const res = nextLink
            ? await graphRequest("GET", nextLink)
            : await graphRequest(
                  "GET",
                  `/me/onenote/sections/${sectionId}/pages`
              );
        pages.push(...(res.value || []));
        nextLink = res["@odata.nextLink"];
    } while (nextLink);

    let count = 0;
    for (const page of pages) {
        try {
            await graphRequest("DELETE", `/me/onenote/pages/${page.id}`);
            count++;
        } catch (err) {
            logger.warn("Failed to delete page", {
                pageId: page.id,
                error: err.message,
            });
        }
    }
    return count;
}

async function pageExistsInSection(sectionId, title) {
    try {
        const res = await graphRequest(
            "GET",
            `/me/onenote/sections/${sectionId}/pages`,
            null,
            {
                $filter: `title eq '${title.replace(/'/g, "''")}'`,
                $top: 1,
            }
        );
        return (res.value || []).length > 0;
    } catch {
        return false;
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ensure chunks ready (identical to Joplin)
async function ensureChunksReadyForBook(book, chunkSize = DEFAULT_CHUNK_SIZE) {
    // Check if chunks need to be rebuilt
    const needsRebuild =
        book.rebuild_chunks === 1 || book.rebuild_chunks === true;

    let chunks = await Chunk.findByBookId(book.id);
    if (chunks && chunks.length > 0 && !needsRebuild) {
        return chunks;
    }

    let chunkJob = await ChunkJob.findByBookId(book.id);
    let jobId = chunkJob ? chunkJob.id : null;
    const effectiveChunkSize =
        (chunkJob && chunkJob.chunk_size) || chunkSize || DEFAULT_CHUNK_SIZE;
    let shouldStartProcessing = false;

    // If rebuild is needed, delete existing chunks and create new job
    if (needsRebuild && chunks && chunks.length > 0) {
        if (chunkJob) {
            await Chunk.deleteByChunkJobId(chunkJob.id);
        }
        // Clear the rebuild flag after starting rebuild
        await Book.update(book.id, { rebuild_chunks: false });
    }

    if (!chunkJob || needsRebuild) {
        jobId = await ChunkJob.create(book.id, effectiveChunkSize);
        chunkJob = await ChunkJob.findById(jobId);
        shouldStartProcessing = true;
    } else if (
        chunkJob.status === "failed" ||
        chunkJob.status === "ready" ||
        chunkJob.status === "completed"
    ) {
        if (chunkJob.status === "ready" || chunkJob.status === "completed") {
            await Chunk.deleteByChunkJobId(chunkJob.id);
        }
        jobId = await ChunkJob.create(book.id, effectiveChunkSize);
        chunkJob = await ChunkJob.findById(jobId);
        shouldStartProcessing = true;
    } else if (chunkJob.status === "queued") {
        shouldStartProcessing = true;
    }

    if (shouldStartProcessing) {
        const chunkRoutes = require("../routes/chunks");
        if (chunkRoutes && typeof chunkRoutes.processChunkJob === "function") {
            chunkRoutes
                .processChunkJob(jobId, book.id, effectiveChunkSize, {
                    skipJoplinSync: true,
                })
                .catch((error) => {
                    logger.error(
                        "Error processing chunk job before OneNote sync",
                        {
                            bookId: book.id,
                            jobId,
                            error: error.message,
                        }
                    );
                });
        } else {
            throw new Error("processChunkJob not available");
        }
    }

    const startTime = Date.now();
    while (Date.now() - startTime < CHUNK_BUILD_TIMEOUT_MS) {
        chunkJob = await ChunkJob.findByBookId(book.id);
        if (
            chunkJob &&
            (chunkJob.status === "ready" || chunkJob.status === "completed")
        ) {
            chunks = await Chunk.findByBookId(book.id);
            if (chunks && chunks.length > 0) {
                return chunks;
            }
        }

        if (chunkJob && chunkJob.status === "failed") {
            throw new Error(
                `Chunk generation failed for book ${book.id}: ${
                    chunkJob.error_message || "Unknown error"
                }`
            );
        }

        await delay(CHUNK_BUILD_POLL_INTERVAL_MS);
    }

    throw new Error(
        `Timed out waiting for chunk generation for book ${book.id}`
    );
}

// Sync chunks (core function)
async function syncChunksToOneNote(
    book,
    chunks,
    options = {},
    deleteAndRewrite = false
) {
    if (!chunks?.length) throw new Error("No chunks to sync");

    const authorTrad = book.author
        ? converter.toTraditional(book.author)
        : "未知作者";
    const bookNameTrad =
        book.book_name_traditional ||
        converter.toTraditional(book.book_name_simplified);

    try {
        const rootNb = await getOrCreateRootNotebook();
        const authorGroup = await getOrCreateSectionGroup(
            rootNb.id,
            authorTrad
        );
        const bookSection = await getOrCreateSection(
            `/me/onenote/sectionGroups/${authorGroup.id}`,
            bookNameTrad
        );

        if (deleteAndRewrite) {
            const deleted = await deleteAllPagesInSection(bookSection.id);
            logger.info("Deleted existing pages", {
                sectionId: bookSection.id,
                count: deleted,
            });
        }

        let syncedCount = 0;
        for (const chunk of chunks) {
            try {
                const start =
                    chunk.first_chapter ??
                    chunk.chapters_data?.[0]?.chapter_number;
                const end =
                    chunk.last_chapter ??
                    chunk.chapters_data?.[chunk.chapters_data.length - 1]
                        ?.chapter_number;
                const rangeLabel =
                    start && end
                        ? start === end
                            ? `${start}`
                            : `${start}-${end}`
                        : `第${chunk.chunk_number}部分`;

                const pageTitle = `${bookNameTrad}（${rangeLabel}）`;

                if (
                    !deleteAndRewrite &&
                    (await pageExistsInSection(bookSection.id, pageTitle))
                ) {
                    syncedCount++;
                    continue;
                }

                await createPage(
                    bookSection.id,
                    pageTitle,
                    chunk.content || ""
                );
                logger.info("Synced chunk to OneNote", {
                    bookId: book.id,
                    chunk: chunk.chunk_number,
                    title: pageTitle,
                });
                syncedCount++;
            } catch (err) {
                logger.error("Failed to sync chunk to OneNote", {
                    bookId: book.id,
                    chunk: chunk.chunk_number,
                    error: err.message,
                });
            }
        }

        await Book.update(book.id, {
            onenote_section_id: bookSection.id,
            onenote_section_url: bookSection.webUrl || null,
        });

        return syncedCount;
    } catch (err) {
        logger.error("OneNote sync failed", {
            bookId: book.id,
            error: err.message,
        });
        throw err;
    }
}

// Test connection
async function testConnection() {
    if (!refreshToken || refreshToken.trim() === "") {
        console.log("refreshToken is empty");
        //let them know where to get it
        // we shoudl try to get a token with client id and client secret

        console.log(
            "get it from here: https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=" +
                clientId +
                "&response_type=code&redirect_uri=" +
                redirectUri +
                "&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default"
        );
        // AADSTS9002346: Application '729365b2-76d4-4768-90f2-8ed45f69027b'(Zekta OneNote App) is configured for use by Microsoft Account users only. Please use the /consumers endpoint to serve this request.
        //
        //https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=729365b2-76d4-4768-90f2-8ed45f69027b&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default

        return false;
    }
    try {
        await graphRequest("GET", "/me");
        return true;
    } catch (err) {
        // print detail error log
        logger.error("OneNote connection failed", {
            error: err.message,
            error: err.response?.data,
        });
        return false;
    }
}

// Remove & recreate book section
async function removeAndRecreateBookSection(bookId) {
    const book = await Book.findById(bookId);
    if (!book) throw new Error("Book not found");

    if (book.onenote_section_id) {
        try {
            await graphRequest(
                "DELETE",
                `/me/onenote/sections/${book.onenote_section_id}`
            );
        } catch (e) {
            logger.warn("Ignored error deleting old section", {
                error: e.message,
            });
        }
    }

    const authorTrad = book.author
        ? converter.toTraditional(book.author)
        : "未知作者";
    const bookNameTrad =
        book.book_name_traditional ||
        converter.toTraditional(book.book_name_simplified);

    const rootNb = await getOrCreateRootNotebook();
    const authorGroup = await getOrCreateSectionGroup(rootNb.id, authorTrad);
    const newSection = await getOrCreateSection(
        `/me/onenote/sectionGroups/${authorGroup.id}`,
        bookNameTrad
    );

    await Book.update(bookId, {
        onenote_section_id: newSection.id,
        onenote_section_url: newSection.webUrl || null,
    });

    return { sectionId: newSection.id };
}

// Background job processor for removing and recreating book section
async function processRecreateBookSectionJob(jobId, bookId) {
    const JoplinJob = require("../models/joplinJob");

    try {
        await JoplinJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
            total_items: 1,
        });

        const result = await removeAndRecreateBookSection(parseInt(bookId));

        await JoplinJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
            completed_items: 1,
            progress_data: result,
        });
    } catch (error) {
        let errorMessage = error.message;
        let errorDetails = {
            message: error.message,
        };

        // Provide more helpful error messages for common issues
        if (error.message.includes("token")) {
            errorMessage =
                "OneNote 認證失敗：請檢查 Refresh Token 是否過期或 Azure App 權限";
        } else if (error.message.includes("network")) {
            errorMessage = "無法連線到 Microsoft Graph，請檢查網路";
        }

        logger.error("OneNote recreate book section job failed", {
            jobId,
            bookId,
            error: errorMessage,
            details: errorDetails,
        });

        await JoplinJob.update(jobId, {
            status: "failed",
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
        });
    }
}

// Background job for syncing books
async function processOneNoteSyncBooksJob(jobId) {
    const JoplinJob = require("../models/joplinJob");
    const db = getDatabase();

    try {
        await JoplinJob.update(jobId, {
            status: "processing",
            started_at: new Date().toISOString(),
        });

        const booksToSync = await new Promise((resolve) =>
            db.all(
                "SELECT * FROM books WHERE sync_to_onenote = 1",
                [],
                (err, rows) => resolve(rows || [])
            )
        );
        const booksToRemove = await new Promise((resolve) =>
            db.all(
                "SELECT * FROM books WHERE sync_to_onenote = 0 AND onenote_section_id IS NOT NULL AND onenote_section_id != ''",
                [],
                (err, rows) => resolve(rows || [])
            )
        );

        await JoplinJob.update(jobId, {
            total_items: booksToSync.length + booksToRemove.length,
        });

        let synced = 0,
            removed = 0,
            errors = [];

        // Sync books
        for (const book of booksToSync) {
            try {
                const chunks = await ensureChunksReadyForBook(book);
                await syncChunksToOneNote(book, chunks, {}, true);
                synced++;
                await JoplinJob.update(jobId, {
                    completed_items: synced + removed,
                });
            } catch (e) {
                errors.push({
                    bookId: book.id,
                    name:
                        book.book_name_traditional || book.book_name_simplified,
                    error: e.message,
                });
                logger.error("Book sync error", {
                    bookId: book.id,
                    error: e.message,
                });
            }
        }

        // Remove sections
        for (const book of booksToRemove) {
            try {
                if (book.onenote_section_id) {
                    await graphRequest(
                        "DELETE",
                        `/me/onenote/sections/${book.onenote_section_id}`
                    );
                    await Book.update(book.id, {
                        onenote_section_id: null,
                        onenote_section_url: null,
                    });
                    removed++;
                }
                await JoplinJob.update(jobId, {
                    completed_items: synced + removed,
                });
            } catch (e) {
                errors.push({
                    bookId: book.id,
                    error: e.message,
                    type: "remove",
                });
            }
        }

        await JoplinJob.update(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
            progress_data: {
                syncedBooks: synced,
                removedSections: removed,
                errors: errors.length ? errors : undefined,
            },
            completed_items: synced + removed,
        });
    } catch (err) {
        const msg = err.message.includes("token")
            ? "OneNote 認證失敗：請檢查 Refresh Token 是否過期或 Azure App 權限"
            : err.message.includes("network")
            ? "無法連線到 Microsoft Graph，請檢查網路"
            : err.message;
        await JoplinJob.update(jobId, {
            status: "failed",
            error_message: msg,
            completed_at: new Date().toISOString(),
        });
        logger.error("OneNote sync job failed", { jobId, error: err });
    }
}

// Structure fetching functions
async function getOneNoteNotebooks() {
    try {
        const res = await graphRequest("GET", "/me/onenote/notebooks");
        return res.value || [];
    } catch (err) {
        logger.error("Failed to get OneNote notebooks", { error: err.message });
        throw err;
    }
}

async function getOneNoteSectionGroups(notebookId) {
    try {
        const res = await graphRequest(
            "GET",
            `/me/onenote/notebooks/${notebookId}/sectionGroups`
        );
        return res.value || [];
    } catch (err) {
        logger.error("Failed to get OneNote section groups", {
            error: err.message,
        });
        throw err;
    }
}

async function getOneNoteSections(parentPath) {
    // parentPath can be: /me/onenote/notebooks/{id} or /me/onenote/sectionGroups/{id}
    try {
        const res = await graphRequest("GET", `${parentPath}/sections`);
        return res.value || [];
    } catch (err) {
        logger.error("Failed to get OneNote sections", { error: err.message });
        throw err;
    }
}

async function getOneNotePages(sectionId) {
    try {
        let pages = [];
        let nextLink = null;
        do {
            const res = nextLink
                ? await graphRequest("GET", nextLink)
                : await graphRequest(
                      "GET",
                      `/me/onenote/sections/${sectionId}/pages`
                  );
            pages.push(...(res.value || []));
            nextLink = res["@odata.nextLink"];
        } while (nextLink);
        return pages;
    } catch (err) {
        logger.error("Failed to get OneNote pages", { error: err.message });
        throw err;
    }
}

// Build hierarchical structure similar to Joplin's folder/note structure
async function getOneNoteStructure() {
    try {
        const notebooks = await getOneNoteNotebooks();

        // Filter for root notebook (Books) or return all
        const rootNotebooks = notebooks.filter(
            (nb) => nb.displayName === ONENOTE_ROOT_NOTEBOOK_NAME
        );

        if (rootNotebooks.length === 0) {
            return [];
        }

        const structure = [];

        for (const notebook of rootNotebooks) {
            // Build notebook node (like root folder)
            const notebookNode = {
                id: notebook.id,
                name: notebook.displayName,
                type: "notebook",
                children: [],
                pageCount: 0,
            };

            // Get section groups (authors)
            const sectionGroups = await getOneNoteSectionGroups(notebook.id);

            for (const sectionGroup of sectionGroups) {
                // Build section group node (like folder - author)
                const sectionGroupNode = {
                    id: sectionGroup.id,
                    name: sectionGroup.displayName,
                    type: "section_group",
                    parent_id: notebook.id,
                    children: [],
                    pageCount: 0,
                };

                // Get sections in this section group (books)
                const sections = await getOneNoteSections(
                    `/me/onenote/sectionGroups/${sectionGroup.id}`
                );

                for (const section of sections) {
                    // Build section node (like folder - book)
                    const sectionNode = {
                        id: section.id,
                        name: section.displayName,
                        type: "section",
                        parent_id: sectionGroup.id,
                        children: [],
                        pageCount: 0,
                    };

                    // Get pages in this section (chunks)
                    const pages = await getOneNotePages(section.id);

                    for (const page of pages) {
                        // Build page node (like note - chunk)
                        const pageNode = {
                            id: page.id,
                            name: page.title || "(無標題)",
                            type: "page",
                            parent_id: section.id,
                            metadata: {
                                created_time: page.createdDateTime,
                                updated_time: page.lastModifiedDateTime,
                            },
                        };
                        sectionNode.children.push(pageNode);
                        sectionNode.pageCount++;
                    }

                    sectionGroupNode.children.push(sectionNode);
                    sectionGroupNode.pageCount += sectionNode.pageCount;
                }

                notebookNode.children.push(sectionGroupNode);
                notebookNode.pageCount += sectionGroupNode.pageCount;
            }

            // Also get sections directly in notebook (not in section groups)
            const directSections = await getOneNoteSections(
                `/me/onenote/notebooks/${notebook.id}`
            );

            for (const section of directSections) {
                // Build section node
                const sectionNode = {
                    id: section.id,
                    name: section.displayName,
                    type: "section",
                    parent_id: notebook.id,
                    children: [],
                    pageCount: 0,
                };

                // Get pages
                const pages = await getOneNotePages(section.id);

                for (const page of pages) {
                    const pageNode = {
                        id: page.id,
                        name: page.title || "(無標題)",
                        type: "page",
                        parent_id: section.id,
                        metadata: {
                            created_time: page.createdDateTime,
                            updated_time: page.lastModifiedDateTime,
                        },
                    };
                    sectionNode.children.push(pageNode);
                    sectionNode.pageCount++;
                }

                notebookNode.children.push(sectionNode);
                notebookNode.pageCount += sectionNode.pageCount;
            }

            structure.push(notebookNode);
        }

        return structure;
    } catch (err) {
        logger.error("Failed to get OneNote structure", { error: err.message });
        throw err;
    }
}

// OAuth flow functions
function getAuthUrl() {
    const clientId = process.env.ONENOTE_CLIENT_ID;
    //    let tenantId = process.env.ONENOTE_TENANT_ID || "common";
    let tenantId = "e16dc3da-07d9-42ba-9a2d-d9d4bd79e0a3";
    const redirectUri =
        process.env.ONENOTE_REDIRECT_URI || "http://localhost:3000";
    const normalizedRedirectUri = redirectUri.trim().replace(/\/$/, "");

    if (!clientId) {
        throw new Error("OneNote: Missing ONENOTE_CLIENT_ID");
    }

    // For personal Microsoft accounts, use "consumers" endpoint
    // Check if tenantId is set to "consumers" or if it's a personal account
    if (tenantId === "consumers" || tenantId === "common") {
        // You might want to use "consumers" for personal accounts
        // tenantId = "consumers"; // Uncomment if needed
    }

    const scopes = [
        "https://graph.microsoft.com/Notes.ReadWrite.All",
        "https://graph.microsoft.com/User.Read",
        "offline_access",
    ];

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: normalizedRedirectUri + "/api/joplin/onenote/callback",
        response_mode: "query",
        scope: scopes.join(" "),
        state: "onenote-auth-state",
    });

    const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
    return authUrl;
}

async function exchangeCodeForTokens(authorizationCode) {
    const clientId = process.env.ONENOTE_CLIENT_ID;
    const clientSecret = process.env.ONENOTE_CLIENT_SECRET;
    const tenantId = process.env.ONENOTE_TENANT_ID || "common";
    const redirectUri =
        process.env.ONENOTE_REDIRECT_URI || "http://localhost:3000";
    // Normalize redirect URI
    const normalizedRedirectUri = redirectUri.trim().replace(/\/$/, "");

    if (!clientId || !clientSecret) {
        throw new Error(
            "OneNote: Missing ONENOTE_CLIENT_ID or ONENOTE_CLIENT_SECRET"
        );
    }

    try {
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

        const params = new URLSearchParams();
        params.append("client_id", clientId);
        params.append("client_secret", clientSecret);
        params.append("code", authorizationCode);
        params.append("grant_type", "authorization_code");
        params.append(
            "redirect_uri",
            normalizedRedirectUri + "/api/joplin/onenote/callback"
        );
        params.append("scope", "https://graph.microsoft.com/.default");

        const response = await axios.post(tokenUrl, params.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        if (response.data && response.data.access_token) {
            // Clear cached token to force refresh
            _accessToken = null;
            _tokenExpiry = 0;

            logger.info("Successfully exchanged authorization code for tokens");

            return {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
                expiresIn: response.data.expires_in,
                tokenType: response.data.token_type,
            };
        } else {
            throw new Error(
                "Failed to exchange code for tokens: No token in response"
            );
        }
    } catch (err) {
        const errorData = err.response?.data;
        logger.error("Failed to exchange authorization code for tokens", {
            error: err.message,
            response: errorData,
        });
        throw new Error(
            `Failed to exchange authorization code: ${
                errorData?.error_description || err.message
            }`
        );
    }
}

module.exports = {
    syncChunksToOneNote,
    testConnection,
    removeAndRecreateBookSection,
    processOneNoteSyncBooksJob,
    processRecreateBookSectionJob,
    ensureChunksReadyForBook,
    getOneNoteNotebooks,
    getOneNoteSectionGroups,
    getOneNoteSections,
    getOneNotePages,
    getOneNoteStructure,
    getAuthUrl,
    exchangeCodeForTokens,
};

/*
Reviewing the code to understand the token flow, then outlining steps to get tokens and set up the Azure app.
Here’s a guide to get OneNote tokens and set up the Azure app.
Step-by-step guide
Part 1: Azure App Registration setup
Go to Azure Portal
Visit: https://portal.azure.com
Sign in with your Microsoft account
Create App Registration
Search for "Azure Active Directory" or "Microsoft Entra ID"
Go to "App registrations" → "New registration"
Name: "AlexLib OneNote App" (or any name)
Supported account types:
Personal Microsoft accounts only (if using personal account)
Accounts in any organizational directory (if using work/school)
Redirect URI:
Platform: Web
URI: http://localhost:3000/api/joplin/onenote/callback (must match exactly)
Configure API permissions
Go to "API permissions" → "Add a permission"
Select "Microsoft Graph" → "Delegated permissions"
Add:
Notes.ReadWrite.All
User.Read
Click "Add permissions"
Click "Grant admin consent" (if using work/school account)
Create client secret
Go to "Certificates & secrets" → "New client secret"
Description: "OneNote App Secret"
Expires: Choose duration (e.g., 24 months)
Click "Add"
Part 2: Environment variables


Add to your .env file:
ONENOTE_CLIENT_ID=your-client-id-hereONENOTE_CLIENT_SECRET=your-client-secret-hereONENOTE_TENANT_ID=common# OR for work/school account: ONENOTE_TENANT_ID=your-tenant-id-hereONENOTE_REDIRECT_URI=http://localhost:3000ONENOTE_REFRESH_TOKEN=
Part 3: Getting tokens (manual method)
Start your server
   npm start   # or however you start your server
Get authorization URL
Visit: http://localhost:3000/api/joplin/onenote/auth
Or use curl:
     curl http://localhost:3000/api/joplin/onenote/auth
Copy the authUrl from the response
Authorize in browser
Open the authUrl in your browser
Sign in with your Microsoft account
Grant permissions
You’ll be redirected to: http://localhost:3000/api/joplin/onenote/callback?code=...
Copy refresh token
The callback page shows your refresh token
Copy the entire line: ONENOTE_REFRESH_TOKEN=...
Add it to your .env file
Restart server and test
   # Restart your server   curl -X POST http://localhost:3000/api/joplin/test-connection
Part 4: Auto browser interaction (code improvement)
There’s a bug in graphRequest that prevents it from working. Here’s the fix:
oneNoteService.js
+27
-19
    console.log("contentType:", contentType);    const token = await getAccessToken();    if (token.status === "success") {        return {
    //print out all the value to console    console.log("method:", method);    console.log("endpoint:", endpoint);    console.log("data:", data);    console.log("params:", params);    console.log("contentType:", contentType);    if (token.status === "success") {        return {            status: "success",            message: token.message,        };    } else if (token.status === "redirect") {    const token = await getAccessToken();
17 hidden lines
Also fix getAccessToken to not return error objects:
oneNoteService.js
+27
-24
            message: errorMessage,        };    }) {    //print out all the value to console
        return {            status: "error",            message: errorMessage,        };    //print out all the value to console    console.log("method:", method);    console.log("endpoint:", endpoint);    console.log("data:", data);    console.log("params:", params);    console.log("contentType:", contentType);    }) {
9 hidden lines
17 hidden lines
Part 5: Important notes
Tenant ID for personal accounts:
If using a personal Microsoft account, use ONENOTE_TENANT_ID=common or consumers
If you see error AADSTS9002346, your app is configured for personal accounts only. Use:
     https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize
Update getAuthUrl() to use consumers if needed:

oneNot
eService.js
+37
-28
            message: errorMessage,        };    }) {    //print out all the value to console
        return {            status: "error",            message: errorMessage,        };    //print out all the value to console    console.log("method:", method);    console.log("endpoint:", endpoint);    console.log("data:", data);    console.log("params:", params);    console.log("contentType:", contentType);    }) {
9 hidden lines
17 hidden lines
779 hidden lines
4 hidden lines
1 hidden lines
6 hidden lines
Redirect URI must match exactly:
No trailing slash
Exact match in Azure and your code
If using http://localhost:3000, ensure no port mismatch
Testing the flow:
Visit: http://localhost:3000/api/joplin/onenote/auth
Copy the URL and open in browser
Complete authorization
Copy the refresh token from the success page
Add to .env and restart
Should I implement these fixes, or do you want to test the manual flow first?
*/
