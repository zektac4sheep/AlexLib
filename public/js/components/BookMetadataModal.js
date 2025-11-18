// BookMetadataModal Component
Vue.component('book-metadata-modal', {
    template: `
        <div class="modal fade" id="bookMetadataModal" tabindex="-1" aria-labelledby="bookMetadataModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="bookMetadataModalLabel">編輯書籍資訊</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div v-if="loading" class="text-center py-4">
                            <div class="spinner-border" role="status">
                                <span class="visually-hidden">載入中...</span>
                            </div>
                        </div>
                        <div v-else-if="!book && !loading" class="text-center py-4 text-muted">
                            無法載入書籍資訊
                        </div>
                        <div v-else-if="book">
                            <form @submit.prevent="saveBook">
                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <label class="form-label">書籍名稱（簡體） <span class="text-danger">*</span></label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            v-model="editData.book_name_simplified"
                                            required
                                            :disabled="saving"
                                            placeholder="書籍名稱（簡體中文）"
                                        />
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">書籍名稱（繁體）</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            v-model="editData.book_name_traditional"
                                            :disabled="saving"
                                            placeholder="書籍名稱（繁體中文）"
                                        />
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">作者</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            v-model="authorsString"
                                            :disabled="saving"
                                            placeholder="用逗號分隔多個作者，例如：作者1, 作者2, 作者3"
                                        />
                                        <small class="form-text text-muted">用逗號分隔多個作者</small>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">分類</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            v-model="editData.category"
                                            :disabled="saving"
                                            placeholder="分類"
                                        />
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">標籤</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            v-model="tagsString"
                                            :disabled="saving"
                                            placeholder="用逗號分隔多個標籤，例如：標籤1, 標籤2, 標籤3"
                                        />
                                        <small class="form-text text-muted">用逗號分隔多個標籤</small>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">描述</label>
                                        <textarea
                                            class="form-control"
                                            v-model="editData.description"
                                            :disabled="saving"
                                            rows="4"
                                            placeholder="書籍描述"
                                        ></textarea>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">來源網址</label>
                                        <input
                                            type="url"
                                            class="form-control"
                                            v-model="editData.source_url"
                                            :disabled="saving"
                                            placeholder="https://..."
                                        />
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">評分</label>
                                        <div class="rating-stars d-flex" style="gap: 4px;">
                                            <span 
                                                v-for="star in 5" 
                                                :key="star"
                                                class="rating-star"
                                                :class="{ active: star <= (editData.rating || 0) }"
                                                @click="editData.rating = star"
                                                style="cursor: pointer;"
                                                :title="'評分: ' + star + ' 星'"
                                            >
                                                ★
                                            </span>
                                        </div>
                                        <small class="form-text text-muted">點擊星星設定評分（0-5 星）</small>
                                    </div>
                                    <div class="col-12">
                                        <div class="form-check">
                                            <input
                                                class="form-check-input"
                                                type="checkbox"
                                                id="autoSearchCheck"
                                                v-model="editData.auto_search"
                                                :disabled="saving"
                                            />
                                            <label class="form-check-label" for="autoSearchCheck">
                                                自動搜尋新章節
                                            </label>
                                        </div>
                                        <small class="form-text text-muted">啟用後，系統會定期自動搜尋此書籍的新章節或缺失章節</small>
                                    </div>
                                    <div class="col-12" v-if="book.last_updated">
                                        <label class="form-label">最後更新</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            :value="formatDate(book.last_updated)"
                                            disabled
                                        />
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" :disabled="saving">
                            取消
                        </button>
                        <button 
                            type="button" 
                            class="btn btn-primary" 
                            @click="saveBook"
                            :disabled="saving || loading"
                        >
                            <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
                            儲存
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            book: null,
            bookId: null,
            loading: false,
            saving: false,
            editData: {
                book_name_simplified: '',
                book_name_traditional: '',
                category: '',
                description: '',
                source_url: '',
                rating: 0,
                auto_search: false
            },
            tags: [],
            authors: []
        };
    },
    computed: {
        tagsString: {
            get() {
                return this.tags.join(', ');
            },
            set(value) {
                this.tags = value.split(',').map(t => t.trim()).filter(t => t);
            }
        },
        authorsString: {
            get() {
                return this.authors.join(', ');
            },
            set(value) {
                this.authors = value.split(',').map(a => a.trim()).filter(a => a);
            }
        }
    },
    mounted() {
        // Listen for open modal event
        this.$root.$on('edit-book', this.openModal);
        
        // Listen for modal close to reset state
        const modalElement = document.getElementById('bookMetadataModal');
        if (modalElement) {
            modalElement.addEventListener('hidden.bs.modal', () => {
                this.resetModal();
            });
        }
    },
    beforeDestroy() {
        this.$root.$off('edit-book', this.openModal);
    },
    methods: {
        async openModal(bookId) {
            this.bookId = bookId;
            this.loading = true;
            
            // Show modal
            const modalElement = document.getElementById('bookMetadataModal');
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
            
            try {
                // Load book data
                this.book = await window.API.getBook(bookId);
                
                if (this.book.error) {
                    alert('載入書籍資訊失敗: ' + this.book.error);
                    modal.hide();
                    return;
                }
                
                // Populate edit form
                this.editData = {
                    book_name_simplified: this.book.book_name_simplified || '',
                    book_name_traditional: this.book.book_name_traditional || '',
                    category: this.book.category || '',
                    description: this.book.description || '',
                    source_url: this.book.source_url || '',
                    rating: this.book.rating || 0,
                    auto_search: this.book.auto_search === 1 || this.book.auto_search === true
                };
                
                // Handle tags (can be array or undefined)
                this.tags = Array.isArray(this.book.tags) ? [...this.book.tags] : [];
                
                // Handle authors (can be array or undefined, fallback to legacy author field)
                if (Array.isArray(this.book.authors) && this.book.authors.length > 0) {
                    this.authors = [...this.book.authors];
                } else if (this.book.author) {
                    // Support legacy single author field
                    this.authors = [this.book.author];
                } else {
                    this.authors = [];
                }
            } catch (error) {
                console.error('Error loading book:', error);
                alert('載入書籍失敗: ' + (error.message || 'Unknown error'));
                modal.hide();
            } finally {
                this.loading = false;
            }
        },
        async saveBook() {
            if (!this.book || !this.bookId) {
                return;
            }
            
            if (!this.editData.book_name_simplified || !this.editData.book_name_simplified.trim()) {
                alert('書籍名稱（簡體）為必填欄位');
                return;
            }
            
            this.saving = true;
            try {
                // Prepare update data
                const updateData = {
                    book_name_simplified: this.editData.book_name_simplified.trim(),
                    book_name_traditional: this.editData.book_name_traditional.trim() || null,
                    category: this.editData.category.trim() || null,
                    description: this.editData.description.trim() || null,
                    source_url: this.editData.source_url.trim() || null,
                    rating: parseInt(this.editData.rating) || 0,
                    auto_search: this.editData.auto_search,
                    tags: this.tags,
                    authors: this.authors
                };
                
                // Update book
                const result = await window.API.updateBook(this.bookId, updateData);
                
                if (result.error) {
                    alert('更新失敗: ' + result.error);
                    return;
                }
                
                // Close modal
                const modalElement = document.getElementById('bookMetadataModal');
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) {
                    modal.hide();
                }
                
                // Emit event to refresh books list
                this.$root.$emit('book-updated');
                
                alert('書籍資訊已更新');
            } catch (error) {
                console.error('Error updating book:', error);
                alert('更新失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.saving = false;
            }
        },
        resetModal() {
            this.book = null;
            this.bookId = null;
            this.loading = false;
            this.saving = false;
            this.editData = {
                book_name_simplified: '',
                book_name_traditional: '',
                category: '',
                description: '',
                source_url: '',
                rating: 0,
                auto_search: false
            };
            this.tags = [];
            this.authors = [];
        },
        formatDate(dateString) {
            if (!dateString) return '';
            const date = new Date(dateString);
            return date.toLocaleString('zh-TW');
        }
    }
});

