// ChunksTab Component
Vue.component('chunks-tab', {
    name: 'ChunksTab',
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">分塊預覽</h3>

            <!-- Book Selection -->
            <div class="card mb-4">
                <div class="card-body">
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
                                        {{ book.book_name_traditional || book.book_name_simplified }} ({{ getChunkStatusName(book.chunkStatus) }})
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
                    <span class="badge bg-primary">
                        共 {{ chunkPreview.totalChunks }} 個分塊
                    </span>
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
                            <div class="mb-2">
                                <strong>分塊 {{ selectedChunkContent.chunkNumber }} / {{ selectedChunkContent.totalChunks }}</strong>
                                <span class="badge bg-secondary ms-2">
                                    行數: {{ selectedChunkContent.lineStart }} - {{ selectedChunkContent.lineEnd }}
                                </span>
                                <span v-if="selectedChunkContent.firstChapter" class="badge bg-info ms-2">
                                    章節: {{ selectedChunkContent.firstChapter }}{{ selectedChunkContent.lastChapter && selectedChunkContent.lastChapter !== selectedChunkContent.firstChapter ? ' - ' + selectedChunkContent.lastChapter : '' }}
                                </span>
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
            selectedBookId: '',
            chunkSize: 1000,
            chunkPreview: null,
            selectedChunkNumber: '',
            selectedChunkContent: null,
            loadingPreview: false,
            generating: false
        };
    },
    computed: {
        canGenerate() {
            const book = [...this.availableBooks, ...this.waitingBooks, ...this.readyBooks]
                .find(b => b.id == this.selectedBookId);
            return book && (book.chunkStatus === null || book.chunkStatus === 'ready' || book.chunkStatus === 'completed');
        }
    },
    mounted() {
        this.loadBooks();
    },
    activated() {
        // Called when component is activated (if using keep-alive)
        this.loadBooks();
    },
    methods: {
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
                'completed': '已完成'
            };
            return names[status] || status || '未知';
        }
    }
});
