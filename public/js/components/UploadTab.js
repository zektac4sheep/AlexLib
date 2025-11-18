// UploadTab Component
Vue.component('upload-tab', {
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-3">上傳檔案處理</h3>
            <p class="text-muted mb-4">
                支援的檔案格式：html.txt (論壇索引)、單一執行緒 HTML、raw.txt、pre_content_0.md
            </p>

            <!-- Upload Area -->
            <div 
                class="border border-2 border-dashed rounded p-5 text-center mb-4"
                :class="{ 'border-primary': isDragging, 'border-secondary': !isDragging }"
                @click="triggerFileInput"
                @dragover.prevent="isDragging = true"
                @dragleave.prevent="isDragging = false"
                @drop.prevent="handleDrop"
                style="cursor: pointer; transition: all 0.3s;"
            >
                <div style="font-size: 48px; margin-bottom: 10px;">📁</div>
                <div class="fw-bold mb-2">點擊或拖放檔案到此處上傳</div>
                <div class="text-muted small">支援多檔案上傳</div>
            </div>
            <input
                type="file"
                ref="fileInput"
                class="d-none"
                multiple
                accept=".txt,.html,.md"
                @change="handleFileSelect"
            />

            <!-- Status Message -->
            <div v-if="statusMessage" :class="['alert', statusType, 'mb-3']">
                {{ statusMessage }}
            </div>

            <!-- Uploaded Files List -->
            <div v-if="uploadedFiles.length > 0" class="mb-4">
                <h4 class="h6 mb-3">已上傳的檔案 ({{ uploadedFiles.length }})</h4>
                <div class="list-group">
                    <div 
                        v-for="(file, index) in uploadedFiles" 
                        :key="index"
                        class="list-group-item d-flex justify-content-between align-items-center"
                    >
                        <div>
                            <div class="fw-bold">{{ file.originalName }}</div>
                            <div class="text-muted small">{{ formatFileSize(file.size) }}</div>
                        </div>
                        <div class="btn-group">
                            <button 
                                class="btn btn-sm btn-success"
                                @click="extractAndCreateBook(index)"
                                :disabled="processing"
                            >
                                提取並建立
                            </button>
                            <button 
                                class="btn btn-sm btn-secondary"
                                @click="removeFile(index)"
                            >
                                移除
                            </button>
                        </div>
                    </div>
                </div>
                <div class="mt-3">
                    <button 
                        class="btn btn-primary"
                        @click="analyzeAndShowModal"
                        :disabled="processing || uploadedFiles.length === 0"
                    >
                        分析並處理所有檔案
                    </button>
                </div>
            </div>

            <!-- Book Selection Modal -->
            <div 
                v-if="showBookModal"
                class="modal fade show"
                style="display: block; background: rgba(0,0,0,0.5);"
                @click.self="closeBookModal"
            >
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">確認書籍資訊</h5>
                            <button type="button" class="btn-close" @click="closeBookModal"></button>
                        </div>
                        <div class="modal-body">
                            <div v-if="uploadedFiles.length > 1" class="alert alert-info mb-3">
                                共 {{ uploadedFiles.length }} 個檔案將被處理
                            </div>
                            <p class="text-muted mb-3">
                                書籍資訊已從第一個檔案中提取，請確認或修改：
                            </p>

                            <!-- Book Selector -->
                            <div class="mb-3">
                                <label class="form-label">選擇書籍：</label>
                                <select 
                                    v-model="selectedBookId" 
                                    class="form-select"
                                    @change="onBookSelectChange"
                                >
                                    <option value="new">建立新書籍</option>
                                    <option 
                                        v-for="book in allBooks" 
                                        :key="book.id" 
                                        :value="book.id"
                                    >
                                        {{ book.book_name_traditional || book.book_name_simplified }}
                                    </option>
                                </select>
                            </div>

                            <!-- New Book Metadata Form -->
                            <div v-if="selectedBookId === 'new'" class="bg-light p-3 rounded mb-3">
                                <h6 class="mb-3">新書籍資訊</h6>
                                <div class="mb-3">
                                    <label class="form-label">書籍名稱：</label>
                                    <input 
                                        type="text" 
                                        v-model="newBookMetadata.bookName"
                                        class="form-control"
                                        placeholder="書籍名稱 (簡體中文)"
                                    />
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">作者：</label>
                                    <input 
                                        type="text" 
                                        v-model="newBookMetadata.author"
                                        class="form-control"
                                        placeholder="作者"
                                    />
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">分類：</label>
                                    <input 
                                        type="text" 
                                        v-model="newBookMetadata.category"
                                        class="form-control"
                                        placeholder="分類"
                                    />
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">描述：</label>
                                    <textarea 
                                        v-model="newBookMetadata.description"
                                        class="form-control"
                                        rows="3"
                                        placeholder="描述"
                                    ></textarea>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">來源網址：</label>
                                    <input 
                                        type="text" 
                                        v-model="newBookMetadata.sourceUrl"
                                        class="form-control"
                                        placeholder="來源網址"
                                    />
                                </div>
                            </div>

                            <!-- Chapter Preview -->
                            <div v-if="fileAnalysis && fileAnalysis.chapters">
                                <label class="form-label">章節預覽（前10個）：</label>
                                <pre class="bg-light p-3 rounded" style="max-height: 200px; overflow-y: auto; font-size: 13px; white-space: pre-wrap;">{{ getChapterPreview() }}</pre>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" @click="closeBookModal">
                                取消
                            </button>
                            <button 
                                type="button" 
                                class="btn btn-success"
                                @click="processAllFiles"
                                :disabled="processing"
                            >
                                確認並處理所有檔案
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            uploadedFiles: [],
            isDragging: false,
            statusMessage: '',
            statusType: '',
            processing: false,
            showBookModal: false,
            fileAnalysis: null,
            allBooks: [],
            selectedBookId: 'new',
            newBookMetadata: {
                bookName: '',
                author: '',
                category: '',
                description: '',
                sourceUrl: ''
            }
        };
    },
    mounted() {
        this.loadBooks();
    },
    methods: {
        triggerFileInput() {
            this.$refs.fileInput.click();
        },
        handleFileSelect(event) {
            const files = Array.from(event.target.files);
            this.handleFiles(files);
            // Reset input
            event.target.value = '';
        },
        handleDrop(event) {
            this.isDragging = false;
            const files = Array.from(event.dataTransfer.files);
            this.handleFiles(files);
        },
        async handleFiles(files) {
            const validFiles = files.filter((file) => {
                const ext = file.name.split('.').pop().toLowerCase();
                return ['txt', 'html', 'md'].includes(ext);
            });

            if (validFiles.length === 0) {
                this.showStatus('請選擇有效的檔案格式 (.txt, .html, .md)', 'error');
                return;
            }

            this.showStatus(`正在上傳 ${validFiles.length} 個檔案...`, 'info');
            this.processing = true;

            for (const file of validFiles) {
                try {
                    const result = await window.API.uploadFile(file);
                    if (result.error) {
                        this.showStatus(`上傳 ${file.name} 失敗: ${result.message}`, 'error');
                    } else {
                        this.uploadedFiles.push({
                            filename: result.filename,
                            originalName: result.originalName || file.name,
                            size: file.size,
                            path: result.path
                        });
                    }
                } catch (error) {
                    this.showStatus(`上傳 ${file.name} 時發生錯誤: ${error.message}`, 'error');
                }
            }

            this.processing = false;

            if (this.uploadedFiles.length > 0) {
                this.showStatus(`成功上傳 ${this.uploadedFiles.length} 個檔案`, 'success');
                await this.loadBooks();
            }
        },
        removeFile(index) {
            this.uploadedFiles.splice(index, 1);
            if (this.uploadedFiles.length === 0) {
                this.fileAnalysis = null;
            }
        },
        async analyzeAndShowModal() {
            if (this.uploadedFiles.length === 0) {
                this.showStatus('沒有可處理的檔案', 'error');
                return;
            }

            const firstFile = this.uploadedFiles[0];
            this.showStatus('正在分析第一個檔案以提取書籍資訊...', 'info');
            this.processing = true;

            try {
                const analysis = await window.API.analyzeFile(firstFile.filename, firstFile.originalName);
                
                if (analysis.error) {
                    this.showStatus(`分析失敗: ${analysis.message}`, 'error');
                    this.processing = false;
                    return;
                }

                this.fileAnalysis = analysis;

                // Populate form with extracted data
                this.newBookMetadata.bookName = analysis.bookNameSimplified || '';
                this.newBookMetadata.author = analysis.metadata?.author || '';
                this.newBookMetadata.category = analysis.metadata?.category || '';
                this.newBookMetadata.description = analysis.metadata?.description || '';
                this.newBookMetadata.sourceUrl = analysis.metadata?.sourceUrl || '';

                // Update book selector with matched books
                if (analysis.matchedBooks && analysis.matchedBooks.length > 0) {
                    // Auto-select first matched book
                    this.selectedBookId = analysis.matchedBooks[0].id;
                } else {
                    this.selectedBookId = 'new';
                }

                this.showBookModal = true;
                this.processing = false;
            } catch (error) {
                console.error('Analyze error:', error);
                this.showStatus('分析時發生錯誤: ' + error.message, 'error');
                this.processing = false;
            }
        },
        async extractAndCreateBook(index) {
            if (index < 0 || index >= this.uploadedFiles.length) {
                this.showStatus('無效的檔案索引', 'error');
                return;
            }

            const file = this.uploadedFiles[index];
            this.showStatus(`正在從 ${file.originalName} 提取書籍資訊並建立新書...`, 'info');
            this.processing = true;

            try {
                const result = await window.API.extractAndCreateBook(file.filename, file.originalName);
                
                if (result.error) {
                    this.showStatus('提取並建立書籍失敗: ' + result.message, 'error');
                } else {
                    if (result.chaptersInserted === 0 && result.chaptersUpdated === 0) {
                        if (result.totalChapters === 0) {
                            this.showStatus(
                                `警告：檔案中沒有找到章節。書籍「${result.bookName}」已${result.isNewBook ? '建立' : '存在'}，但沒有章節被添加。`,
                                'error'
                            );
                        } else {
                            this.showStatus(
                                `警告：沒有章節被添加或更新。總章節數：${result.totalChapters}`,
                                'error'
                            );
                        }
                    } else {
                        const message = result.isMerged
                            ? `已合併到現有書籍「${result.bookName}」！已處理 ${result.chaptersInserted} 個新章節，${result.chaptersUpdated} 個章節已更新${result.chaptersErrored > 0 ? `，${result.chaptersErrored} 個失敗` : ''}`
                            : `成功建立書籍「${result.bookName}」！已處理 ${result.chaptersInserted} 個章節${result.chaptersErrored > 0 ? `，${result.chaptersErrored} 個失敗` : ''}`;
                        
                        this.showStatus(message, result.chaptersErrored > 0 ? 'error' : 'success');
                        
                        // Remove processed file
                        this.uploadedFiles.splice(index, 1);
                        
                        // Switch to books tab after delay
                        setTimeout(() => {
                            if (window.app) {
                                window.app.switchTab('books');
                                window.app.$emit('switch-tab', 'books');
                            } else {
                                this.$root.$emit('switch-tab', 'books');
                            }
                        }, 2000);
                    }
                }
            } catch (error) {
                console.error('Error extracting and creating book:', error);
                this.showStatus('提取並建立書籍時發生錯誤: ' + error.message, 'error');
            } finally {
                this.processing = false;
            }
        },
        async processAllFiles() {
            if (this.uploadedFiles.length === 0) {
                this.showStatus('沒有可處理的檔案', 'error');
                return;
            }

            let bookId = this.selectedBookId === 'new' ? null : parseInt(this.selectedBookId);
            let bookName = null;
            let bookMetadata = null;

            if (this.selectedBookId === 'new') {
                if (!this.newBookMetadata.bookName.trim()) {
                    this.showStatus('請輸入新書籍名稱', 'error');
                    return;
                }

                bookName = this.normalizeToHalfWidth(this.newBookMetadata.bookName.trim());
                bookMetadata = {
                    author: this.newBookMetadata.author.trim() || null,
                    category: this.newBookMetadata.category.trim() || null,
                    description: this.newBookMetadata.description.trim() || null,
                    sourceUrl: this.newBookMetadata.sourceUrl.trim() || null
                };

                // Normalize metadata
                if (bookMetadata.author) {
                    bookMetadata.author = this.normalizeToHalfWidth(bookMetadata.author);
                }
                if (bookMetadata.category) {
                    bookMetadata.category = this.normalizeToHalfWidth(bookMetadata.category);
                }
            }

            this.processing = true;
            this.showBookModal = false;

            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < this.uploadedFiles.length; i++) {
                const file = this.uploadedFiles[i];
                try {
                    const processData = {
                        filename: file.filename,
                        originalName: file.originalName,
                        bookId: bookId,
                        bookName: bookName,
                        bookMetadata: bookMetadata
                    };

                    const result = await window.API.processFile(processData);
                    
                    if (result.error) {
                        errorCount++;
                        this.showStatus(`處理 ${file.originalName} 失敗: ${result.message}`, 'error');
                    } else {
                        successCount++;
                        // Update bookId for subsequent files if it was a new book
                        if (bookId === null && result.bookId) {
                            bookId = result.bookId;
                        }
                    }
                } catch (error) {
                    errorCount++;
                    this.showStatus(`處理 ${file.originalName} 時發生錯誤: ${error.message}`, 'error');
                }
            }

            this.processing = false;

            if (successCount > 0) {
                this.showStatus(
                    `處理完成！成功: ${successCount}，失敗: ${errorCount}`,
                    errorCount > 0 ? 'error' : 'success'
                );
                this.uploadedFiles = [];
                this.fileAnalysis = null;
                
                // Switch to books tab after delay
                setTimeout(() => {
                    if (window.app) {
                        window.app.switchTab('books');
                        window.app.$emit('switch-tab', 'books');
                    } else {
                        this.$root.$emit('switch-tab', 'books');
                    }
                }, 2000);
            }
        },
        closeBookModal() {
            this.showBookModal = false;
            // Optionally clear uploaded files when modal is closed without processing
            // this.uploadedFiles = [];
            // this.fileAnalysis = null;
        },
        onBookSelectChange() {
            // Form visibility is handled by v-if in template
        },
        getChapterPreview() {
            if (!this.fileAnalysis || !this.fileAnalysis.chapters) {
                return '無章節資訊';
            }

            const chapters = this.fileAnalysis.chapters.slice(0, 10);
            let preview = chapters.map((ch, idx) => `${idx + 1}. ${ch.titleTraditional || ch.title}`).join('\n');
            
            if (this.fileAnalysis.totalChapters > 10) {
                preview += `\n... 還有 ${this.fileAnalysis.totalChapters - 10} 個章節`;
            }

            return preview;
        },
        formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        },
        async loadBooks() {
            try {
                this.allBooks = await window.API.getBooks();
            } catch (error) {
                console.error('Error loading books:', error);
            }
        },
        showStatus(message, type) {
            this.statusMessage = message;
            this.statusType = type === 'error' ? 'alert-danger' : 
                            type === 'success' ? 'alert-success' : 
                            'alert-info';
            if (type === 'success' || type === 'error') {
                setTimeout(() => {
                    this.statusMessage = '';
                }, 5000);
            }
        },
        normalizeToHalfWidth(text) {
            if (!text) return text;
            const fullToHalf = {
                'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E', 'Ｆ': 'F',
                'Ｇ': 'G', 'Ｈ': 'H', 'Ｉ': 'I', 'Ｊ': 'J', 'Ｋ': 'K', 'Ｌ': 'L',
                'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O', 'Ｐ': 'P', 'Ｑ': 'Q', 'Ｒ': 'R',
                'Ｓ': 'S', 'Ｔ': 'T', 'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X',
                'Ｙ': 'Y', 'Ｚ': 'Z',
                'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f',
                'ｇ': 'g', 'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l',
                'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r',
                'ｓ': 's', 'ｔ': 't', 'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x',
                'ｙ': 'y', 'ｚ': 'z',
                '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
                '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
                '　': ' '
            };
            let normalized = text;
            for (const [full, half] of Object.entries(fullToHalf)) {
                normalized = normalized.replace(new RegExp(full, 'g'), half);
            }
            return normalized;
        }
    }
});
