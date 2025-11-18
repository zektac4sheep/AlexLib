// SearchTab Component
Vue.component("search-tab", {
    template: `
        <div class="tab-content active p-4">
            <div class="d-flex gap-2 mb-4">
                <input
                    type="text"
                    v-model="searchKeyword"
                    class="form-control"
                    placeholder="輸入關鍵字搜尋 (例如: 都市、古裝)"
                    @keypress.enter="addToQueue"
                />
                <button class="btn btn-primary" @click="addToQueue" :disabled="processing">
                    加入搜尋佇列
                </button>
                <button class="btn btn-secondary" @click="triggerSearchHtmlUpload">
                    匯入搜尋HTML
                </button>
                <input
                    type="file"
                    ref="searchHtmlInput"
                    class="d-none"
                    accept=".html,.htm,.txt"
                    @change="handleSearchHtmlUpload"
                />
            </div>
            <div v-if="statusMessage" :class="['alert', statusType]">
                {{ statusMessage }}
            </div>

            <div class="bg-light p-3 rounded mb-4">
                <h3 class="h5 mb-3">搜尋佇列</h3>
                <div v-if="searchQueue.length === 0" class="text-center text-muted py-5">
                    佇列為空
                </div>
                <div v-else>
                    <div 
                        v-for="item in searchQueue" 
                        :key="item.id"
                        :class="['queue-item', 'card', 'mb-2', item.status]"
                    >
                        <div class="card-body d-flex justify-content-between align-items-center">
                            <div>
                                <div class="fw-bold">{{ getDisplayText(item) }}</div>
                                <div class="text-muted small">{{ getStatusText(item) }}</div>
                            </div>
                            <div class="btn-group">
                                <button 
                                    v-if="item.status === 'completed' && item.results"
                                    class="btn btn-sm btn-primary"
                                    @click="viewSearchResult(item)"
                                    title="查看搜尋結果"
                                >
                                    查看結果
                                </button>
                                <button 
                                    v-if="item.status === 'error'"
                                    class="btn btn-sm btn-warning"
                                    @click="retrySearch(item)"
                                    title="重試搜尋"
                                >
                                    重試
                                </button>
                                <button 
                                    v-if="item.status !== 'processing'"
                                    class="btn btn-sm btn-danger"
                                    @click="removeFromQueue(item.id)"
                                    title="從佇列移除"
                                >
                                    移除
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="bg-light p-3 rounded">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h3 class="h5 mb-0">搜尋歷史</h3>
                    <div class="btn-group">
                        <button 
                            v-if="selectedHistoryItems.length > 0"
                            class="btn btn-sm btn-danger"
                            @click="bulkDeleteHistory"
                            :disabled="deletingHistory"
                        >
                            <span v-if="deletingHistory" class="spinner-border spinner-border-sm me-1"></span>
                            刪除選取 ({{ selectedHistoryItems.length }})
                        </button>
                        <button 
                            class="btn btn-sm btn-outline-secondary"
                            @click="toggleSelectAllHistory"
                        >
                            {{ allHistorySelected ? '取消全選' : '全選' }}
                        </button>
                        <button 
                            class="btn btn-sm btn-outline-primary" 
                            @click="loadSearchHistory"
                            :disabled="loadingHistory"
                        >
                            <span v-if="loadingHistory" class="spinner-border spinner-border-sm me-1"></span>
                            重新載入
                        </button>
                    </div>
                </div>
                <div v-if="loadingHistory" class="text-center text-muted py-3">
                    載入中...
                </div>
                <div v-else-if="searchHistory.length === 0" class="text-center text-muted py-5">
                    尚無搜尋歷史
                </div>
                <div v-else>
                    <div 
                        v-for="item in searchHistory" 
                        :key="item.id"
                        :class="['card', 'mb-2', { 'border-primary': isHistorySelected(item.id) }]"
                    >
                        <div class="card-body d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center flex-grow-1">
                                <input 
                                    type="checkbox" 
                                    class="form-check-input me-3"
                                    :checked="isHistorySelected(item.id)"
                                    @change="toggleHistorySelection(item.id)"
                                    style="width: 18px; height: 18px; cursor: pointer;"
                                />
                                <div class="flex-grow-1">
                                    <div class="fw-bold">{{ item.keyword }}</div>
                                    <div class="text-muted small">
                                        {{ formatDate(item.created_at) }} · 
                                        {{ item.total_results || 0 }} 個結果
                                    </div>
                                </div>
                            </div>
                            <div class="btn-group">
                                <button 
                                    class="btn btn-sm btn-outline-primary"
                                    @click="loadSearchResult(item)"
                                    title="載入此搜尋結果"
                                >
                                    載入
                                </button>
                                <button 
                                    class="btn btn-sm btn-outline-danger"
                                    @click="deleteSearchHistory(item.id)"
                                    title="刪除此搜尋歷史"
                                >
                                    刪除
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            searchKeyword: "",
            searchQueue: [],
            processing: false,
            statusMessage: "",
            statusType: "",
            searchHistory: [],
            loadingHistory: false,
            selectedHistoryItems: [],
            deletingHistory: false,
        };
    },
    computed: {
        allHistorySelected() {
            return (
                this.searchHistory.length > 0 &&
                this.selectedHistoryItems.length === this.searchHistory.length
            );
        },
    },
    mounted() {
        this.loadSearchStateFromLocalStorage();
        this.processQueue();
        this.loadSearchHistory();
    },
    methods: {
        addToQueue() {
            if (!this.searchKeyword.trim()) {
                this.showStatus("請輸入搜尋關鍵字", "error");
                return;
            }

            const searchId = Date.now();
            const queueItem = {
                id: searchId,
                type: "search",
                keyword: this.normalizeToHalfWidth(this.searchKeyword.trim()),
                pages: 3,
                status: "pending",
                results: null,
            };

            this.searchQueue.push(queueItem);
            this.searchKeyword = "";
            this.saveSearchStateToLocalStorage();

            if (!this.processing) {
                this.processQueue();
            }
        },
        async processQueue() {
            if (this.processing || this.searchQueue.length === 0) return;

            const pendingItem = this.searchQueue.find(
                (item) => item.status === "pending"
            );
            if (!pendingItem) return;

            this.processing = true;
            pendingItem.status = "processing";
            this.saveSearchStateToLocalStorage();

            try {
                if (pendingItem.type === "search") {
                    const results = await window.API.search(
                        pendingItem.keyword,
                        pendingItem.pages
                    );
                    pendingItem.results = results;
                    pendingItem.status = "completed";
                    // Store results in app instance for persistence
                    if (window.app) {
                        window.app.searchResults = results;
                        window.app.searchKeyword = pendingItem.keyword || "";
                    }
                    if (window.app) {
                        window.app.$emit(
                            "search-completed",
                            results,
                            pendingItem.keyword
                        );
                    } else {
                        this.$root.$emit(
                            "search-completed",
                            results,
                            pendingItem.keyword
                        );
                    }
                } else if (pendingItem.type === "missing-chapters") {
                    // Handle missing chapters search
                    const results = await window.API.search(
                        pendingItem.bookName,
                        3
                    );
                    pendingItem.results = results;
                    pendingItem.status = "completed";
                    this.$root.$emit(
                        "missing-chapters-completed",
                        results,
                        pendingItem
                    );
                }
            } catch (error) {
                console.error("Search error:", error);
                pendingItem.status = "error";
                this.showStatus("搜尋失敗: " + error.message, "error");
            } finally {
                this.processing = false;
                this.saveSearchStateToLocalStorage();
                // Process next item
                setTimeout(() => this.processQueue(), 100);
            }
        },
        removeFromQueue(id) {
            this.searchQueue = this.searchQueue.filter(
                (item) => item.id !== id
            );
            this.saveSearchStateToLocalStorage();
        },
        getDisplayText(item) {
            if (item.type === "missing-chapters") {
                return `🔍 搜尋缺失章節: ${
                    item.bookName || `書籍 ID ${item.bookId}`
                }`;
            }
            return item.keyword || "未知";
        },
        getStatusText(item) {
            if (item.status === "processing") {
                return "搜尋中...";
            } else if (item.status === "completed") {
                // Handle different response structures
                let count = 0;
                if (item.results) {
                    if (Array.isArray(item.results.threads)) {
                        count = item.results.threads.length;
                    } else if (Array.isArray(item.results)) {
                        count = item.results.length;
                    } else if (item.results.totalResults) {
                        count = item.results.totalResults;
                    }
                }
                return `完成 (${count} 結果)`;
            } else if (item.status === "error") {
                return "錯誤";
            }
            return "等待中";
        },
        triggerSearchHtmlUpload() {
            this.$refs.searchHtmlInput.click();
        },
        async handleSearchHtmlUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const result = await window.API.uploadSearchHtml(file);
                if (result.error) {
                    this.showStatus("上傳失敗: " + result.message, "error");
                } else {
                    this.showStatus("上傳成功", "success");
                    // Store results in app instance for persistence
                    if (window.app) {
                        window.app.searchResults = result;
                        window.app.searchKeyword = result.keyword || "";
                    }
                    if (window.app) {
                        window.app.$emit(
                            "search-completed",
                            result,
                            result.keyword
                        );
                    } else {
                        this.$root.$emit(
                            "search-completed",
                            result,
                            result.keyword
                        );
                    }
                }
            } catch (error) {
                this.showStatus("上傳失敗: " + error.message, "error");
            }
        },
        showStatus(message, type) {
            this.statusMessage = message;
            this.statusType =
                type === "error"
                    ? "alert-danger"
                    : type === "success"
                    ? "alert-success"
                    : "alert-info";
            if (type === "success" || type === "error") {
                setTimeout(() => {
                    this.statusMessage = "";
                }, 5000);
            }
        },
        normalizeToHalfWidth(text) {
            if (!text) return text;
            const fullToHalf = {
                Ａ: "A",
                Ｂ: "B",
                Ｃ: "C",
                Ｄ: "D",
                Ｅ: "E",
                Ｆ: "F",
                Ｇ: "G",
                Ｈ: "H",
                Ｉ: "I",
                Ｊ: "J",
                Ｋ: "K",
                Ｌ: "L",
                Ｍ: "M",
                Ｎ: "N",
                Ｏ: "O",
                Ｐ: "P",
                Ｑ: "Q",
                Ｒ: "R",
                Ｓ: "S",
                Ｔ: "T",
                Ｕ: "U",
                Ｖ: "V",
                Ｗ: "W",
                Ｘ: "X",
                Ｙ: "Y",
                Ｚ: "Z",
                ａ: "a",
                ｂ: "b",
                ｃ: "c",
                ｄ: "d",
                ｅ: "e",
                ｆ: "f",
                ｇ: "g",
                ｈ: "h",
                ｉ: "i",
                ｊ: "j",
                ｋ: "k",
                ｌ: "l",
                ｍ: "m",
                ｎ: "n",
                ｏ: "o",
                ｐ: "p",
                ｑ: "q",
                ｒ: "r",
                ｓ: "s",
                ｔ: "t",
                ｕ: "u",
                ｖ: "v",
                ｗ: "w",
                ｘ: "x",
                ｙ: "y",
                ｚ: "z",
                "０": "0",
                "１": "1",
                "２": "2",
                "３": "3",
                "４": "4",
                "５": "5",
                "６": "6",
                "７": "7",
                "８": "8",
                "９": "9",
                "　": " ",
            };
            let normalized = text;
            for (const [full, half] of Object.entries(fullToHalf)) {
                normalized = normalized.replace(new RegExp(full, "g"), half);
            }
            return normalized;
        },
        saveSearchStateToLocalStorage() {
            try {
                localStorage.setItem(
                    "alexLib_searchQueue",
                    JSON.stringify(this.searchQueue)
                );
            } catch (error) {
                console.error("Error saving search state:", error);
            }
        },
        loadSearchStateFromLocalStorage() {
            try {
                const savedQueue = localStorage.getItem("alexLib_searchQueue");
                if (savedQueue) {
                    this.searchQueue = JSON.parse(savedQueue).filter(
                        (item) => item.status !== "processing"
                    );
                }
            } catch (error) {
                console.error("Error loading search state:", error);
            }
        },
        async loadSearchHistory() {
            this.loadingHistory = true;
            try {
                const response = await window.API.getSearchHistory();
                if (response.searches) {
                    this.searchHistory = response.searches;
                } else {
                    this.searchHistory = [];
                }
            } catch (error) {
                console.error("Error loading search history:", error);
                this.showStatus("載入搜尋歷史失敗: " + error.message, "error");
                this.searchHistory = [];
            } finally {
                this.loadingHistory = false;
            }
        },
        async deleteSearchHistory(id) {
            if (!confirm("確定要刪除此搜尋歷史嗎？")) {
                return;
            }

            try {
                await window.API.deleteSearchResult(id);
                this.searchHistory = this.searchHistory.filter(
                    (item) => item.id !== id
                );
                this.showStatus("已刪除搜尋歷史", "success");
            } catch (error) {
                console.error("Error deleting search history:", error);
                this.showStatus("刪除失敗: " + error.message, "error");
            }
        },
        async loadSearchResult(historyItem) {
            console.log("[SearchTab] loadSearchResult called", { historyItem });
            try {
                // Fetch the full search result from the API
                const response = await fetch(`/api/search/${historyItem.id}`);
                if (!response.ok) {
                    throw new Error("無法載入搜尋結果");
                }
                const result = await response.json();
                console.log("[SearchTab] Fetched search result from API", {
                    result,
                    hasThreads: !!result.threads,
                    threadsLength: result.threads ? result.threads.length : 0,
                    keyword: result.keyword,
                });

                // Store results in app instance for persistence
                if (window.app) {
                    window.app.searchResults = result;
                    window.app.searchKeyword = result.keyword || "";
                    console.log("[SearchTab] Stored results in app instance", {
                        searchResults: window.app.searchResults,
                        searchKeyword: window.app.searchKeyword,
                    });
                }

                // Switch to results tab first, then emit event after component is mounted
                if (window.app) {
                    console.log("[SearchTab] Switching to results tab");
                    window.app.switchTab("results");
                    // Use $nextTick to ensure ResultsTab component is mounted before emitting
                    this.$nextTick(() => {
                        console.log(
                            "[SearchTab] Emitting search-completed event",
                            {
                                result,
                                keyword: result.keyword,
                            }
                        );
                        window.app.$emit(
                            "search-completed",
                            result,
                            result.keyword
                        );
                    });
                } else {
                    console.log("[SearchTab] No window.app, using $root");
                    this.$root.$emit(
                        "search-completed",
                        result,
                        result.keyword
                    );
                }

                this.showStatus("已載入搜尋結果", "success");
            } catch (error) {
                console.error(
                    "[SearchTab] Error loading search result:",
                    error
                );
                this.showStatus("載入失敗: " + error.message, "error");
            }
        },
        formatDate(dateString) {
            if (!dateString) return "";
            const date = new Date(dateString);
            return date.toLocaleString("zh-TW", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            });
        },
        viewSearchResult(queueItem) {
            console.log("[SearchTab] viewSearchResult called", {
                queueItem,
                hasResults: !!queueItem.results,
                resultsType: typeof queueItem.results,
                keyword: queueItem.keyword,
            });

            // Store results in app instance for persistence
            if (window.app) {
                window.app.searchResults = queueItem.results;
                window.app.searchKeyword = queueItem.keyword || "";
                console.log("[SearchTab] Stored results in app instance", {
                    searchResults: window.app.searchResults,
                    searchKeyword: window.app.searchKeyword,
                });
            }
            // Switch to results tab first, then emit event after component is mounted
            if (window.app) {
                console.log("[SearchTab] Switching to results tab");
                window.app.switchTab("results");
                // Use $nextTick to ensure ResultsTab component is mounted before emitting
                this.$nextTick(() => {
                    console.log("[SearchTab] Emitting search-completed event", {
                        results: queueItem.results,
                        keyword: queueItem.keyword,
                    });
                    window.app.$emit(
                        "search-completed",
                        queueItem.results,
                        queueItem.keyword
                    );
                });
            } else {
                console.log("[SearchTab] No window.app, using $root");
                this.$root.$emit(
                    "search-completed",
                    queueItem.results,
                    queueItem.keyword
                );
            }
        },
        retrySearch(queueItem) {
            // Reset status and add back to queue
            queueItem.status = "pending";
            queueItem.results = null;
            this.saveSearchStateToLocalStorage();
            if (!this.processing) {
                this.processQueue();
            }
        },
        isHistorySelected(id) {
            return this.selectedHistoryItems.includes(id);
        },
        toggleHistorySelection(id) {
            const index = this.selectedHistoryItems.indexOf(id);
            if (index > -1) {
                this.selectedHistoryItems.splice(index, 1);
            } else {
                this.selectedHistoryItems.push(id);
            }
        },
        toggleSelectAllHistory() {
            if (this.allHistorySelected) {
                this.selectedHistoryItems = [];
            } else {
                this.selectedHistoryItems = this.searchHistory.map(
                    (item) => item.id
                );
            }
        },
        async bulkDeleteHistory() {
            if (this.selectedHistoryItems.length === 0) {
                return;
            }

            if (
                !confirm(
                    `確定要刪除選取的 ${this.selectedHistoryItems.length} 個搜尋歷史嗎？`
                )
            ) {
                return;
            }

            this.deletingHistory = true;
            let successCount = 0;
            let failCount = 0;

            try {
                // Delete all selected items
                const deletePromises = this.selectedHistoryItems.map((id) =>
                    window.API.deleteSearchResult(id)
                        .then(() => {
                            successCount++;
                        })
                        .catch(() => {
                            failCount++;
                        })
                );

                await Promise.all(deletePromises);

                // Remove deleted items from the list
                this.searchHistory = this.searchHistory.filter(
                    (item) => !this.selectedHistoryItems.includes(item.id)
                );
                this.selectedHistoryItems = [];

                if (failCount === 0) {
                    this.showStatus(
                        `已成功刪除 ${successCount} 個搜尋歷史`,
                        "success"
                    );
                } else {
                    this.showStatus(
                        `已刪除 ${successCount} 個，失敗 ${failCount} 個`,
                        "error"
                    );
                }
            } catch (error) {
                console.error("Error bulk deleting search history:", error);
                this.showStatus("批量刪除失敗: " + error.message, "error");
            } finally {
                this.deletingHistory = false;
            }
        },
    },
});
