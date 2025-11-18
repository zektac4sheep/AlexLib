// API Service Layer
const API_BASE = "";

// Fetch wrapper with timeout and better error handling
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Notify app that a request is starting
    if (window.app) {
        window.app.$emit("api-request-start");
    }

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        // Notify app that request is complete
        if (window.app) {
            window.app.$emit("api-request-end");
        }

        return response;
    } catch (error) {
        clearTimeout(timeoutId);

        // Notify app that request is complete (even on error)
        if (window.app) {
            window.app.$emit("api-request-end");
        }

        // Handle different types of errors
        if (error.name === "AbortError") {
            throw new Error("請求超時，請稍後再試");
        } else if (
            error.message === "Failed to fetch" ||
            error.name === "TypeError"
        ) {
            throw new Error("無法連接到伺服器，請檢查網路連線或稍後再試");
        } else {
            throw error;
        }
    }
}

// Helper function to handle API responses
async function handleResponse(response, defaultError = "操作失敗") {
    try {
        const data = await response.json();

        if (!response.ok) {
            const error = new Error(data.error || data.message || defaultError);
            error.status = response.status;
            throw error;
        }

        return data;
    } catch (error) {
        // If JSON parsing fails, throw a more descriptive error
        if (error instanceof SyntaxError) {
            throw new Error(`伺服器回應格式錯誤 (HTTP ${response.status})`);
        }
        throw error;
    }
}

