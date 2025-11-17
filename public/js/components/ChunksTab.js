// ChunksTab Component
Vue.component('chunks-tab', {
    name: 'ChunksTab',
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">分塊預覽</h3>

            <!-- Books Needing Chunks -->
            <div class="card mb-4">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">需要建立分塊的書籍</h5>
                    <button 
                        class="btn btn-sm btn-outline-primary" 
                        @click="loadBooksNeedingChunks"
                        :disabled="loadingNeedingChunks"
                    >
                        <span v-if="loadingNeedingChunks" class="spinner-border spinner-border-sm me-1"></span>
                        <span v-else>🔄</span>
                        重新整理
                    </button>
                </div>
                <div class="card-body">
                    <div v-if="loadingNeedingChunks && booksNeedingChunks.length === 0" class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">載入中...</span>
                        </div>
                    </div>
                    <div v-else-if="booksNeedingChunks.length === 0" class="text-center text-muted py-3">
                        目前沒有需要建立分塊的書籍
                    </div>
                    <div v-else class="table-responsive">
                        <table class="table table-sm table-hover mb-0">
                            <thead>
                                <tr>
                                    <th>書名</th>
                                    <th>作者</th>
                                    <th>章節數</th>
                                    <th>狀態</th>
                                    <th>原因</th>
                                    <th>進度</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="book in booksNeedingChunks" :key="book.id">
                                    <td>
                                        <strong>{{ book.book_name_traditional || book.book_name_simplified }}</strong>
                                        <span v-if="book.rebuild_chunks" class="badge bg-warning text-dark ms-2">需重建</span>
                                    </td>
                                    <td>{{ book.author || '未知' }}</td>
                                    <td>{{ book.total_chapters || 0 }}</td>
                                    <td>
                                        <span :class="getStatusBadgeClass(book.chunkStatus)">
                                            {{ getChunkStatusName(book.chunkStatus) }}
                                        </span>
                                    </td>
                                    <td>
                                        <span class="badge bg-secondary">{{ getReasonText(book.reason) }}</span>
                                    </td>
                                    <td>
                                        <div v-if="book.chunkJobProgress && book.chunkJobProgress.total_items > 0" class="d-flex align-items-center gap-2">
                                            <div class="progress flex-grow-1" style="height: 20px;">
                                                <div 
                                                    class="progress-bar progress-bar-striped progress-bar-animated" 
                                                    role="progressbar" 
                                                    :style="{ width: Math.round((book.chunkJobProgress.completed_items || 0) / book.chunkJobProgress.total_items * 100) + '%' }"
                                                >
                                                </div>
                                            </div>
                                            <small class="text-nowrap">
                                                {{ book.chunkJobProgress.completed_items || 0 }}/{{ book.chunkJobProgress.total_items || 0 }}
                                            </small>
                                        </div>
                                        <span v-else-if="book.totalChunks > 0" class="text-muted">
                                            已有 {{ book.totalChunks }} 個分塊
                                        </span>
                                        <span v-else class="text-muted">-</span>
                                    </td>
                                    <td>
                                        <button 
                                            class="btn btn-sm btn-primary"
                                            @click="generateChunksForBook(book.id)"
                                            :disabled="book.chunkStatus === 'queued' || book.chunkStatus === 'processing'"
                                        >
                                            <span v-if="book.chunkStatus === 'queued' || book.chunkStatus === 'processing'">
                                                <span class="spinner-border spinner-border-sm me-1"></span>
                                                處理中
                                            </span>
                                            <span v-else>生成分塊</span>
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Book Selection -->
            <div class="card mb-4">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">分塊管理</h5>
                    <button 
                        class="btn btn-warning btn-sm" 
                        @click="rebuildAllChunks"
                        :disabled="rebuildingAll"
                    >
                        <span v-if="rebuildingAll" class="spinner-border spinner-border-sm me-2"></span>
                        重建所有分塊
                    </button>
                </div>
                <div class="card-body">
                    <!-- Progress indicator for processing books -->
                    <div v-if="processingBookProgress" class="alert alert-info mb-3">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <strong>正在處理: {{ processingBookProgress.bookName }}</strong>
                            <span class="badge bg-primary">
                                {{ processingBookProgress.completed }}/{{ processingBookProgress.total }} 
                                ({{ processingBookProgress.percentage }}%)
                            </span>
                        </div>
                        <div class="progress" style="height: 25px;">
                            <div 
                                class="progress-bar progress-bar-striped progress-bar-animated" 
                                role="progressbar" 
                                :style="{ width: processingBookProgress.percentage + '%' }"
                                :aria-valuenow="processingBookProgress.completed"
                                :aria-valuemin="0"
                                :aria-valuemax="processingBookProgress.total"
                            >
                                {{ processingBookProgress.completed }}/{{ processingBookProgress.total }}
                            </div>
                        </div>
                    </div>
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label class="form-label">選擇書籍</label>
                            <select 
                                class="form-select" 
                                v-model="selectedBookId"
                                @change="loadChunkInfo"
                            >
                                <option value="">-- 選擇書籍 --</option>
                                <optgroup :label="'可用 (' + availableBooks.length + ')'">
                                    <option 
                                        v-for="book in availableBooks" 
                                        :key="book.id" 
                                        :value="book.id"
                                    >
                                        {{ book.book_name_traditional || book.book_name_simplified }}
                                    </option>
                                </optgroup>
                                <optgroup :label="'處理中 (' + waitingBooks.length + ')'">
                                    <option 
                                        v-for="book in waitingBooks" 
                                        :key="book.id" 
                                        :value="book.id"
                                        disabled
                                    >
                                        {{ book.book_name_traditional || book.book_name_simplified }} 
                                        ({{ getChunkStatusName(book.chunkStatus) }})
                                        <span v-if="book.chunkJobProgress && book.chunkJobProgress.total_items > 0">
                                            - {{ book.chunkJobProgress.completed_items || 0 }}/{{ book.chunkJobProgress.total_items || 0 }} 
                                            ({{ Math.round((book.chunkJobProgress.completed_items || 0) / book.chunkJobProgress.total_items * 100) }}%)
                                        </span>
                                    </option>
                                </optgroup>
                                <optgroup :label="'已完成 (' + readyBooks.length + ')'">
                                    <option 
                                        v-for="book in readyBooks" 
                                        :key="book.id" 
                                        :value="book.id"
                                    >
                                        {{ book.book_name_traditional || book.book_name_simplified }}
                                    </option>
                                </optgroup>
                            </select>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label">分塊大小</label>
                            <input 
                                type="number" 
                                class="form-control" 
                                v-model.number="chunkSize"
                                min="100"
                                step="100"
                                placeholder="1000"
                            />
                        </div>
                        <div class="col-md-3 d-flex align-items-end">
                            <button 
                                class="btn btn-primary w-100" 
                                @click="generateChunks"
                                :disabled="!selectedBookId || generating || !canGenerate"
                            >
                                <span v-if="generating" class="spinner-border spinner-border-sm me-2"></span>
                                生成分塊
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Chunk Preview -->
            <div class="card" v-if="selectedBookId && chunkPreview">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">分塊預覽</h5>
                    <div class="d-flex align-items-center gap-2">
                        <button 
                            class="btn btn-sm btn-warning"
                            @click="reformatBookChunks"
                            :disabled="reformattingBook"
                            title="重新格式化此書籍的所有分塊"
                        >
                            <span v-if="reformattingBook" class="spinner-border spinner-border-sm me-1"></span>
                            🔄 重新格式化所有分塊
                        </button>
                        <span class="badge bg-primary">
                            共 {{ chunkPreview.totalChunks }} 個分塊
                        </span>
                    </div>
                </div>
                <div class="card-body">
                    <div v-if="loadingPreview" class="text-center py-5">
                        <div class="spinner-border" role="status">
                            <span class="visually-hidden">載入中...</span>
                        </div>
                    </div>
                    <div v-else-if="chunkPreview.chunks && chunkPreview.chunks.length > 0">
                        <div class="mb-3">
                            <label class="form-label">選擇分塊</label>
                            <select 
                                class="form-select" 
                                v-model="selectedChunkNumber"
                                @change="loadChunkContent"
                            >
                                <option value="">-- 選擇分塊 --</option>
                                <option 
                                    v-for="chunk in chunkPreview.chunks" 
                                    :key="chunk.chunkNumber"
                                    :value="chunk.chunkNumber"
                                >
                                    分塊 {{ chunk.chunkNumber }} / {{ chunkPreview.totalChunks }}
                                    (章節 {{ chunk.firstChapter || '-' }}{{ chunk.lastChapter && chunk.lastChapter !== chunk.firstChapter ? ' - ' + chunk.lastChapter : '' }})
                                </option>
                            </select>
                        </div>
                        <div v-if="selectedChunkContent" class="border rounded p-3 bg-light">
                            <div class="mb-2 d-flex justify-content-between align-items-center">
                                <div>
                                    <strong>分塊 {{ selectedChunkContent.chunkNumber }} / {{ selectedChunkContent.totalChunks }}</strong>
                                    <span class="badge bg-secondary ms-2">
                                        行數: {{ selectedChunkContent.lineStart }} - {{ selectedChunkContent.lineEnd }}
                                    </span>
                                    <span v-if="selectedChunkContent.firstChapter" class="badge bg-info ms-2">
                                        章節: {{ selectedChunkContent.firstChapter }}{{ selectedChunkContent.lastChapter && selectedChunkContent.lastChapter !== selectedChunkContent.firstChapter ? ' - ' + selectedChunkContent.lastChapter : '' }}
                                    </span>
                                </div>
                                <button 
                                    class="btn btn-sm btn-warning"
                                    @click="reformatChunk"
                                    :disabled="reformattingChunk"
                                    title="重新格式化此分塊"
                                >
                                    <span v-if="reformattingChunk" class="spinner-border spinner-border-sm me-1"></span>
                                    🔄 重新格式化
                                </button>
                            </div>
                            <div class="chunk-content" style="max-height: 500px; overflow-y: auto; white-space: pre-wrap; font-family: monospace; background: #f8f9fa; padding: 15px; border-radius: 4px;">
                                {{ selectedChunkContent.content }}
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-center text-muted py-5">
                        此書籍尚未生成分塊
                    </div>
                </div>
            </div>

            <div v-else-if="selectedBookId && !chunkPreview" class="alert alert-info">
                此書籍尚未生成分塊，請先點擊「生成分塊」按鈕
            </div>

            <div v-else class="alert alert-info">
                請先選擇書籍
            </div>
        </div>
    `,
    data() {
        return {
            availableBooks: [],
            waitingBooks: [],
            readyBooks: [],
            booksNeedingChunks: [],
            loadingNeedingChunks: false,
            selectedBookId: '',
            chunkSize: 1000,
            chunkPreview: null,
            selectedChunkNumber: '',
            selectedChunkContent: null,
            loadingPreview: false,
            generating: false,
            rebuildingAll: false,
            reformattingChunk: false,
            reformattingBook: false,
            progressInterval: null,
            needingChunksInterval: null,
        };
    },
    computed: {
        canGenerate() {
            const book = [...this.availableBooks, ...this.waitingBooks, ...this.readyBooks]
                .find(b => b.id == this.selectedBookId);
            return book && (book.chunkStatus === null || book.chunkStatus === 'ready' || book.chunkStatus === 'completed');
        },
        processingBookProgress() {
            // Find any book that's currently processing
            const processingBook = this.waitingBooks.find(
                book => book.chunkJobProgress && 
                book.chunkJobProgress.total_items > 0 &&
                (book.chunkStatus === 'processing' || book.chunkStatus === 'queued')
            );
            
            if (!processingBook || !processingBook.chunkJobProgress) {
                return null;
            }
            
            const completed = processingBook.chunkJobProgress.completed_items || 0;
            const total = processingBook.chunkJobProgress.total_items || 0;
            const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
            
            return {
                bookName: processingBook.book_name_traditional || processingBook.book_name_simplified,
                completed: completed,
                total: total,
                percentage: percentage,
                status: processingBook.chunkStatus
            };
        }
    },
    mounted() {
        this.loadBooks();
        this.loadBooksNeedingChunks();
        // Poll for progress updates every 1 second if there are processing jobs
        this.progressInterval = setInterval(() => {
            if (this.waitingBooks.length > 0) {
                this.loadBooks();
            }
        }, 1000);
        // Poll for books needing chunks updates every 2 seconds if there are any
        this.needingChunksInterval = setInterval(() => {
            if (this.booksNeedingChunks.length > 0) {
                this.loadBooksNeedingChunks();
            }
        }, 2000);
    },
    beforeDestroy() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }
        if (this.needingChunksInterval) {
            clearInterval(this.needingChunksInterval);
        }
    },
    activated() {
        // Called when component is activated (if using keep-alive)
        this.loadBooks();
        this.loadBooksNeedingChunks();
    },
    methods: {
        async loadBooksNeedingChunks() {
            this.loadingNeedingChunks = true;
            try {
                const result = await window.API.getBooksNeedingChunks();
                this.booksNeedingChunks = result.books || [];
            } catch (error) {
                console.error('Error loading books needing chunks:', error);
            } finally {
                this.loadingNeedingChunks = false;
            }
        },
        async loadBooks() {
            try {
                const result = await window.API.getChunkBooks();
                this.availableBooks = result.available || [];
                this.waitingBooks = result.waiting || [];
                this.readyBooks = result.ready || [];
            } catch (error) {
                console.error('Error loading books:', error);
            }
        },
        async loadChunkInfo() {
            if (!this.selectedBookId) {
                this.chunkPreview = null;
                this.selectedChunkContent = null;
                return;
            }
            
            this.loadingPreview = true;
            try {
                const response = await window.API.getChunkPreview(this.selectedBookId);
                console.log('Chunk preview response:', response);
                
                if (response.error) {
                    throw new Error(response.error);
                }
                
                this.chunkPreview = response;
                if (this.chunkPreview && this.chunkPreview.chunks && this.chunkPreview.chunks.length > 0) {
                    // Auto-select first chunk
                    this.selectedChunkNumber = this.chunkPreview.chunks[0].chunkNumber;
                    this.loadChunkContent();
                }
            } catch (error) {
                console.error('Error loading chunk preview:', error);
                alert('載入分塊預覽失敗: ' + (error.message || 'Unknown error'));
                this.chunkPreview = null;
            } finally {
                this.loadingPreview = false;
            }
        },
        async loadChunkContent() {
            if (!this.selectedBookId || !this.selectedChunkNumber) {
                this.selectedChunkContent = null;
                return;
            }
            
            try {
                const response = await window.API.getChunkContent(
                    this.selectedBookId,
                    this.selectedChunkNumber
                );
                console.log('Chunk content response:', response);
                
                if (response.error) {
                    throw new Error(response.error);
                }
                
                this.selectedChunkContent = response;
            } catch (error) {
                console.error('Error loading chunk content:', error);
                alert('載入分塊內容失敗: ' + (error.message || 'Unknown error'));
                this.selectedChunkContent = null;
            }
        },
        async generateChunks() {
            if (!this.selectedBookId) {
                alert('請選擇書籍');
                return;
            }
            
            this.generating = true;
            try {
                const result = await window.API.generateChunks(this.selectedBookId, this.chunkSize);
                alert('分塊生成作業已開始 (Job ID: ' + result.jobId + ')');
                this.loadBooks();
                this.loadBooksNeedingChunks();
                // Reload chunk info after a delay
                setTimeout(() => {
                    this.loadChunkInfo();
                }, 2000);
            } catch (error) {
                console.error('Error generating chunks:', error);
                alert('生成分塊失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.generating = false;
            }
        },
        getChunkStatusName(status) {
            const names = {
                'queued': '排隊中',
                'processing': '處理中',
                'ready': '已完成',
                'completed': '已完成',
                'failed': '失敗'
            };
            return names[status] || status || '尚未建立';
        },
        getStatusBadgeClass(status) {
            const classes = {
                'queued': 'badge bg-info',
                'processing': 'badge bg-primary',
                'ready': 'badge bg-success',
                'completed': 'badge bg-success',
                'failed': 'badge bg-danger'
            };
            return classes[status] || 'badge bg-secondary';
        },
        getReasonText(reason) {
            const reasons = {
                'marked_for_rebuild': '標記需重建',
                'no_chunk_job': '尚未建立分塊',
                'chunk_job_failed': '分塊建立失敗',
                'chunks_incomplete': '分塊不完整',
                'unknown': '未知'
            };
            return reasons[reason] || reason || '未知';
        },
        async generateChunksForBook(bookId) {
            if (!bookId) {
                alert('請選擇書籍');
                return;
            }
            
            try {
                const result = await window.API.generateChunks(bookId, this.chunkSize);
                alert('分塊生成作業已開始 (Job ID: ' + result.jobId + ')');
                // Reload both lists
                this.loadBooks();
                this.loadBooksNeedingChunks();
            } catch (error) {
                console.error('Error generating chunks:', error);
                alert('生成分塊失敗: ' + (error.message || 'Unknown error'));
            }
        },
        async rebuildAllChunks() {
            if (!confirm('確定要重建所有書籍的分塊嗎？此操作將重新生成所有已存在的分塊。')) {
                return;
            }

            this.rebuildingAll = true;
            try {
                const result = await window.API.rebuildAllChunks(this.chunkSize);
                let message = `已開始重建 ${result.rebuilt || 0} 本書籍的分塊。`;
                if (result.errors && result.errors.length > 0) {
                    message += `\n\n警告: ${result.errors.length} 本書籍重建時發生錯誤。`;
                }
                alert(message);
                // Reload books list
                this.loadBooks();
                this.loadBooksNeedingChunks();
            } catch (error) {
                console.error('Error rebuilding all chunks:', error);
                alert('重建所有分塊失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.rebuildingAll = false;
            }
        },
        async reformatChunk() {
            if (!this.selectedBookId || !this.selectedChunkNumber) {
                alert('請先選擇書籍和分塊');
                return;
            }

            this.reformattingChunk = true;
            try {
                const result = await window.API.reformatChunk(this.selectedBookId, this.selectedChunkNumber);
                alert('分塊重新格式化作業已開始 (Job ID: ' + result.jobId + ')\n\n請稍後重新載入分塊內容以查看結果。');
                // Reload chunk content after a delay
                setTimeout(() => {
                    this.loadChunkContent();
                }, 2000);
            } catch (error) {
                console.error('Error reformatting chunk:', error);
                alert('重新格式化分塊失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.reformattingChunk = false;
            }
        },
        async reformatBookChunks() {
            if (!this.selectedBookId) {
                alert('請先選擇書籍');
                return;
            }

            if (!confirm('確定要重新格式化此書籍的所有分塊嗎？此操作將在背景執行。')) {
                return;
            }

            this.reformattingBook = true;
            try {
                const result = await window.API.reformatBookChunks(this.selectedBookId, this.chunkSize);
                alert('書籍分塊重新格式化作業已開始 (Job ID: ' + result.jobId + ')\n\n請稍後重新載入分塊預覽以查看結果。');
                // Reload chunk info after a delay
                setTimeout(() => {
                    this.loadChunkInfo();
                }, 2000);
            } catch (error) {
                console.error('Error reformatting book chunks:', error);
                alert('重新格式化書籍分塊失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.reformattingBook = false;
            }
        }
    }
});
