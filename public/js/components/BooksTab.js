// BooksTab Component
Vue.component("books-tab", {
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">書籍管理</h3>

            <!-- Search and Filters -->
            <div class="card mb-4">
                <div class="card-body">
                    <div class="row g-3">
                        <div class="col-md-4">
                            <input
                                type="text"
                                class="form-control"
                                v-model="searchQuery"
                                placeholder="搜尋書籍名稱..."
                                @input="filterBooks"
                            />
                        </div>
                        <div class="col-md-4">
                            <input
                                type="text"
                                class="form-control"
                                v-model="authorFilter"
                                placeholder="篩選作者..."
                                @input="filterBooks"
                            />
                        </div>
                        <div class="col-md-4">
                            <button class="btn btn-primary w-100" @click="loadBooks">
                                <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
                                重新整理
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Status Message -->
            <div v-if="statusMessage" :class="['alert', statusType, 'mb-4']">
                {{ statusMessage }}
            </div>

            <!-- Books Table -->
            <div class="card">
                <div class="card-body">
                    <div v-if="loading && books.length === 0" class="text-center py-5">
                        <div class="spinner-border" role="status">
                            <span class="visually-hidden">載入中...</span>
                        </div>
                    </div>
                    <template v-else-if="!loading">
                        <div v-if="filteredBooks.length === 0 && books.length === 0" class="text-center text-muted py-5">
                            沒有找到書籍
                        </div>
                        <div v-else-if="filteredBooks.length === 0 && books.length > 0" class="text-center text-muted py-5">
                            沒有符合篩選條件的書籍
                        </div>
                        <div v-else class="table-responsive">
                        <table class="table table-hover">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>書名</th>
                                    <th>作者</th>
                                    <th>評分</th>
                                    <th>章節數</th>
                                    <th>章節範圍</th>
                                    <th>自動搜尋</th>
                                    <th>同步到 Joplin</th>
                                    <th>最後更新</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="book in filteredBooks" :key="book.id">
                                    <td>{{ book.id }}</td>
                                    <td>
                                        <strong>{{ book.book_name_traditional || book.book_name_simplified }}</strong>
                                    </td>
                                    <td>{{ book.author || '未知' }}</td>
                                    <td>
                                        <div class="rating-stars d-flex" @click.stop>
                                            <span 
                                                v-for="star in 5" 
                                                :key="star"
                                                class="rating-star"
                                                :class="{ active: star <= (book.rating || 0) }"
                                                @click="updateRating(book.id, star)"
                                                :title="'評分: ' + star + ' 星'"
                                            >
                                                ★
                                            </span>
                                        </div>
                                    </td>
                                    <td>{{ book.total_chapters || 0 }}</td>
                                    <td>
                                        <span v-if="book.min_chapter !== null && book.max_chapter !== null">
                                            {{ book.min_chapter }} - {{ book.max_chapter }}
                                        </span>
                                        <span v-else class="text-muted">-</span>
                                    </td>
                                    <td>
                                        <div class="form-check form-switch">
                                            <input 
                                                class="form-check-input" 
                                                type="checkbox" 
                                                :id="'autoSearch' + book.id"
                                                :checked="book.auto_search === 1 || book.auto_search === true"
                                                @change="updateAutoSearch(book.id, $event.target.checked)"
                                            />
                                            <label class="form-check-label" :for="'autoSearch' + book.id" style="cursor: pointer;">
                                            </label>
                                        </div>
                                    </td>
                                    <td>
                                        <div class="form-check form-switch">
                                            <input 
                                                class="form-check-input" 
                                                type="checkbox" 
                                                :id="'syncJoplin' + book.id"
                                                :checked="book.sync_to_joplin === 1 || book.sync_to_joplin === true"
                                                @change="updateSyncToJoplin(book.id, $event.target.checked)"
                                            />
                                            <label class="form-check-label" :for="'syncJoplin' + book.id" style="cursor: pointer;">
                                            </label>
                                        </div>
                                    </td>
                                    <td>{{ formatDate(book.last_updated) }}</td>
                                    <td>
                                        <div class="btn-group btn-group-sm" role="group">
                                            <button 
                                                class="btn btn-outline-primary" 
                                                @click="viewChapters(book.id)"
                                                title="查看章節"
                                            >
                                                章節
                                            </button>
                                            <button 
                                                class="btn btn-outline-secondary" 
                                                @click="editBook(book.id)"
                                                title="編輯"
                                            >
                                                編輯
                                            </button>
                                            <button 
                                                class="btn btn-outline-info" 
                                                @click="searchChapters(book.id)"
                                                title="搜尋章節"
                                            >
                                                搜尋
                                            </button>
                                            <button 
                                                class="btn btn-outline-danger" 
                                                @click="deleteBook(book.id)"
                                                title="刪除"
                                            >
                                                刪除
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        </div>
                    </template>
                </div>
            </div>

        </div>
    `,
    data() {
        return {
            books: [],
            filteredBooks: [],
            loading: false,
            searchQuery: "",
            authorFilter: "",
            statusMessage: "",
            statusType: "",
        };
    },
    mounted() {
        if (
            typeof window.API === "undefined" ||
            typeof window.API.getBooks !== "function"
        ) {
            console.error("BooksTab: API service not available!");
            alert("API 服務未載入，請重新整理頁面");
            return;
        }
        this.loadBooks();

        // Listen for book update events to refresh the list
        this.$root.$on("book-updated", this.loadBooks);
    },
    activated() {
        // Called when component is activated (if using keep-alive)
        this.loadBooks();
    },
    beforeDestroy() {
        // Clean up event listener
        this.$root.$off("book-updated", this.loadBooks);
    },
    methods: {
        async loadBooks() {
            this.loading = true;
            try {
                const books = await window.API.getBooks();
                this.books = books || [];
                this.filterBooks();
            } catch (error) {
                console.error("Error loading books:", error);
                alert("載入書籍失敗: " + (error.message || "Unknown error"));
                this.books = [];
                this.filteredBooks = [];
            } finally {
                this.loading = false;
            }
        },
        filterBooks() {
            let filtered = [...this.books];

            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase();
                filtered = filtered.filter((book) => {
                    const name = (
                        book.book_name_traditional ||
                        book.book_name_simplified ||
                        ""
                    ).toLowerCase();
                    return name.includes(query);
                });
            }

            if (this.authorFilter) {
                const author = this.authorFilter.toLowerCase();
                filtered = filtered.filter((book) => {
                    const bookAuthor = (book.author || "").toLowerCase();
                    return bookAuthor.includes(author);
                });
            }

            this.filteredBooks = filtered;
        },
        viewChapters(bookId) {
            if (window.app) {
                window.app.switchTab("chapters");
                window.app.tabData = { bookId };
                // Also emit event for components listening
                window.app.$emit("switch-tab", "chapters", { bookId });
            } else {
                this.$root.$emit("switch-tab", "chapters", { bookId });
            }
        },
        editBook(bookId) {
            // Emit event to open book metadata modal
            this.$root.$emit("edit-book", bookId);
        },
        async deleteBook(bookId) {
            if (!confirm("確定要刪除這本書籍嗎？此操作無法復原。")) {
                return;
            }

            try {
                await window.API.deleteBook(bookId);
                alert("書籍已刪除");
                this.loadBooks();
            } catch (error) {
                console.error("Error deleting book:", error);
                alert("刪除失敗: " + (error.message || "Unknown error"));
            }
        },
        formatDate(dateString) {
            if (!dateString) return "";
            const date = new Date(dateString);
            return date.toLocaleString("zh-TW");
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
        async searchChapters(bookId) {
            try {
                const options = { pages: 3 };

                // Create search job (returns immediately)
                const result = await window.API.searchBookChapters(
                    bookId,
                    options
                );

                if (result.error) {
                    this.showStatus(
                        "建立搜尋任務失敗: " + result.error,
                        "error"
                    );
                    return;
                }

                this.showStatus(
                    `搜尋章節任務已加入佇列 (任務 ID: ${result.jobId})。請前往「作業佇列」標籤頁查看進度。`,
                    "success"
                );
            } catch (error) {
                console.error("Error creating search job:", error);
                this.showStatus(
                    "建立搜尋任務時發生錯誤: " +
                        (error.message || "Unknown error"),
                    "error"
                );
            }
        },
        async updateRating(bookId, rating) {
            try {
                const result = await window.API.updateBook(bookId, { rating });
                if (result.error) {
                    this.showStatus("更新評分失敗: " + result.error, "error");
                    return;
                }
                // Update local book data
                const book = this.books.find((b) => b.id === bookId);
                if (book) {
                    book.rating = rating;
                }
                this.filterBooks();
            } catch (error) {
                console.error("Error updating rating:", error);
                this.showStatus(
                    "更新評分時發生錯誤: " + (error.message || "Unknown error"),
                    "error"
                );
            }
        },
        async updateAutoSearch(bookId, enabled) {
            try {
                const result = await window.API.updateBook(bookId, {
                    auto_search: enabled,
                });
                if (result.error) {
                    this.showStatus(
                        "更新自動搜尋設定失敗: " + result.error,
                        "error"
                    );
                    // Revert checkbox state
                    const book = this.books.find((b) => b.id === bookId);
                    if (book) {
                        book.auto_search = !enabled ? 1 : 0;
                    }
                    this.filterBooks();
                    return;
                }
                // Update local book data
                const book = this.books.find((b) => b.id === bookId);
                if (book) {
                    book.auto_search = enabled ? 1 : 0;
                }
                this.filterBooks();
            } catch (error) {
                console.error("Error updating auto_search:", error);
                this.showStatus(
                    "更新自動搜尋設定時發生錯誤: " +
                        (error.message || "Unknown error"),
                    "error"
                );
                // Revert checkbox state
                const book = this.books.find((b) => b.id === bookId);
                if (book) {
                    book.auto_search = !enabled ? 1 : 0;
                }
                this.filterBooks();
            }
        },
        async updateSyncToJoplin(bookId, enabled) {
            try {
                const result = await window.API.updateBook(bookId, {
                    sync_to_joplin: enabled,
                });
                if (result.error) {
                    this.showStatus(
                        "更新 Joplin 同步設定失敗: " + result.error,
                        "error"
                    );
                    // Revert checkbox state
                    const book = this.books.find((b) => b.id === bookId);
                    if (book) {
                        book.sync_to_joplin = !enabled ? 1 : 0;
                    }
                    this.filterBooks();
                    return;
                }
                // Update local book data
                const book = this.books.find((b) => b.id === bookId);
                if (book) {
                    book.sync_to_joplin = enabled ? 1 : 0;
                }
                this.filterBooks();
                
                if (enabled) {
                    this.showStatus(
                        "已啟用 Joplin 同步。當生成分塊時，此書籍將自動同步到 Joplin。",
                        "success"
                    );
                } else {
                    this.showStatus(
                        "已停用 Joplin 同步",
                        "success"
                    );
                }
            } catch (error) {
                console.error("Error updating sync_to_joplin:", error);
                this.showStatus(
                    "更新 Joplin 同步設定時發生錯誤: " +
                        (error.message || "Unknown error"),
                    "error"
                );
                // Revert checkbox state
                const book = this.books.find((b) => b.id === bookId);
                if (book) {
                    book.sync_to_joplin = !enabled ? 1 : 0;
                }
                this.filterBooks();
            }
        },
    },
});