window.API = {
    // Search API
    async search(keyword, pages) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/search?keyword=${encodeURIComponent(
                keyword
            )}&pages=${pages}`
        );
        return handleResponse(response, "搜尋失敗");
    },

    async getSearchHistory(keyword = null, limit = 50) {
        let url = `${API_BASE}/api/search/history?limit=${limit}`;
        if (keyword) {
            url += `&keyword=${encodeURIComponent(keyword)}`;
        }
        const response = await fetchWithTimeout(url);
        return handleResponse(response, "載入搜尋歷史失敗");
    },

    async deleteSearchResult(id) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/search/${id}`,
            {
                method: "DELETE",
            }
        );
        return handleResponse(response, "刪除搜尋結果失敗");
    },

    async uploadSearchHtml(file) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetchWithTimeout(
            `${API_BASE}/api/search/upload-html`,
            {
                method: "POST",
                body: formData,
            },
            60000
        ); // Longer timeout for file uploads
        return handleResponse(response, "上傳檔案失敗");
    },

    // Books API
    async getBooks() {
        const response = await fetchWithTimeout(`${API_BASE}/api/books`);
        return handleResponse(response, "載入書籍列表失敗");
    },

    async getBook(id) {
        const response = await fetchWithTimeout(`${API_BASE}/api/books/${id}`);
        return handleResponse(response, "載入書籍資訊失敗");
    },

    async createBook(bookData) {
        const response = await fetchWithTimeout(`${API_BASE}/api/books`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bookData),
        });
        return handleResponse(response, "建立書籍失敗");
    },

    async updateBook(id, bookData) {
        const response = await fetchWithTimeout(`${API_BASE}/api/books/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bookData),
        });
        return handleResponse(response, "更新書籍失敗");
    },

    async deleteBook(id) {
        const response = await fetchWithTimeout(`${API_BASE}/api/books/${id}`, {
            method: "DELETE",
        });
        return handleResponse(response, "刪除書籍失敗");
    },

    async getBookChapters(id) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${id}/chapters`
        );
        return handleResponse(response, "載入章節列表失敗");
    },

    async getChapter(bookId, chapterId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${bookId}/chapters/${chapterId}`
        );
        return handleResponse(response, "載入章節失敗");
    },

    // Add chapters by URL
    async addChaptersByUrl(bookId, chapters) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${bookId}/add-chapters-url`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chapters }),
            }
        );
        return handleResponse(response, "新增章節失敗");
    },

    // Add chapters by file
    async addChaptersByFile(formData) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/add-chapters-file`,
            {
                method: "POST",
                body: formData,
            }
        );
        return handleResponse(response, "上傳檔案失敗");
    },

    async updateChapter(bookId, chapterId, chapterData) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${bookId}/chapters/${chapterId}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(chapterData),
            }
        );
        return handleResponse(response, "更新章節失敗");
    },

    async exportToJoplin(id, notebookId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${id}/export-joplin`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ notebookId }),
            },
            60000
        ); // Longer timeout for export operations
        return handleResponse(response, "匯出到 Joplin 失敗");
    },

    async rescanBookChapters(id) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${id}/rescan-chapters`,
            {
                method: "POST",
            },
            60000
        ); // Longer timeout for rescan operations
        return handleResponse(response, "重新掃描章節失敗");
    },

    async reformatBookChapters(id) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${id}/reformat-chapters`,
            {
                method: "POST",
            },
            60000
        ); // Longer timeout for reformat operations
        return handleResponse(response, "重新格式化章節失敗");
    },

    // Book search API - unified endpoint (creates a job, returns immediately)
    async searchBookChapters(id, options = {}) {
        const { missingChapters, bookName, pages } = options;
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${id}/search-chapters`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    missingChapters,
                    bookName,
                    pages,
                }),
            }
        );
        return handleResponse(response, "建立搜尋任務失敗");
    },

    // Get search job status
    async getBookSearchJob(bookId, jobId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${bookId}/search-jobs/${jobId}`
        );
        return handleResponse(response, "載入搜尋任務狀態失敗");
    },

    // Get all search jobs for a book
    async getBookSearchJobs(bookId, limit = 20) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${bookId}/search-jobs?limit=${limit}`
        );
        return handleResponse(response, "載入搜尋任務列表失敗");
    },

    // Get search results from a completed job
    async getBookSearchResults(bookId, jobId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/books/${bookId}/search-jobs/${jobId}/results`
        );
        return handleResponse(response, "載入搜尋結果失敗");
    },

    // Legacy methods for backward compatibility (deprecated - use searchBookChapters instead)
    async searchMissingChapters(id, missingChapters, bookName, pages = 5) {
        return this.searchBookChapters(id, "missing", {
            missingChapters,
            bookName,
            pages,
        });
    },

    async searchDownChapters(id, pages = 5) {
        return this.searchBookChapters(id, "down", { pages });
    },

    async searchNewChapters(id, pages = 3) {
        return this.searchBookChapters(id, "new", { pages });
    },

    // Download API
    async startDownload(downloadData) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/download/start`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(downloadData),
            }
        );
        return handleResponse(response, "啟動下載任務失敗");
    },

    async getDownloadStatus(jobId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/download/${jobId}/status`
        );
        return handleResponse(response, "載入下載狀態失敗");
    },

    async getDownloads(limit = 50) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/download?limit=${limit}`
        );
        return handleResponse(response, "載入下載列表失敗");
    },

    async retryFailedChapters(jobId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/download/retry-failed`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId }),
            }
        );
        return handleResponse(response, "重試失敗章節失敗");
    },

    // Upload API
    async uploadFile(file) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetchWithTimeout(
            `${API_BASE}/api/upload`,
            {
                method: "POST",
                body: formData,
            },
            120000
        ); // Longer timeout for file uploads
        return handleResponse(response, "上傳檔案失敗");
    },

    async analyzeFile(filename, originalName) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/upload/analyze`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename, originalName }),
            },
            60000
        ); // Longer timeout for analysis
        return handleResponse(response, "分析檔案失敗");
    },

    async processFile(processData) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/upload/process`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(processData),
            },
            120000
        ); // Longer timeout for processing
        return handleResponse(response, "處理檔案失敗");
    },

    async extractAndCreateBook(filename, originalName) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/upload/extract-and-create`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename, originalName }),
            },
            120000
        ); // Longer timeout for extraction
        return handleResponse(response, "提取並建立書籍失敗");
    },

    // Joplin API
    async testJoplinConnection(port, token) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/test-connection`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ port, token }),
            }
        );
        return handleResponse(response, "測試連線失敗");
    },

    async syncJoplinStructure(port, token) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/sync-structure`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ port, token }),
            }
        );
        return handleResponse(response, "同步結構失敗");
    },

    async syncJoplinBooks(port, token) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/sync-books`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ port, token }),
            }
        );
        return handleResponse(response, "同步書籍失敗");
    },

    async syncJoplinTaggedBooks(port, token) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/sync-tagged-books`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ port, token }),
            }
        );
        return handleResponse(response, "同步有標籤書籍失敗");
    },

    async recreateJoplinBookFolder(bookId, port, token) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/recreate-book-folder/${bookId}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ port, token }),
            }
        );
        return handleResponse(response, "重新建立書籍資料夾失敗");
    },

    async getJoplinJob(jobId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/jobs/${jobId}`
        );
        return handleResponse(response, "載入 Joplin 任務失敗");
    },

    async getJoplinJobs(limit = 50) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/jobs?limit=${limit}`
        );
        return handleResponse(response, "載入 Joplin 任務列表失敗");
    },

    async getJoplinFolders() {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/folders`
        );
        return handleResponse(response, "載入 Joplin 資料夾失敗");
    },

    async getJoplinNotes(limit = 100) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/notes?limit=${limit}`
        );
        return handleResponse(response, "載入 Joplin 筆記失敗");
    },

    // Source Joplin API
    async getSourceJoplinSettings() {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/settings`
        );
        return handleResponse(response, "載入來源 Joplin 設定失敗");
    },

    async saveSourceJoplinSettings(settings) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/settings`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings),
            }
        );
        return handleResponse(response, "儲存來源 Joplin 設定失敗");
    },

    async testSourceJoplinConnection(apiUrl, apiToken) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/test-connection`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiUrl, apiToken }),
            }
        );
        return handleResponse(response, "測試連線失敗");
    },

    async syncSourceJoplinStructure(apiUrl, apiToken) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/sync`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiUrl, apiToken }),
            }
        );
        return handleResponse(response, "同步結構失敗");
    },

    async getSourceJoplinTree() {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/tree`
        );
        return handleResponse(response, "載入來源樹狀結構失敗");
    },

    async getSourceJoplinFolders() {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/folders`
        );
        return handleResponse(response, "載入來源資料夾失敗");
    },

    async getSourceJoplinNotes(limit = 1000) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/notes?limit=${limit}`
        );
        return handleResponse(response, "載入來源筆記失敗");
    },

    async getSourceJoplinNotesByFolder(folderId) {
        // Handle null/empty for root level notes
        const folderIdParam = folderId === null || folderId === undefined ? "" : folderId;
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/notes?folderId=${encodeURIComponent(folderIdParam)}`
        );
        return handleResponse(response, "載入資料夾筆記失敗");
    },

    async debugSourceJoplinFolder(folderName) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/debug/folder/${encodeURIComponent(folderName)}`
        );
        return handleResponse(response, "Failed to debug folder");
    },

    async debugSourceJoplinRootFolders() {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/debug/root-folders`
        );
        return handleResponse(response, "Failed to debug root folders");
    },

    async getSourceJoplinFolderNoteCount(folderId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/folders/${encodeURIComponent(folderId)}/note-count`
        );
        return handleResponse(response, "載入資料夾筆記數量失敗");
    },

    async importFromSourceJoplin(data) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/joplin/source/import`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            },
            120000
        );
        return handleResponse(response, "匯入失敗");
    },

    // Bot Status API
    async getBotStatus() {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/bot-status/operations`
        );
        return handleResponse(response, "載入狀態失敗");
    },

    // Chunks API
    async getChunkBooks() {
        const response = await fetchWithTimeout(`${API_BASE}/api/chunks/books`);
        return handleResponse(response, "載入分塊書籍列表失敗");
    },

    async generateChunks(bookId, chunkSize) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/chunks/books/${bookId}/generate`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chunkSize }),
            },
            60000
        ); // Longer timeout for chunk generation
        return handleResponse(response, "生成分塊失敗");
    },

    async getChunkPreview(bookId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/chunks/books/${bookId}/preview`
        );
        return handleResponse(response, "載入分塊預覽失敗");
    },

    async getChunkContent(bookId, chunkNumber) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/chunks/books/${bookId}/chunks/${chunkNumber}`
        );
        return handleResponse(response, "載入分塊內容失敗");
    },

    // Jobs API
    async getAllJobs(queryString = "") {
        const url = queryString
            ? `${API_BASE}/api/jobs?${queryString}`
            : `${API_BASE}/api/jobs`;
        const response = await fetchWithTimeout(url);
        return handleResponse(response, "載入任務列表失敗");
    },

    async getJob(type, id) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/jobs/${type}/${id}`
        );
        return handleResponse(response, "載入任務失敗");
    },

    async deleteJob(type, id) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/jobs/${type}/${id}`,
            {
                method: "DELETE",
            }
        );
        return handleResponse(response, "刪除任務失敗");
    },

    async retryJob(type, id) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/jobs/${type}/${id}/retry`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(
                error.message || error.error || "Failed to retry job"
            );
        }

        return await response.json();
    },

    async finishBookSearchJob(jobId) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/jobs/book_search/${jobId}/finish`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(
                error.message || error.error || "Failed to finish job"
            );
        }

        return await response.json();
    },

    async createDownloadFromSearch(
        jobId,
        selectedChapters,
        conflictResolutions = null
    ) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/jobs/book_search/${jobId}/create-download`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    selectedChapters,
                    conflictResolutions: conflictResolutions || undefined,
                }),
            }
        );
        return handleResponse(response, "建立下載任務失敗");
    },

    async confirmUploadJob(jobId, confirmationData) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/jobs/upload/${jobId}/confirm`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(confirmationData),
            }
        );
        return handleResponse(response, "確認上傳任務失敗");
    },

    // Auto Search API
    async setAutoSearchEnabled(enabled) {
        const response = await fetchWithTimeout(
            `${API_BASE}/api/auto-search/enabled`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled }),
            }
        );
        return handleResponse(response, "設定自動搜尋失敗");
    },
};
