// ChaptersTab Component
Vue.component('chapters-tab', {
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">章節管理</h3>

            <!-- Book Selection -->
            <div class="card mb-4">
                <div class="card-body">
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label class="form-label">選擇書籍</label>
                            <select 
                                class="form-select" 
                                v-model="selectedBookId"
                                @change="loadChapters"
                            >
                                <option value="">-- 選擇書籍 --</option>
                                <option 
                                    v-for="book in books" 
                                    :key="book.id" 
                                    :value="book.id"
                                >
                                    {{ book.book_name_traditional || book.book_name_simplified }}
                                </option>
                            </select>
                        </div>
                        <div class="col-md-6 d-flex align-items-end">
                            <button 
                                class="btn btn-primary" 
                                @click="loadChapters"
                                :disabled="!selectedBookId || loading"
                            >
                                <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
                                重新整理
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Chapters List -->
            <div class="card" v-if="selectedBookId">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">章節列表</h5>
                    <div class="d-flex align-items-center gap-2">
                        <span v-if="chapters.length > 0" class="badge bg-primary">
                            共 {{ chapters.length }} 章
                        </span>
                        <button 
                            class="btn btn-sm btn-warning"
                            @click="reformatAllChapters"
                            :disabled="!selectedBookId || chapters.length === 0 || reformatting"
                            title="重新格式化所有章節"
                        >
                            <span v-if="reformatting" class="spinner-border spinner-border-sm me-2"></span>
                            🔄 重新格式化
                        </button>
                        <button 
                            class="btn btn-sm btn-success"
                            @click="showAddChapterModal = true"
                            title="新增章節（連結或檔案）"
                        >
                            ➕ 新增章節
                        </button>
                    </div>
                </div>
                <div class="card-body">
                    <div v-if="loading && chapters.length === 0" class="text-center py-5">
                        <div class="spinner-border" role="status">
                            <span class="visually-hidden">載入中...</span>
                        </div>
                    </div>
                    <div v-else-if="chapters.length === 0" class="text-center text-muted py-5">
                        此書籍尚無章節
                    </div>
                    <div v-else class="table-responsive">
                        <table class="table table-hover table-sm">
                            <thead>
                                <tr>
                                    <th>章節號</th>
                                    <th>標題</th>
                                    <th>狀態</th>
                                    <th>行數</th>
                                    <th>下載時間</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="chapter in sortedChapters" :key="chapter.id">
                                    <td>
                                        <span v-if="editingChapterId === chapter.id && editingField === 'number'">
                                            <input
                                                type="number"
                                                class="form-control form-control-sm d-inline-block"
                                                style="width: 80px;"
                                                v-model.number="editChapterNumber"
                                                @blur="saveChapterNumber(chapter.id)"
                                                @keyup.enter="saveChapterNumber(chapter.id)"
                                                @keyup.esc="cancelEdit"
                                            />
                                        </span>
                                        <span v-else @dblclick="startEditNumber(chapter)" style="cursor: pointer;" title="雙擊編輯">
                                            {{ chapter.chapter_number || '-' }}
                                        </span>
                                    </td>
                                    <td>
                                        <span v-if="editingChapterId === chapter.id && editingField === 'name'">
                                            <input
                                                type="text"
                                                class="form-control form-control-sm d-inline-block"
                                                style="width: 200px;"
                                                v-model="editChapterName"
                                                @blur="saveChapterName(chapter.id)"
                                                @keyup.enter="saveChapterName(chapter.id)"
                                                @keyup.esc="cancelEdit"
                                            />
                                        </span>
                                        <strong v-else @dblclick="startEditName(chapter)" style="cursor: pointer;" title="雙擊編輯">
                                            {{ chapter.chapter_title || chapter.chapter_title_simplified || chapter.chapter_name || '無標題' }}
                                        </strong>
                                    </td>
                                    <td>
                                        <span :class="['badge', getStatusBadgeClass(chapter.status)]">
                                            {{ getStatusName(chapter.status) }}
                                        </span>
                                    </td>
                                    <td>
                                        <span v-if="chapter.line_start !== null && chapter.line_end !== null">
                                            {{ chapter.line_start }} - {{ chapter.line_end }}
                                        </span>
                                        <span v-else class="text-muted">-</span>
                                    </td>
                                    <td>{{ formatDate(chapter.downloaded_at) }}</td>
                                    <td>
                                        <div class="btn-group btn-group-sm">
                                            <button 
                                                class="btn btn-outline-primary" 
                                                @click="viewChapter(chapter.id)"
                                                title="查看/編輯"
                                            >
                                                查看
                                            </button>
                                            <button 
                                                class="btn btn-outline-secondary" 
                                                @click="editChapter(chapter.id)"
                                                title="編輯"
                                            >
                                                編輯
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div v-else class="alert alert-info">
                請先選擇書籍以查看章節
            </div>

            <!-- Add Chapter Modal -->
            <div 
                v-if="showAddChapterModal"
                class="modal fade show"
                style="display: block; background: rgba(0,0,0,0.5); z-index: 1055;"
                @click.self="closeAddChapterModal"
            >
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">新增章節</h5>
                            <button type="button" class="btn-close" @click="closeAddChapterModal"></button>
                        </div>
                        <div class="modal-body">
                            <ul class="nav nav-tabs mb-3">
                                <li class="nav-item">
                                    <button 
                                        class="nav-link"
                                        :class="{ active: addChapterMode === 'url' }"
                                        @click="addChapterMode = 'url'"
                                    >
                                        從連結新增
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button 
                                        class="nav-link"
                                        :class="{ active: addChapterMode === 'file' }"
                                        @click="addChapterMode = 'file'"
                                    >
                                        從檔案新增
                                    </button>
                                </li>
                            </ul>

                            <!-- URL Mode -->
                            <div v-if="addChapterMode === 'url'">
                                <div class="mb-3">
                                    <label class="form-label">章節連結（每行一個）</label>
                                    <textarea
                                        class="form-control"
                                        v-model="chapterUrls"
                                        rows="5"
                                        placeholder="請輸入章節連結，每行一個&#10;例如：&#10;https://www.cool18.com/bbs4/index.php?app=forum&amp;act=view&amp;tid=123456&#10;https://www.cool18.com/bbs4/index.php?app=forum&amp;act=view&amp;tid=123457"
                                    ></textarea>
                                    <small class="form-text text-muted">
                                        支援 Cool18 論壇連結，可以一次輸入多個連結（每行一個）
                                    </small>
                                </div>
                                <div class="alert alert-info">
                                    <strong>提示：</strong>系統會自動下載連結內容並新增為章節。如果章節編號已存在，將會覆蓋現有章節。
                                </div>
                            </div>

                            <!-- File Mode -->
                            <div v-if="addChapterMode === 'file'">
                                <div class="mb-3">
                                    <label class="form-label">選擇檔案</label>
                                    <input
                                        type="file"
                                        class="form-control"
                                        ref="chapterFileInput"
                                        @change="onFileSelected"
                                        accept=".txt,.md,.html"
                                    />
                                    <small class="form-text text-muted">
                                        支援的檔案格式：.txt, .md, .html
                                    </small>
                                </div>
                                <div v-if="selectedFileName" class="alert alert-info">
                                    已選擇檔案：<strong>{{ selectedFileName }}</strong>
                                </div>
                                <div class="alert alert-info">
                                    <strong>提示：</strong>系統會自動分析檔案內容，提取章節並新增到書籍中。
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" @click="closeAddChapterModal">
                                取消
                            </button>
                            <button 
                                type="button" 
                                class="btn btn-primary"
                                @click="addChapters"
                                :disabled="addingChapters || (addChapterMode === 'url' && !chapterUrls.trim()) || (addChapterMode === 'file' && !selectedFile)"
                            >
                                <span v-if="addingChapters" class="spinner-border spinner-border-sm me-2"></span>
                                確認新增
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            books: [],
            selectedBookId: '',
            chapters: [],
            loading: false,
            editingChapterId: null,
            editingField: null,
            editChapterNumber: null,
            editChapterName: '',
            showAddChapterModal: false,
            addChapterMode: 'url', // 'url' or 'file'
            chapterUrls: '',
            selectedFile: null,
            selectedFileName: '',
            addingChapters: false,
            reformatting: false
        };
    },
    computed: {
        sortedChapters() {
            return [...this.chapters].sort((a, b) => {
                const numA = a.chapter_number || 0;
                const numB = b.chapter_number || 0;
                return numA - numB;
            });
        }
    },
    watch: {
        // Watch for tab activation
        '$root.activeTab'(newTab) {
            if (newTab === 'chapters' && window.app && window.app.tabData && window.app.tabData.bookId) {
                this.selectedBookId = window.app.tabData.bookId;
                this.loadChapters();
                window.app.tabData = null;
            }
        }
    },
    mounted() {
        if (typeof window.API === 'undefined' || typeof window.API.getBooks !== 'function') {
            console.error('ChaptersTab: API service not available!');
            return;
        }
        this.loadBooks();
        // Listen for book selection from BooksTab
        const eventHandler = (tab, data) => {
            if (tab === 'chapters' && data && data.bookId) {
                this.selectedBookId = data.bookId;
                this.loadChapters();
            }
        };
        
        // Check if we have tabData from app
        if (window.app && window.app.tabData && window.app.tabData.bookId) {
            this.selectedBookId = window.app.tabData.bookId;
            this.loadChapters();
            window.app.tabData = null; // Clear after use
        }
        
        if (window.app) {
            window.app.$on('switch-tab', eventHandler);
        } else {
            this.$root.$on('switch-tab', eventHandler);
        }
        
        // Listen for chapter update events to refresh list
        this.$root.$on('chapter-updated', (bookId) => {
            if (bookId === this.selectedBookId) {
                this.loadChapters();
            }
        });
    },
    activated() {
        // Called when component is activated (if using keep-alive)
        this.loadBooks();
    },
    methods: {
        async loadBooks() {
            try {
                const books = await window.API.getBooks();
                this.books = books || [];
            } catch (error) {
                console.error('Error loading books:', error);
                this.books = [];
            }
        },
        async loadChapters() {
            if (!this.selectedBookId) {
                this.chapters = [];
                return;
            }
            
            this.loading = true;
            try {
                this.chapters = await window.API.getBookChapters(this.selectedBookId);
            } catch (error) {
                console.error('Error loading chapters:', error);
                alert('載入章節失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.loading = false;
            }
        },
        viewChapter(chapterId) {
            // Open modal to view chapter content
            if (!this.selectedBookId) {
                alert('請先選擇書籍');
                return;
            }
            // Emit event to open chapter view modal
            this.$root.$emit('view-chapter', this.selectedBookId, chapterId);
        },
        editChapter(chapterId) {
            if (!this.selectedBookId) {
                alert('請先選擇書籍');
                return;
            }
            // Emit event to open chapter edit modal
            this.$root.$emit('edit-chapter', this.selectedBookId, chapterId);
        },
        startEditNumber(chapter) {
            this.editingChapterId = chapter.id;
            this.editingField = 'number';
            this.editChapterNumber = chapter.chapter_number;
        },
        startEditName(chapter) {
            this.editingChapterId = chapter.id;
            this.editingField = 'name';
            this.editChapterName = chapter.chapter_name || chapter.chapter_title || chapter.chapter_title_simplified || '';
        },
        async saveChapterNumber(chapterId) {
            if (this.editChapterNumber === null || this.editChapterNumber === undefined) {
                this.cancelEdit();
                return;
            }
            
            const chapter = this.chapters.find(ch => ch.id === chapterId);
            if (!chapter || chapter.chapter_number === this.editChapterNumber) {
                this.cancelEdit();
                return;
            }
            
            try {
                await window.API.updateChapter(this.selectedBookId, chapterId, {
                    chapter_number: this.editChapterNumber
                });
                
                // Update local data
                chapter.chapter_number = this.editChapterNumber;
                this.cancelEdit();
                
                // Refresh chapters list
                this.loadChapters();
            } catch (error) {
                console.error('Error updating chapter number:', error);
                alert('更新失敗: ' + (error.message || 'Unknown error'));
                this.cancelEdit();
            }
        },
        async saveChapterName(chapterId) {
            const chapter = this.chapters.find(ch => ch.id === chapterId);
            if (!chapter) {
                this.cancelEdit();
                return;
            }
            
            const currentName = chapter.chapter_name || chapter.chapter_title || chapter.chapter_title_simplified || '';
            if (this.editChapterName === currentName) {
                this.cancelEdit();
                return;
            }
            
            try {
                // Update chapter_name field
                await window.API.updateChapter(this.selectedBookId, chapterId, {
                    chapter_name: this.editChapterName || null
                });
                
                // Update local data
                chapter.chapter_name = this.editChapterName || null;
                this.cancelEdit();
                
                // Refresh chapters list
                this.loadChapters();
            } catch (error) {
                console.error('Error updating chapter name:', error);
                alert('更新失敗: ' + (error.message || 'Unknown error'));
                this.cancelEdit();
            }
        },
        cancelEdit() {
            this.editingChapterId = null;
            this.editingField = null;
            this.editChapterNumber = null;
            this.editChapterName = '';
        },
        getStatusName(status) {
            const names = {
                'pending': '等待中',
                'downloading': '下載中',
                'completed': '已完成',
                'failed': '失敗'
            };
            return names[status] || status || '未知';
        },
        getStatusBadgeClass(status) {
            const classes = {
                'pending': 'bg-secondary',
                'downloading': 'bg-primary',
                'completed': 'bg-success',
                'failed': 'bg-danger'
            };
            return classes[status] || 'bg-secondary';
        },
        formatDate(dateString) {
            if (!dateString) return '';
            const date = new Date(dateString);
            return date.toLocaleString('zh-TW');
        },
        closeAddChapterModal() {
            this.showAddChapterModal = false;
            this.addChapterMode = 'url';
            this.chapterUrls = '';
            this.selectedFile = null;
            this.selectedFileName = '';
            if (this.$refs.chapterFileInput) {
                this.$refs.chapterFileInput.value = '';
            }
        },
        onFileSelected(event) {
            const file = event.target.files[0];
            if (file) {
                this.selectedFile = file;
                this.selectedFileName = file.name;
            } else {
                this.selectedFile = null;
                this.selectedFileName = '';
            }
        },
        async addChapters() {
            if (!this.selectedBookId) {
                alert('請先選擇書籍');
                return;
            }

            this.addingChapters = true;
            try {
                if (this.addChapterMode === 'url') {
                    // Add by URL
                    const urls = this.chapterUrls
                        .split('\n')
                        .map(url => url.trim())
                        .filter(url => url.length > 0);

                    if (urls.length === 0) {
                        alert('請輸入至少一個連結');
                        this.addingChapters = false;
                        return;
                    }

                    // Create chapter data from URLs
                    const chapters = urls.map((url, index) => ({
                        url: url,
                        title: '', // Will be extracted from the page
                        chapterNumber: null // Will be extracted from the page
                    }));

                    // Use the download API to add chapters
                    const result = await window.API.addChaptersByUrl(this.selectedBookId, chapters);
                    
                    alert(`已開始下載 ${urls.length} 個章節，請在作業列表中查看進度`);
                    this.closeAddChapterModal();
                    this.loadChapters(); // Refresh chapter list
                } else if (this.addChapterMode === 'file') {
                    // Add by file
                    if (!this.selectedFile) {
                        alert('請選擇檔案');
                        this.addingChapters = false;
                        return;
                    }

                    const formData = new FormData();
                    formData.append('file', this.selectedFile);
                    formData.append('bookId', this.selectedBookId);

                    const result = await window.API.addChaptersByFile(formData);
                    
                    alert('檔案已上傳，正在處理中。請在作業列表中查看進度。');
                    this.closeAddChapterModal();
                    this.loadChapters(); // Refresh chapter list
                }
            } catch (error) {
                console.error('Error adding chapters:', error);
                alert('新增失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.addingChapters = false;
            }
        },
        async reformatAllChapters() {
            if (!this.selectedBookId) {
                alert('請先選擇書籍');
                return;
            }

            if (this.chapters.length === 0) {
                alert('此書籍沒有章節可以重新格式化');
                return;
            }

            if (!confirm(`確定要重新格式化此書籍的所有章節嗎？\n共 ${this.chapters.length} 個章節`)) {
                return;
            }

            this.reformatting = true;
            try {
                const result = await window.API.reformatBookChapters(this.selectedBookId);
                
                const message = `成功重新格式化 ${result.reformatted}/${result.total} 個章節${
                    result.errors > 0 ? ` (${result.errors} 個錯誤)` : ''
                }`;
                alert(message);
                
                // Refresh chapters list to show updated content
                this.loadChapters();
            } catch (error) {
                console.error('Error reformatting chapters:', error);
                alert('重新格式化失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.reformatting = false;
            }
        }
    }
});
