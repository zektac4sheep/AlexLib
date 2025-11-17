// ResultsTab Component
Vue.component("results-tab", {
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">搜尋結果</h3>

            <div v-if="!currentKeyword && (!searchResults || searchResults.length === 0)" class="text-center text-muted py-5">
                <p>尚無搜尋結果</p>
                <p class="small">請在「搜尋」標籤頁中進行搜尋</p>
            </div>

            <div v-else>
                <!-- Search Info -->
                <div class="card mb-4" v-if="currentKeyword">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h5 class="mb-1">關鍵字: {{ currentKeyword }}</h5>
                                <p class="text-muted mb-0 small">
                                    共找到 {{ searchResults ? searchResults.length : 0 }} 個結果
                                </p>
                            </div>
                            <div>
                                <button 
                                    class="btn btn-sm btn-outline-secondary" 
                                    @click="clearResults"
                                >
                                    清除結果
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Bulk Actions - Top -->
                <div v-if="selectedIndices.length > 0" class="mb-3 p-3 bg-light rounded">
                    <div class="d-flex justify-content-between align-items-center">
                        <span>已選擇 {{ selectedIndices.length }} 個項目</span>
                        <div class="btn-group">
                            <button 
                                class="btn btn-primary"
                                @click="downloadSelected"
                                :disabled="downloading"
                            >
                                <span v-if="downloading" class="spinner-border spinner-border-sm me-2"></span>
                                下載選取的項目
                            </button>
                            <button 
                                class="btn btn-secondary"
                                @click="clearSelection"
                            >
                                取消選擇
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Results List -->
                <div v-if="searchResults && searchResults.length > 0">
                    <div class="card">
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-hover">
                                    <thead>
                                        <tr>
                                            <th style="width: 50px;">
                                                <input 
                                                    type="checkbox" 
                                                    @change="toggleSelectAll"
                                                    :checked="allSelected"
                                                />
                                            </th>
                                            <th>標題</th>
                                            <th>作者</th>
                                            <th>回覆數</th>
                                            <th>最後更新</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr 
                                            v-for="(thread, index) in searchResults" 
                                            :key="index"
                                            :class="{ 'table-active': isSelected(index) }"
                                        >
                                            <td>
                                                <input 
                                                    type="checkbox" 
                                                    :checked="isSelected(index)"
                                                    @change="toggleSelect(index)"
                                                />
                                            </td>
                                            <td>
                                                <a 
                                                    :href="thread.url" 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    class="text-decoration-none"
                                                >
                                                    {{ thread.title }}
                                                </a>
                                            </td>
                                            <td>{{ thread.author || '未知' }}</td>
                                            <td>{{ thread.replies || 0 }}</td>
                                            <td>{{ formatDate(thread.lastUpdate) }}</td>
                                            <td>
                                                <button 
                                                    class="btn btn-sm btn-primary"
                                                    @click="downloadThread(thread)"
                                                    :disabled="downloadingThreads.includes(index)"
                                                >
                                                    <span v-if="downloadingThreads.includes(index)" class="spinner-border spinner-border-sm me-1"></span>
                                                    下載
                                                </button>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                <div v-else class="alert alert-info">
                    沒有搜尋結果
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            searchResults: [],
            currentKeyword: "",
            selectedIndices: [],
            downloading: false,
            downloadingThreads: [],
        };
    },
    computed: {
        allSelected() {
            return (
                this.searchResults.length > 0 &&
                this.selectedIndices.length === this.searchResults.length
            );
        },
    },
    mounted() {
        console.log("[ResultsTab] Component mounted");
        console.log(
            "[ResultsTab] Checking for stored results in app instance",
            {
                hasApp: !!window.app,
                hasSearchResults: !!(window.app && window.app.searchResults),
                searchResults: window.app ? window.app.searchResults : null,
                searchKeyword: window.app ? window.app.searchKeyword : null,
            }
        );

        // Check if there are stored search results in app instance (fallback for missed events)
        if (window.app && window.app.searchResults) {
            console.log("[ResultsTab] Found stored results, processing them");
            this.processSearchResults(
                window.app.searchResults,
                window.app.searchKeyword
            );
        } else {
            console.log("[ResultsTab] No stored results found");
        }

        // Listen for search completed events
        const eventHandler = (results, keyword) => {
            console.log("[ResultsTab] search-completed event received", {
                results,
                keyword,
                resultsType: typeof results,
                isArray: Array.isArray(results),
                hasThreads: !!(results && results.threads),
            });
            this.processSearchResults(results, keyword);
        };

        if (window.app) {
            console.log(
                "[ResultsTab] Registering event listener on window.app"
            );
            window.app.$on("search-completed", eventHandler);
        } else {
            console.log("[ResultsTab] Registering event listener on $root");
            this.$root.$on("search-completed", eventHandler);
        }
    },
    methods: {
        processSearchResults(results, keyword) {
            console.log("[ResultsTab] processSearchResults called", {
                results,
                keyword,
                resultsType: typeof results,
                isArray: Array.isArray(results),
                hasThreads: !!(results && results.threads),
                threadsIsArray: !!(results && Array.isArray(results.threads)),
                threadsLength:
                    results && results.threads ? results.threads.length : 0,
            });

            // Handle different response structures
            let threads = [];
            let searchKeyword = keyword || "";

            if (results) {
                // If results has a threads property (API response structure)
                if (Array.isArray(results.threads)) {
                    threads = results.threads;
                    searchKeyword = keyword || results.keyword || "";
                    console.log(
                        "[ResultsTab] Found threads array in results.threads",
                        {
                            threadsLength: threads.length,
                            searchKeyword,
                        }
                    );
                }
                // If results is directly an array
                else if (Array.isArray(results)) {
                    threads = results;
                    console.log("[ResultsTab] Results is directly an array", {
                        threadsLength: threads.length,
                    });
                }
                // If results is an object but no threads property, try to find data
                else if (results.data && Array.isArray(results.data)) {
                    threads = results.data;
                    console.log("[ResultsTab] Found threads in results.data", {
                        threadsLength: threads.length,
                    });
                } else {
                    console.warn(
                        "[ResultsTab] Could not extract threads from results",
                        {
                            results,
                            resultsKeys: results ? Object.keys(results) : [],
                        }
                    );
                }
            } else {
                console.warn(
                    "[ResultsTab] No results provided to processSearchResults"
                );
            }

            console.log("[ResultsTab] Setting component data", {
                threadsLength: threads.length,
                searchKeyword,
                threadsPreview: threads.slice(0, 3),
            });

            this.searchResults = threads;
            this.currentKeyword = searchKeyword;
            this.selectedIndices = [];

            console.log("[ResultsTab] Component data updated", {
                searchResultsLength: this.searchResults.length,
                currentKeyword: this.currentKeyword,
            });
        },
        isSelected(index) {
            return this.selectedIndices.includes(index);
        },
        toggleSelect(index) {
            const idx = this.selectedIndices.indexOf(index);
            if (idx > -1) {
                this.selectedIndices.splice(idx, 1);
            } else {
                this.selectedIndices.push(index);
            }
        },
        toggleSelectAll() {
            if (this.allSelected) {
                this.selectedIndices = [];
            } else {
                this.selectedIndices = this.searchResults.map(
                    (_, index) => index
                );
            }
        },
        clearSelection() {
            this.selectedIndices = [];
        },
        clearResults() {
            this.searchResults = [];
            this.currentKeyword = "";
            this.selectedIndices = [];
        },
        async downloadThread(thread) {
            const index = this.searchResults.indexOf(thread);
            if (this.downloadingThreads.includes(index)) {
                return;
            }

            this.downloadingThreads.push(index);

            try {
                // Validate thread has URL
                if (!thread.url) {
                    alert("無法取得執行緒 URL");
                    return;
                }

                // Prepare chapter data
                const chapter = {
                    url: thread.url,
                    title: thread.title || thread.titleTraditional || "",
                    chapterNum: thread.chapterNumber || null,
                };

                // Determine book name - use detected book name or fallback to thread title
                // If no existing book ID, we'll create a new book
                const bookName =
                    thread.bookNameSimplified || thread.title || null;
                const bookNameTraditional =
                    thread.bookNameTraditional ||
                    thread.titleTraditional ||
                    null;

                // Prepare download data
                // If bookId is null, the API will create a new book
                const downloadData = {
                    chapters: [chapter],
                    bookId: thread.existingBookId || null, // null means create new book
                    bookName: bookName,
                    bookMetadata: {
                        bookName: bookName,
                        bookNameTraditional: bookNameTraditional,
                        sourceUrl: thread.url,
                    },
                };

                // Call download API
                const result = await window.API.startDownload(downloadData);

                if (result.error) {
                    alert("下載失敗: " + (result.message || result.error));
                } else {
                    const bookMessage = result.bookId
                        ? `，書籍 ID: ${result.bookId}`
                        : "（將建立新書籍）";
                    alert(
                        `下載任務已啟動 (任務 ID: ${result.jobId}${bookMessage})`
                    );
                    // Optionally switch to a downloads tab or show notification
                    if (window.app && window.app.$emit) {
                        window.app.$emit("download-started", result);
                    }
                }
            } catch (error) {
                console.error("Error downloading thread:", error);
                alert("下載失敗: " + (error.message || "Unknown error"));
            } finally {
                const idx = this.downloadingThreads.indexOf(index);
                if (idx > -1) {
                    this.downloadingThreads.splice(idx, 1);
                }
            }
        },
        async downloadSelected() {
            if (this.selectedIndices.length === 0) {
                return;
            }

            this.downloading = true;
            try {
                const selectedThreads = this.selectedIndices.map(
                    (idx) => this.searchResults[idx]
                );

                // Filter out threads without URLs
                const validThreads = selectedThreads.filter((t) => t.url);
                if (validThreads.length === 0) {
                    alert("沒有有效的執行緒可以下載");
                    return;
                }

                // Group threads by book name if available
                // If no book name detected, group by thread title (each thread becomes its own book)
                const threadsByBook = {};

                validThreads.forEach((thread) => {
                    const bookName = thread.bookNameSimplified;
                    if (bookName) {
                        // Group by detected book name
                        if (!threadsByBook[bookName]) {
                            threadsByBook[bookName] = {
                                bookName: bookName,
                                bookNameTraditional:
                                    thread.bookNameTraditional || null,
                                bookId: thread.existingBookId || null, // Use existing book ID if available
                                threads: [],
                            };
                        }
                        threadsByBook[bookName].threads.push(thread);
                    } else {
                        // For threads without detected book name, use thread title as book name
                        // Group by title to avoid creating duplicate books for same title
                        const fallbackBookName =
                            thread.title ||
                            thread.titleTraditional ||
                            `書籍_${thread.threadId || Date.now()}`;
                        if (!threadsByBook[fallbackBookName]) {
                            threadsByBook[fallbackBookName] = {
                                bookName: fallbackBookName,
                                bookNameTraditional:
                                    thread.titleTraditional ||
                                    thread.title ||
                                    null,
                                bookId: thread.existingBookId || null,
                                threads: [],
                            };
                        }
                        threadsByBook[fallbackBookName].threads.push(thread);
                    }
                });

                // Download all book groups (including those created from thread titles)
                const downloadPromises = [];

                // Download each book group
                for (const bookName in threadsByBook) {
                    const bookGroup = threadsByBook[bookName];
                    const chapters = bookGroup.threads.map((thread) => ({
                        url: thread.url,
                        title: thread.title || thread.titleTraditional || "",
                        chapterNum: thread.chapterNumber || null,
                    }));

                    // If bookId is null, API will create a new book
                    const downloadData = {
                        chapters: chapters,
                        bookId: bookGroup.bookId || null, // null means create new book
                        bookName: bookGroup.bookName,
                        bookMetadata: {
                            bookName: bookGroup.bookName,
                            bookNameTraditional: bookGroup.bookNameTraditional,
                            sourceUrl: bookGroup.threads[0]?.url || "",
                        },
                    };

                    downloadPromises.push(
                        window.API.startDownload(downloadData)
                    );
                }

                // Execute all downloads
                const results = await Promise.allSettled(downloadPromises);

                // Count successes and failures
                let successCount = 0;
                let failureCount = 0;
                const errors = [];

                results.forEach((result, index) => {
                    if (result.status === "fulfilled" && !result.value.error) {
                        successCount++;
                    } else {
                        failureCount++;
                        const error =
                            result.status === "rejected"
                                ? result.reason?.message || "Unknown error"
                                : result.value?.message ||
                                  result.value?.error ||
                                  "Unknown error";
                        errors.push(error);
                    }
                });

                // Show result message
                if (failureCount === 0) {
                    alert(`成功啟動 ${successCount} 個下載任務`);
                } else if (successCount === 0) {
                    alert(`下載失敗: ${errors[0] || "Unknown error"}`);
                } else {
                    alert(
                        `成功啟動 ${successCount} 個下載任務，${failureCount} 個失敗`
                    );
                }

                // Clear selection after successful downloads
                if (successCount > 0) {
                    this.selectedIndices = [];
                }

                // Emit event for any successful downloads
                if (successCount > 0 && window.app && window.app.$emit) {
                    results.forEach((result, index) => {
                        if (
                            result.status === "fulfilled" &&
                            !result.value.error
                        ) {
                            window.app.$emit("download-started", result.value);
                        }
                    });
                }
            } catch (error) {
                console.error("Error downloading selected threads:", error);
                alert("下載失敗: " + (error.message || "Unknown error"));
            } finally {
                this.downloading = false;
            }
        },
        formatDate(dateString) {
            if (!dateString) return "";
            const date = new Date(dateString);
            return date.toLocaleString("zh-TW");
        },
    },
});
