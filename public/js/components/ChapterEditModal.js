// ChapterEditModal Component
Vue.component('chapter-edit-modal', {
    template: `
        <div class="modal fade" id="chapterEditModal" tabindex="-1" aria-labelledby="chapterEditModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="chapterEditModalLabel">{{ viewMode ? '查看章節' : '編輯章節' }}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body" v-if="chapter">
                        <div v-if="loading" class="text-center py-4">
                            <div class="spinner-border" role="status">
                                <span class="visually-hidden">載入中...</span>
                            </div>
                        </div>
                        <div v-else>
                            <!-- View Mode: Show Content -->
                            <div v-if="viewMode">
                                <div class="row g-3 mb-3">
                                    <div class="col-md-6">
                                        <label class="form-label fw-bold">章節號</label>
                                        <div class="form-control-plaintext">{{ chapter.chapter_number || '-' }}</div>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label fw-bold">狀態</label>
                                        <div>
                                            <span :class="['badge', getStatusBadgeClass(chapter.status)]">
                                                {{ getStatusName(chapter.status) }}
                                            </span>
                                        </div>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label fw-bold">章節標題（繁體）</label>
                                        <div class="form-control-plaintext">{{ chapter.chapter_title || '-' }}</div>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label fw-bold">章節標題（簡體）</label>
                                        <div class="form-control-plaintext">{{ chapter.chapter_title_simplified || '-' }}</div>
                                    </div>
                                    <div class="col-12" v-if="chapter.chapter_name">
                                        <label class="form-label fw-bold">章節名稱</label>
                                        <div class="form-control-plaintext">{{ chapter.chapter_name }}</div>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label fw-bold">起始行數</label>
                                        <div class="form-control-plaintext">{{ chapter.line_start !== null ? chapter.line_start : '-' }}</div>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label fw-bold">結束行數</label>
                                        <div class="form-control-plaintext">{{ chapter.line_end !== null ? chapter.line_end : '-' }}</div>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label fw-bold">下載時間</label>
                                        <div class="form-control-plaintext">{{ formatDate(chapter.downloaded_at) }}</div>
                                    </div>
                                    <div class="col-12" v-if="chapter.cool18_url">
                                        <label class="form-label fw-bold">來源網址</label>
                                        <div>
                                            <a :href="chapter.cool18_url" target="_blank" class="text-break">
                                                {{ chapter.cool18_url }}
                                            </a>
                                        </div>
                                    </div>
                                </div>
                                <hr>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">章節內容</label>
                                    <div 
                                        class="border rounded p-3 bg-light" 
                                        style="max-height: 500px; overflow-y: auto; white-space: pre-wrap; font-family: monospace; font-size: 0.9em;"
                                    >
                                        {{ chapter.content || '（無內容）' }}
                                    </div>
                                </div>
                            </div>
                            <!-- Edit Mode: Show Form -->
                            <form v-else @submit.prevent="saveChapter">
                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <label class="form-label">章節號 <span class="text-danger">*</span></label>
                                        <input
                                            type="number"
                                            class="form-control"
                                            v-model.number="editData.chapter_number"
                                            required
                                            :disabled="saving"
                                        />
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">狀態</label>
                                        <select class="form-select" v-model="editData.status" :disabled="saving">
                                            <option value="pending">等待中</option>
                                            <option value="downloading">下載中</option>
                                            <option value="completed">已完成</option>
                                            <option value="failed">失敗</option>
                                        </select>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">章節標題（繁體）</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            v-model="editData.chapter_title"
                                            :disabled="saving"
                                        />
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">章節標題（簡體）</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            v-model="editData.chapter_title_simplified"
                                            :disabled="saving"
                                        />
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">章節名稱</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            v-model="editData.chapter_name"
                                            :disabled="saving"
                                            placeholder="例如：第一章的名稱"
                                        />
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">起始行數</label>
                                        <input
                                            type="number"
                                            class="form-control"
                                            v-model.number="editData.line_start"
                                            :disabled="saving"
                                        />
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">結束行數</label>
                                        <input
                                            type="number"
                                            class="form-control"
                                            v-model.number="editData.line_end"
                                            :disabled="saving"
                                        />
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">下載時間</label>
                                        <input
                                            type="text"
                                            class="form-control"
                                            :value="formatDate(chapter.downloaded_at)"
                                            disabled
                                        />
                                    </div>
                                    <div class="col-12" v-if="chapter.cool18_url">
                                        <label class="form-label">來源網址</label>
                                        <a :href="chapter.cool18_url" target="_blank" class="form-control-plaintext">
                                            {{ chapter.cool18_url }}
                                        </a>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button 
                            v-if="viewMode" 
                            type="button" 
                            class="btn btn-primary" 
                            @click="switchToEditMode"
                        >
                            編輯
                        </button>
                        <template v-else>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" :disabled="saving">
                                取消
                            </button>
                            <button 
                                type="button" 
                                class="btn btn-primary" 
                                @click="saveChapter"
                                :disabled="saving || loading"
                            >
                                <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
                                儲存
                            </button>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            chapter: null,
            bookId: null,
            chapterId: null,
            loading: false,
            saving: false,
            viewMode: true, // true for view, false for edit
            editData: {
                chapter_number: null,
                chapter_title: '',
                chapter_title_simplified: '',
                chapter_name: '',
                status: 'pending',
                line_start: null,
                line_end: null
            }
        };
    },
    mounted() {
        // Listen for open modal events
        this.$root.$on('view-chapter', (bookId, chapterId) => this.openModal(bookId, chapterId, true));
        this.$root.$on('edit-chapter', (bookId, chapterId) => this.openModal(bookId, chapterId, false));
        
        // Listen for modal close to reset state
        const modalElement = document.getElementById('chapterEditModal');
        if (modalElement) {
            modalElement.addEventListener('hidden.bs.modal', () => {
                this.resetModal();
            });
        }
    },
    beforeDestroy() {
        this.$root.$off('view-chapter');
        this.$root.$off('edit-chapter');
    },
    methods: {
        async openModal(bookId, chapterId, viewMode = true) {
            this.bookId = bookId;
            this.chapterId = chapterId;
            this.viewMode = viewMode;
            this.loading = true;
            
            // Show modal
            const modalElement = document.getElementById('chapterEditModal');
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
            
            try {
                // Load chapter data
                this.chapter = await window.API.getChapter(bookId, chapterId);
                
                // Populate edit form (for edit mode)
                this.editData = {
                    chapter_number: this.chapter.chapter_number,
                    chapter_title: this.chapter.chapter_title || '',
                    chapter_title_simplified: this.chapter.chapter_title_simplified || '',
                    chapter_name: this.chapter.chapter_name || '',
                    status: this.chapter.status || 'pending',
                    line_start: this.chapter.line_start,
                    line_end: this.chapter.line_end
                };
            } catch (error) {
                console.error('Error loading chapter:', error);
                alert('載入章節失敗: ' + (error.message || 'Unknown error'));
                modal.hide();
            } finally {
                this.loading = false;
            }
        },
        switchToEditMode() {
            this.viewMode = false;
        },
        async saveChapter() {
            if (!this.chapter || !this.bookId || !this.chapterId) {
                return;
            }
            
            this.saving = true;
            try {
                // Prepare update data (only include changed fields)
                const updateData = {};
                
                if (this.editData.chapter_number !== this.chapter.chapter_number) {
                    updateData.chapter_number = this.editData.chapter_number;
                }
                if (this.editData.chapter_title !== (this.chapter.chapter_title || '')) {
                    updateData.chapter_title = this.editData.chapter_title || null;
                }
                if (this.editData.chapter_title_simplified !== (this.chapter.chapter_title_simplified || '')) {
                    updateData.chapter_title_simplified = this.editData.chapter_title_simplified || null;
                }
                if (this.editData.chapter_name !== (this.chapter.chapter_name || '')) {
                    updateData.chapter_name = this.editData.chapter_name || null;
                }
                if (this.editData.status !== (this.chapter.status || 'pending')) {
                    updateData.status = this.editData.status;
                }
                if (this.editData.line_start !== this.chapter.line_start) {
                    updateData.line_start = this.editData.line_start;
                }
                if (this.editData.line_end !== this.chapter.line_end) {
                    updateData.line_end = this.editData.line_end;
                }
                
                if (Object.keys(updateData).length === 0) {
                    alert('沒有變更');
                    return;
                }
                
                // Update chapter
                await window.API.updateChapter(this.bookId, this.chapterId, updateData);
                
                // Close modal
                const modalElement = document.getElementById('chapterEditModal');
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) {
                    modal.hide();
                }
                
                // Emit event to refresh chapters list
                this.$root.$emit('chapter-updated', this.bookId);
                
                alert('章節已更新');
            } catch (error) {
                console.error('Error updating chapter:', error);
                alert('更新失敗: ' + (error.message || 'Unknown error'));
            } finally {
                this.saving = false;
            }
        },
        resetModal() {
            this.chapter = null;
            this.bookId = null;
            this.chapterId = null;
            this.loading = false;
            this.saving = false;
            this.viewMode = true;
            this.editData = {
                chapter_number: null,
                chapter_title: '',
                chapter_title_simplified: '',
                chapter_name: '',
                status: 'pending',
                line_start: null,
                line_end: null
            };
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
        }
    }
});

