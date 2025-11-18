// JobsTab Component
Vue.component("jobs-tab", {
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">作業佇列</h3>

            <!-- Filters -->
            <div class="card mb-4">
                <div class="card-body">
                    <div class="row g-3">
                        <div class="col-md-4">
                            <label class="form-label">狀態篩選</label>
                            <select class="form-select" v-model="statusFilter" @change="loadJobs">
                                <option value="">全部</option>
                                <option value="queued">排隊中</option>
                                <option value="processing">處理中</option>
                                <option value="waiting_for_input">等待輸入</option>
                                <option value="completed">已完成</option>
                                <option value="failed">失敗</option>
                            </select>
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">類型篩選</label>
                            <select class="form-select" v-model="typeFilter" @change="loadJobs">
                                <option value="">全部</option>
                                <option value="book_search">章節搜尋</option>
                                <option value="download">下載</option>
                                <option value="chunk">分塊</option>
                                <option value="joplin">Joplin</option>
                                <option value="upload">上傳</option>
                            </select>
                        </div>
                        <div class="col-md-4 d-flex align-items-end">
                            <button 
                                class="btn btn-primary w-100" 
                                @click="loadJobs"
                                :disabled="loading"
                            >
                                <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
                                重新整理
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Jobs List -->
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center gap-3">
                        <input 
                            type="checkbox" 
                            class="form-check-input mt-0"
                            :checked="allJobsSelected"
                            @change="toggleSelectAll"
                            :disabled="jobs.length === 0"
                            style="width: 18px; height: 18px; cursor: pointer;"
                            title="全選/取消全選"
                        />
                        <h5 class="mb-0">作業列表 ({{ jobs.length }})</h5>
                        <span 
                            v-if="waitingForInputCount > 0" 
                            class="badge bg-warning text-dark"
                            title="需要處理的作業數量"
                        >
                            ⚠️ {{ waitingForInputCount }} 個等待處理
                        </span>
                    </div>
                    <div class="d-flex align-items-center gap-3">
                        <div v-if="selectedJobs.length > 0" class="d-flex align-items-center gap-2">
                            <span class="text-muted small">已選擇 {{ selectedJobs.length }} 個</span>
                            <button 
                                class="btn btn-sm btn-danger"
                                @click="bulkDeleteJobs"
                                :disabled="deletingJobs"
                            >
                                <span v-if="deletingJobs" class="spinner-border spinner-border-sm me-1"></span>
                                批量刪除
                            </button>
                        </div>
                        <div class="form-check form-switch">
                            <input 
                                class="form-check-input" 
                                type="checkbox" 
                                id="autoRefresh"
                                v-model="autoRefresh"
                            />
                            <label class="form-check-label" for="autoRefresh">
                                自動更新
                            </label>
                        </div>
                        <div class="form-check form-switch">
                            <input 
                                class="form-check-input" 
                                type="checkbox" 
                                id="autoSearchEnabled"
                                v-model="autoSearchEnabled"
                                @change="toggleAutoSearch"
                            />
                            <label class="form-check-label" for="autoSearchEnabled">
                                自動搜尋
                            </label>
                        </div>
                    </div>
                </div>
                <div class="card-body">
                    <div v-if="loading && jobs.length === 0" class="text-center py-5">
                        <div class="spinner-border" role="status">
                            <span class="visually-hidden">載入中...</span>
                        </div>
                    </div>
                    <div v-else-if="jobs.length === 0" class="text-center text-muted py-5">
                        沒有作業
                    </div>
                    <div v-else>
                        <div 
                            v-for="job in jobs" 
                            :key="job.type + '-' + job.id"
                            :class="['card', 'mb-3', { 
                                'border-warning': job.status === 'waiting_for_input',
                                'border-primary': isJobSelected(job)
                            }]"
                        >
                            <div class="card-body">
                                <div class="d-flex justify-content-between align-items-start mb-2">
                                    <div class="d-flex align-items-start gap-2 flex-grow-1">
                                        <input 
                                            type="checkbox" 
                                            class="form-check-input mt-1"
                                            :checked="isJobSelected(job)"
                                            @change="toggleJobSelection(job)"
                                            style="width: 18px; height: 18px; cursor: pointer;"
                                        />
                                        <div class="flex-grow-1">
                                            <div class="d-flex align-items-center gap-2 mb-1">
                                                <strong>{{ getJobTypeName(job.type) }}</strong>
                                                <span :class="['badge', getStatusBadgeClass(job.status)]">
                                                    {{ getStatusName(job.status) }}
                                                </span>
                                                <span v-if="job.bookName" class="text-muted small">
                                                    {{ job.bookName }}
                                                </span>
                                                <span v-if="job.originalName" class="text-muted small">
                                                    {{ job.originalName }}
                                                </span>
                                            </div>
                                            <div class="text-muted small">
                                                <span>建立時間: {{ formatDate(job.createdAt) }}</span>
                                                <span v-if="job.startedAt" class="ms-3">
                                                    開始時間: {{ formatDate(job.startedAt) }}
                                                </span>
                                                <span v-if="job.completedAt" class="ms-3">
                                                    完成時間: {{ formatDate(job.completedAt) }}
                                                </span>
                                            </div>
                                            <div v-if="job.errorMessage" class="text-danger small mt-2">
                                                錯誤: {{ job.errorMessage }}
                                            </div>
                                            <div v-if="job.status === 'waiting_for_input'" class="alert alert-warning py-2 px-3 mt-2 mb-0 small">
                                                <strong>⚠️ 需要您的操作：</strong>
                                                <div v-if="job.type === 'book_search'" class="mt-1">
                                                    <div>系統已完成章節搜尋，找到了一些章節。</div>
                                                    <div class="mt-1"><strong>請點擊右側的「⚠️ 查看結果」按鈕</strong>，然後：</div>
                                                    <ol class="mb-0 mt-1 ps-3">
                                                        <li>查看找到的章節列表</li>
                                                        <li>勾選您想要下載的章節</li>
                                                        <li>點擊「下載選中的章節」按鈕</li>
                                                    </ol>
                                                </div>
                                                <div v-else-if="job.type === 'upload'" class="mt-1">
                                                    <div>系統已分析上傳的檔案。</div>
                                                    <div class="mt-1"><strong>請點擊右側的「⚠️ 確認處理」按鈕</strong>，然後：</div>
                                                    <ol class="mb-0 mt-1 ps-3">
                                                        <li>選擇要將章節加入的書籍（或建立新書籍）</li>
                                                        <li>如果是新書籍，請填寫書籍資訊（名稱、作者等）</li>
                                                        <li>點擊「確認並處理」按鈕</li>
                                                    </ol>
                                                </div>
                                                <span v-else>請點擊「詳情」按鈕查看詳情並處理此作業</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="btn-group">
                                        <button 
                                            v-if="job.status === 'waiting_for_input' && job.type === 'book_search'"
                                            class="btn btn-sm btn-warning"
                                            @click="reviewSearchResults(job)"
                                            title="查看搜尋結果並選擇要下載的章節"
                                        >
                                            ⚠️ 查看結果
                                        </button>
                                        <button 
                                            v-else-if="job.status === 'waiting_for_input' && job.type === 'upload'"
                                            class="btn btn-sm btn-warning"
                                            @click="reviewUploadJob(job)"
                                            title="確認上傳檔案處理方式"
                                        >
                                            ⚠️ 確認處理
                                        </button>
                                        <button 
                                            v-else-if="job.status === 'waiting_for_input'"
                                            class="btn btn-sm btn-warning"
                                            @click="showJobDetails(job)"
                                            title="查看詳情並處理"
                                        >
                                            ⚠️ 需要處理
                                        </button>
                                        <button 
                                            class="btn btn-sm btn-outline-info"
                                            @click="showJobDetails(job)"
                                            title="查看詳情"
                                        >
                                            詳情
                                        </button>
                                        <button 
                                            v-if="job.status === 'failed'"
                                            class="btn btn-sm btn-warning"
                                            @click="retryJob(job)"
                                        >
                                            重試
                                        </button>
                                        <button 
                                            v-if="job.status !== 'processing'"
                                            class="btn btn-sm btn-danger"
                                            @click="deleteJob(job)"
                                        >
                                            刪除
                                        </button>
                                    </div>
                                </div>

                                <!-- Progress Bar -->
                                <div v-if="job.status === 'processing' && job.totalChapters" class="mb-2">
                                    <div class="progress" style="height: 20px;">
                                        <div 
                                            class="progress-bar" 
                                            :style="{ width: ((job.completedChapters || 0) / job.totalChapters * 100) + '%' }"
                                        >
                                            {{ job.completedChapters || 0 }} / {{ job.totalChapters }}
                                        </div>
                                    </div>
                                </div>

                                <!-- Job-specific info -->
                                <div v-if="job.type === 'book_search'" class="small text-muted">
                                    <span v-if="job.autoJob" class="badge bg-info ms-2">自動作業</span>
                                    <span v-if="job.data && job.data.results && job.data.results.foundChapters">
                                        找到 {{ job.data.results.foundChapters.length }} 個章節
                                    </span>
                                </div>
                                <div v-if="job.type === 'download'" class="small text-muted">
                                    總章節: {{ job.totalChapters || 0 }} · 
                                    已完成: {{ job.completedChapters || 0 }} · 
                                    失敗: {{ job.failedChapters || 0 }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Job Details Modal -->
            <div 
                v-if="showDetailsModal && selectedJob"
                class="modal fade show"
                style="display: block; background: rgba(0,0,0,0.5);"
                @click.self="closeDetailsModal"
            >
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">作業詳情 - {{ getJobTypeName(selectedJob.type) }}</h5>
                            <button type="button" class="btn-close" @click="closeDetailsModal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row mb-3">
                                <div class="col-md-6">
                                    <strong>狀態:</strong>
                                    <span :class="['badge ms-2', getStatusBadgeClass(selectedJob.status)]">
                                        {{ getStatusName(selectedJob.status) }}
                                    </span>
                                </div>
                                <div class="col-md-6">
                                    <strong>建立時間:</strong> {{ formatDate(selectedJob.createdAt) }}
                                </div>
                            </div>
                            <div v-if="selectedJob.startedAt" class="row mb-3">
                                <div class="col-md-6">
                                    <strong>開始時間:</strong> {{ formatDate(selectedJob.startedAt) }}
                                </div>
                            </div>
                            <div v-if="selectedJob.completedAt" class="row mb-3">
                                <div class="col-md-6">
                                    <strong>完成時間:</strong> {{ formatDate(selectedJob.completedAt) }}
                                </div>
                            </div>
                            <div v-if="selectedJob.errorMessage" class="alert alert-danger">
                                <strong>錯誤訊息:</strong> {{ selectedJob.errorMessage }}
                            </div>
                            <div v-if="selectedJob.type === 'book_search'">
                                <strong>書籍:</strong> {{ selectedJob.bookName || 'N/A' }}<br>
                                <strong>作者:</strong> {{ selectedJob.author || 'N/A' }}<br>
                                <strong>搜尋名稱:</strong> {{ getSearchName(selectedJob) || 'N/A' }}<br>
                                <strong>作業類型:</strong> 
                                <span v-if="selectedJob.autoJob" class="badge bg-info">自動作業</span>
                                <span v-else class="badge bg-secondary">手動作業</span>
                                <br>
                                
                                <!-- Loading search results -->
                                <div v-if="loadingJobSearchResults" class="mt-3">
                                    <div class="spinner-border spinner-border-sm me-2"></div>
                                    <span>載入搜尋結果中...</span>
                                </div>
                                
                                <!-- Search Results Summary -->
                                <div v-else-if="jobSearchResults" class="mt-3">
                                    <div v-if="!jobSearchResults.threads || jobSearchResults.threads.length === 0" class="alert alert-warning">
                                        <strong>未找到新章節</strong><br>
                                        <small>搜尋完成，但沒有找到符合條件的章節。</small>
                                    </div>
                                    <div v-else class="alert alert-success">
                                        <strong>找到 {{ jobSearchResults.threads.length }} 個章節</strong>
                                    </div>
                                    
                                    <!-- Found Chapters List -->
                                    <div v-if="jobSearchResults.threads && jobSearchResults.threads.length > 0" class="mt-3">
                                        <strong>找到的章節：</strong>
                                        <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 10px; margin-top: 10px;">
                                            <div 
                                                v-for="(thread, index) in jobSearchResults.threads" 
                                                :key="index"
                                                class="mb-2 p-2 border-bottom"
                                                :style="isSearchUrlUsed(thread.url) ? 'background-color: #fff3cd; border-left: 4px solid #ffc107; padding-left: 12px;' : ''"
                                            >
                                                <div class="fw-bold">
                                                    第{{ thread.chapterNumber }}章
                                                    <span v-if="thread.chapterFormat"> ({{ thread.chapterFormat }})</span>
                                                    <span v-if="isSearchUrlUsed(thread.url)" class="badge bg-warning text-dark ms-2" title="此連結是搜尋使用的網址">搜尋網址</span>
                                                </div>
                                                <div class="text-muted small mt-1">{{ thread.title || thread.titleTraditional }}</div>
                                                <div class="text-muted small mt-1" v-if="thread.date">{{ thread.date }}</div>
                                                <div class="mt-1" v-if="thread.url">
                                                    <a 
                                                        :href="thread.url" 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        :class="isSearchUrlUsed(thread.url) ? 'text-decoration-none fw-bold' : 'text-decoration-none'"
                                                        :style="isSearchUrlUsed(thread.url) ? 'color: #856404;' : 'color: #0d6efd;'"
                                                    >
                                                        🔗 {{ thread.url }}
                                                    </a>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Error loading results -->
                                <div v-else-if="jobSearchResultsError" class="mt-3 alert alert-danger">
                                    <strong>載入搜尋結果失敗:</strong> {{ jobSearchResultsError }}
                                </div>
                            </div>
                            <div v-if="selectedJob.type === 'download'">
                                <strong>書籍:</strong> {{ selectedJob.bookName || 'N/A' }}<br>
                                <strong>總章節:</strong> {{ selectedJob.totalChapters || 0 }}<br>
                                <strong>已完成:</strong> {{ selectedJob.completedChapters || 0 }}<br>
                                <strong>失敗:</strong> {{ selectedJob.failedChapters || 0 }}
                                
                                <!-- Loading chapters -->
                                <div v-if="loadingDownloadChapters" class="mt-3">
                                    <div class="spinner-border spinner-border-sm me-2"></div>
                                    <span>載入章節列表中...</span>
                                </div>
                                
                                <!-- Downloaded Chapters List -->
                                <div v-else-if="downloadJobChapters && downloadJobChapters.length > 0" class="mt-3">
                                    <strong>已下載的章節：</strong>
                                    <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 10px; margin-top: 10px;">
                                        <div 
                                            v-for="(chapter, index) in downloadJobChapters" 
                                            :key="index"
                                            class="mb-2 p-2 border-bottom"
                                        >
                                            <div class="d-flex justify-content-between align-items-start">
                                                <div class="flex-grow-1">
                                                    <div class="fw-bold">
                                                        第{{ chapter.chapter_number || '?' }}章
                                                        <span :class="['badge ms-2', getStatusBadgeClass(chapter.status)]">
                                                            {{ getStatusName(chapter.status) }}
                                                        </span>
                                                    </div>
                                                    <div class="text-muted small mt-1">
                                                        {{ chapter.chapter_title || chapter.chapter_title_simplified || chapter.chapter_name || '無標題' }}
                                                    </div>
                                                    <div v-if="chapter.cool18_url" class="mt-1">
                                                        <a 
                                                            :href="chapter.cool18_url" 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            class="text-decoration-none small"
                                                        >
                                                            🔗 {{ chapter.cool18_url }}
                                                        </a>
                                                    </div>
                                                    <div v-if="chapter.downloaded_at" class="text-muted small mt-1">
                                                        下載時間: {{ formatDate(chapter.downloaded_at) }}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div v-else-if="downloadJobChapters && downloadJobChapters.length === 0" class="mt-3 alert alert-info">
                                    尚無已下載的章節
                                </div>
                            </div>
                            <div v-if="selectedJob.type === 'upload'">
                                <strong>檔案名稱:</strong> {{ selectedJob.originalName || selectedJob.filename }}<br>
                                <strong>檔案大小:</strong> {{ formatFileSize(selectedJob.fileSize || 0) }}
                            </div>
                            <div v-if="selectedJob.data" class="mt-3">
                                <strong>詳細資料:</strong>
                                
                                <!-- Extracted Links Section -->
                                <div v-if="selectedJob.type === 'book_search' && getAllLinks(selectedJob).length > 0" class="mt-2 mb-3">
                                    <strong>相關連結:</strong>
                                    <div class="mt-2" style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 10px; background-color: #f8f9fa;">
                                        <div v-for="(link, index) in getAllLinks(selectedJob)" :key="index" class="mb-2 p-2 rounded" :style="isSearchUrlUsed(link.url) ? 'background-color: #fff3cd; border-left: 4px solid #ffc107; padding-left: 12px;' : 'background-color: white;'">
                                            <div class="d-flex align-items-center">
                                                <span v-if="isSearchUrlUsed(link.url)" class="badge bg-warning text-dark me-2">搜尋網址</span>
                                                <span class="badge bg-secondary me-2" style="font-size: 0.75em;">{{ link.type }}</span>
                                            </div>
                                            <a 
                                                :href="link.url" 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                class="text-break d-block mt-1" 
                                                :class="isSearchUrlUsed(link.url) ? 'fw-bold' : ''"
                                                :style="isSearchUrlUsed(link.url) ? 'color: #856404; font-size: 0.9em; word-break: break-all;' : 'color: #0d6efd; font-size: 0.9em; word-break: break-all;'"
                                            >
                                                🔗 {{ link.url }}
                                            </a>
                                            <div v-if="link.description" class="text-muted small mt-1">{{ link.description }}</div>
                                        </div>
                                    </div>
                                </div>
                                
                                <pre class="bg-light p-3 rounded mt-2" style="max-height: 300px; overflow-y: auto; font-size: 12px;">{{ JSON.stringify(selectedJob.data, null, 2) }}</pre>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button 
                                v-if="selectedJob.type === 'book_search' && selectedJob.status === 'waiting_for_input' && jobSearchResults && jobSearchResults.threads && jobSearchResults.threads.length > 0"
                                type="button" 
                                class="btn btn-primary me-auto"
                                @click="reviewSearchResults(selectedJob)"
                            >
                                查看結果並下載
                            </button>
                            <button type="button" class="btn btn-secondary" @click="closeDetailsModal">
                                關閉
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Review Search Results Modal -->
            <div 
                v-if="showReviewModal && selectedJob"
                class="modal fade show"
                style="display: block; background: rgba(0,0,0,0.5); z-index: 1055;"
                @click.self="closeReviewModal"
            >
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">搜尋結果</h5>
                            <button type="button" class="btn-close" @click="closeReviewModal"></button>
                        </div>
                        <div class="modal-body">
                            <div v-if="otherWaitingJobsCount > 0" class="alert alert-info mb-3">
                                <strong>提示：</strong>還有 {{ otherWaitingJobsCount }} 個作業等待處理。
                                <button 
                                    type="button" 
                                    class="btn btn-sm btn-outline-primary ms-2"
                                    @click="closeReviewModal"
                                >
                                    返回作業列表
                                </button>
                            </div>
                            <div v-if="loadingResults" class="text-center py-4">
                                <div class="spinner-border" role="status">
                                    <span class="visually-hidden">載入中...</span>
                                </div>
                            </div>
                            <div v-else-if="searchResults">
                                <div v-if="searchResults.threads && searchResults.threads.length === 0" class="alert alert-warning">
                                    未找到任何章節
                                </div>
                                <div v-else>
                                    <div class="d-flex justify-content-between align-items-center mb-2">
                                        <div>
                                            <h6 class="mb-0">找到 {{ searchResults.threads ? searchResults.threads.length : 0 }} 個章節</h6>
                                            <small class="text-muted" v-if="selectedChapters.length > 0">
                                                已選擇 {{ selectedChapters.length }} / {{ searchResults.threads ? searchResults.threads.length : 0 }} 個
                                            </small>
                                        </div>
                                        <div class="btn-group btn-group-sm">
                                            <button 
                                                type="button" 
                                                class="btn btn-outline-primary"
                                                @click="selectAllChapters"
                                                :disabled="!searchResults.threads || searchResults.threads.length === 0"
                                            >
                                                全選
                                            </button>
                                            <button 
                                                type="button" 
                                                class="btn btn-outline-secondary"
                                                @click="deselectAllChapters"
                                                :disabled="selectedChapters.length === 0"
                                            >
                                                取消全選
                                            </button>
                                        </div>
                                    </div>
                                    <div style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 10px;">
                                        <div 
                                            v-for="(thread, index) in searchResults.threads" 
                                            :key="index"
                                            class="mb-2 p-2 border-bottom"
                                            :style="isSearchUrlUsed(thread.url) ? 'background-color: #fff3cd; border-left: 4px solid #ffc107; padding-left: 12px;' : ''"
                                        >
                                            <label class="d-flex align-items-start" style="cursor: pointer;">
                                                <input 
                                                    type="checkbox" 
                                                    :value="thread.url"
                                                    :data-chapter="thread.chapterNumber"
                                                    class="me-2 mt-1"
                                                    v-model="selectedChapters"
                                                />
                                                <div class="flex-grow-1">
                                                    <div class="fw-bold">
                                                        第{{ thread.chapterNumber }}章
                                                        <span v-if="thread.chapterFormat"> ({{ thread.chapterFormat }})</span>
                                                        <span v-if="isSearchUrlUsed(thread.url)" class="badge bg-warning text-dark ms-2" title="此連結是搜尋使用的網址">搜尋網址</span>
                                                    </div>
                                                    <div class="text-muted small mt-1">{{ thread.title || thread.titleTraditional }}</div>
                                                    <div class="text-muted small mt-1" v-if="thread.date">{{ thread.date }}</div>
                                                    <div class="mt-1" v-if="thread.url">
                                                        <a 
                                                            :href="thread.url" 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            :class="isSearchUrlUsed(thread.url) ? 'text-decoration-none fw-bold' : 'text-decoration-none'"
                                                            :style="isSearchUrlUsed(thread.url) ? 'color: #856404;' : 'color: #0d6efd;'"
                                                        >
                                                            🔗 {{ thread.url }}
                                                        </a>
                                                    </div>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button 
                                type="button" 
                                class="btn btn-outline-secondary" 
                                @click="finishJob"
                                :disabled="finishingJob"
                            >
                                <span v-if="finishingJob" class="spinner-border spinner-border-sm me-2"></span>
                                完成任務
                            </button>
                            <button type="button" class="btn btn-secondary" @click="closeReviewModal">
                                取消
                            </button>
                            <button 
                                v-if="searchResults && searchResults.threads && searchResults.threads.length > 0"
                                type="button" 
                                class="btn btn-primary" 
                                @click="createDownloadFromSearch"
                                :disabled="selectedChapters.length === 0 || creatingDownload || finishingJob"
                            >
                                <span v-if="creatingDownload" class="spinner-border spinner-border-sm me-2"></span>
                                下載選中的章節 ({{ selectedChapters.length }})
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Conflict Resolution Modal -->
            <div 
                v-if="showConflictModal && conflicts.length > 0"
                class="modal fade show"
                style="display: block; background: rgba(0,0,0,0.5);"
                @click.self="closeConflictModal"
            >
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">解決章節衝突</h5>
                            <button type="button" class="btn-close" @click="closeConflictModal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="alert alert-warning">
                                發現 {{ conflicts.length }} 個章節編號已存在於資料庫中。請為每個衝突選擇處理方式。
                            </div>
                            <div v-for="conflict in conflicts" :key="conflict.chapterNumber" class="card mb-3">
                                <div class="card-body">
                                    <h6 class="card-title">第 {{ conflict.chapterNumber }} 章</h6>
                                    <div class="mb-2">
                                        <strong>新章節：</strong><br>
                                        <span class="text-muted">{{ conflict.title }}</span><br>
                                        <small class="text-muted">URL: {{ conflict.url }}</small>
                                    </div>
                                    <div class="mb-3">
                                        <strong>現有章節：</strong><br>
                                        <span class="text-muted">{{ conflict.existingChapter.chapter_title || conflict.existingChapter.chapter_title_simplified || '無標題' }}</span><br>
                                        <span v-if="conflict.existingChapter.chapter_name" class="text-muted">{{ conflict.existingChapter.chapter_name }}</span>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">處理方式：</label>
                                        <div class="btn-group-vertical w-100" role="group">
                                            <button 
                                                type="button"
                                                class="btn"
                                                :class="conflictResolutions[conflict.chapterNumber]?.action === 'overwrite' ? 'btn-primary' : 'btn-outline-primary'"
                                                @click="setConflictAction(conflict, 'overwrite')"
                                            >
                                                覆蓋現有章節
                                            </button>
                                            <button 
                                                type="button"
                                                class="btn"
                                                :class="conflictResolutions[conflict.chapterNumber]?.action === 'discard' ? 'btn-warning' : 'btn-outline-warning'"
                                                @click="setConflictAction(conflict, 'discard')"
                                            >
                                                捨棄新章節
                                            </button>
                                            <button 
                                                type="button"
                                                class="btn"
                                                :class="conflictResolutions[conflict.chapterNumber]?.action === 'new_number' ? 'btn-info' : 'btn-outline-info'"
                                                @click="setConflictAction(conflict, 'new_number')"
                                            >
                                                使用新的章節編號
                                            </button>
                                        </div>
                                        <div v-if="conflictResolutions[conflict.chapterNumber]?.action === 'new_number'" class="mt-2">
                                            <label class="form-label">新章節編號：</label>
                                            <input 
                                                type="number" 
                                                class="form-control"
                                                v-model.number="conflictResolutions[conflict.chapterNumber].newNumber"
                                                :min="1"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" @click="closeConflictModal">
                                取消
                            </button>
                            <button 
                                type="button" 
                                class="btn btn-primary"
                                @click="resolveConflicts"
                                :disabled="resolvingConflicts"
                            >
                                <span v-if="resolvingConflicts" class="spinner-border spinner-border-sm me-2"></span>
                                確認並繼續
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Review Upload Job Modal -->
            <div 
                v-if="showUploadModal && selectedJob"
                class="modal fade show"
                style="display: block; background: rgba(0,0,0,0.5); z-index: 1055;"
                @click.self="closeUploadModal"
            >
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">確認上傳處理 - {{ selectedJob.originalName || selectedJob.filename }}</h5>
                            <button type="button" class="btn-close" @click="closeUploadModal"></button>
                        </div>
                        <div class="modal-body">
                            <div v-if="otherWaitingJobsCount > 0" class="alert alert-info mb-3">
                                <strong>提示：</strong>還有 {{ otherWaitingJobsCount }} 個作業等待處理。
                                <button 
                                    type="button" 
                                    class="btn btn-sm btn-outline-primary ms-2"
                                    @click="closeUploadModal"
                                >
                                    返回作業列表
                                </button>
                            </div>
                            <div v-if="loadingUploadDetails" class="text-center py-4">
                                <div class="spinner-border" role="status">
                                    <span class="visually-hidden">載入中...</span>
                                </div>
                            </div>
                            <div v-else-if="uploadJobDetails">
                                <div class="mb-3">
                                    <strong>檔案資訊:</strong><br>
                                    檔案名稱: {{ uploadJobDetails.original_name || uploadJobDetails.filename }}<br>
                                    檔案大小: {{ formatFileSize(uploadJobDetails.file_size || 0) }}
                                </div>

                                <!-- Book Selection -->
                                <div class="mb-3">
                                    <label class="form-label">選擇書籍：</label>
                                    <select 
                                        v-model="uploadBookSelection" 
                                        class="form-select"
                                        @change="onUploadBookSelectChange"
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
                                <div v-if="uploadBookSelection === 'new'" class="bg-light p-3 rounded mb-3">
                                    <h6 class="mb-3">新書籍資訊</h6>
                                    <div class="mb-3">
                                        <label class="form-label">書籍名稱：</label>
                                        <input 
                                            type="text" 
                                            v-model="uploadBookMetadata.bookName"
                                            class="form-control"
                                            placeholder="書籍名稱 (簡體中文)"
                                        />
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">作者：</label>
                                        <input 
                                            type="text" 
                                            v-model="uploadBookMetadata.author"
                                            class="form-control"
                                            placeholder="作者"
                                        />
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">分類：</label>
                                        <input 
                                            type="text" 
                                            v-model="uploadBookMetadata.category"
                                            class="form-control"
                                            placeholder="分類"
                                        />
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">描述：</label>
                                        <textarea 
                                            v-model="uploadBookMetadata.description"
                                            class="form-control"
                                            rows="3"
                                            placeholder="描述"
                                        ></textarea>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">來源網址：</label>
                                        <input 
                                            type="text" 
                                            v-model="uploadBookMetadata.sourceUrl"
                                            class="form-control"
                                            placeholder="來源網址"
                                        />
                                    </div>
                                </div>

                                <!-- Chapter Preview -->
                                <div v-if="uploadJobDetails.analysis_data && uploadJobDetails.analysis_data.chapters">
                                    <label class="form-label">章節預覽（前10個）：</label>
                                    <pre class="bg-light p-3 rounded" style="max-height: 200px; overflow-y: auto; font-size: 13px; white-space: pre-wrap;">{{ getUploadChapterPreview() }}</pre>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" @click="closeUploadModal">
                                取消
                            </button>
                            <button 
                                type="button" 
                                class="btn btn-primary"
                                @click="confirmUploadProcessing"
                                :disabled="processingUpload || (uploadBookSelection === 'new' && !uploadBookMetadata.bookName.trim())"
                            >
                                <span v-if="processingUpload" class="spinner-border spinner-border-sm me-2"></span>
                                確認並處理
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            jobs: [],
            loading: false,
            statusFilter: "",
            typeFilter: "",
            autoRefresh: true,
            refreshInterval: null,
            autoSearchEnabled: false,
            selectedJobs: [],
            deletingJobs: false,
            showDetailsModal: false,
            showReviewModal: false,
            showUploadModal: false,
            selectedJob: null,
            loadingResults: false,
            searchResults: null,
            selectedChapters: [],
            creatingDownload: false,
            finishingJob: false,
            loadingUploadDetails: false,
            uploadJobDetails: null,
            uploadBookSelection: "new",
            uploadBookMetadata: {
                bookName: "",
                author: "",
                category: "",
                description: "",
                sourceUrl: "",
            },
            allBooks: [],
            processingUpload: false,
            showConflictModal: false,
            conflicts: [],
            conflictResolutions: {},
            resolvingConflicts: false,
            jobSearchResults: null,
            loadingJobSearchResults: false,
            jobSearchResultsError: null,
            downloadJobChapters: null,
            loadingDownloadChapters: false,
        };
    },
    mounted() {
        // Load auto search preference from localStorage (default: false)
        const savedAutoSearch = localStorage.getItem("autoSearchEnabled");
        this.autoSearchEnabled = savedAutoSearch === "true";

        this.loadJobs();
        this.loadBooks();
        this.startAutoRefresh();

        // Update backend with current preference
        this.updateAutoSearchService();
    },
    beforeDestroy() {
        this.stopAutoRefresh();
    },
    methods: {
        async loadJobs() {
            this.loading = true;
            try {
                const params = new URLSearchParams();
                if (this.statusFilter)
                    params.append("status", this.statusFilter);
                if (this.typeFilter) params.append("type", this.typeFilter);
                params.append("limit", "50");

                const response = await window.API.getAllJobs(params.toString());
                this.jobs = response.jobs || [];
            } catch (error) {
                console.error("Error loading jobs:", error);
                alert("載入作業失敗: " + (error.message || "Unknown error"));
            } finally {
                this.loading = false;
            }
        },
        startAutoRefresh() {
            if (this.refreshInterval) return;
            this.refreshInterval = setInterval(() => {
                if (this.autoRefresh && !this.loading) {
                    this.loadJobs();
                }
            }, 5000);
        },
        stopAutoRefresh() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
        },
        getJobTypeName(type) {
            const names = {
                book_search: "章節搜尋",
                download: "下載",
                chunk: "分塊",
                joplin: "Joplin 同步",
                sync_structure: "同步結構",
                source_sync: "來源同步",
                source_import: "來源匯入",
                sync_books: "同步書籍",
            };
            return names[type] || type;
        },
        getStatusName(status) {
            const names = {
                queued: "排隊中",
                processing: "處理中",
                waiting_for_input: "等待輸入",
                completed: "已完成",
                failed: "失敗",
            };
            return names[status] || status;
        },
        getStatusBadgeClass(status) {
            const classes = {
                queued: "bg-secondary",
                processing: "bg-primary",
                waiting_for_input: "bg-warning",
                completed: "bg-success",
                failed: "bg-danger",
            };
            return classes[status] || "bg-secondary";
        },
        getSearchName(job) {
            if (!job) return null;

            // Helper to parse searchParams if it's a string
            const parseSearchParams = (params) => {
                if (!params) return null;
                if (typeof params === "string") {
                    try {
                        return JSON.parse(params);
                    } catch (e) {
                        return null;
                    }
                }
                return params;
            };

            // Try to get search name from searchParams
            let searchParams = parseSearchParams(job.searchParams);
            if (searchParams && searchParams.bookName) {
                return searchParams.bookName;
            }

            // Try from data.searchParams
            if (job.data) {
                searchParams = parseSearchParams(job.data.searchParams);
                if (searchParams && searchParams.bookName) {
                    return searchParams.bookName;
                }
            }

            return null;
        },
        getSearchUrls(job) {
            if (!job) return [];
            // Check multiple possible locations for search URLs
            let urls = [];

            // Try to parse results if it's a string
            if (job.data && job.data.results) {
                if (typeof job.data.results === "string") {
                    try {
                        const parsed = JSON.parse(job.data.results);
                        if (
                            parsed.searchUrls &&
                            Array.isArray(parsed.searchUrls)
                        ) {
                            urls = parsed.searchUrls;
                        }
                    } catch (e) {
                        // If parsing fails, try direct access
                        if (job.data.results.searchUrls) {
                            urls = job.data.results.searchUrls;
                        }
                    }
                } else if (
                    job.data.results.searchUrls &&
                    Array.isArray(job.data.results.searchUrls)
                ) {
                    urls = job.data.results.searchUrls;
                }
            }

            // Also check job.results directly
            if (job.results) {
                if (typeof job.results === "string") {
                    try {
                        const parsed = JSON.parse(job.results);
                        if (
                            parsed.searchUrls &&
                            Array.isArray(parsed.searchUrls)
                        ) {
                            urls = [...urls, ...parsed.searchUrls];
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                } else if (
                    job.results.searchUrls &&
                    Array.isArray(job.results.searchUrls)
                ) {
                    urls = [...urls, ...job.results.searchUrls];
                }
            }

            // Remove duplicates
            return [...new Set(urls)];
        },
        getAllLinks(job) {
            if (!job || job.type !== "book_search") return [];

            const links = [];
            let parsedResults = null;

            // Parse results if it's a string
            if (job.data && job.data.results) {
                if (typeof job.data.results === "string") {
                    try {
                        parsedResults = JSON.parse(job.data.results);
                    } catch (e) {
                        // If parsing fails, try direct access
                        parsedResults = job.data.results;
                    }
                } else {
                    parsedResults = job.data.results;
                }
            } else if (job.results) {
                if (typeof job.results === "string") {
                    try {
                        parsedResults = JSON.parse(job.results);
                    } catch (e) {
                        parsedResults = job.results;
                    }
                } else {
                    parsedResults = job.results;
                }
            }

            if (!parsedResults) return [];

            // Extract search URLs
            if (
                parsedResults.searchUrls &&
                Array.isArray(parsedResults.searchUrls)
            ) {
                parsedResults.searchUrls.forEach((url, index) => {
                    links.push({
                        url: url,
                        type: "搜尋網址",
                        description: `搜尋使用的網址 #${index + 1}`,
                        isSearchUrl: true,
                    });
                });
            }

            // Extract thread URLs from foundChapters
            if (
                parsedResults.foundChapters &&
                Array.isArray(parsedResults.foundChapters)
            ) {
                parsedResults.foundChapters.forEach((chapter) => {
                    if (chapter.url) {
                        links.push({
                            url: chapter.url,
                            type: "章節連結",
                            description:
                                chapter.title ||
                                chapter.titleTraditional ||
                                `第${chapter.chapterNumber || "?"}章`,
                            isSearchUrl: false,
                        });
                    }
                });
            }

            // Also check if there's a threads array
            if (parsedResults.threads && Array.isArray(parsedResults.threads)) {
                parsedResults.threads.forEach((thread) => {
                    if (thread.url) {
                        // Check if we already have this URL
                        const exists = links.some(
                            (link) => link.url === thread.url
                        );
                        if (!exists) {
                            links.push({
                                url: thread.url,
                                type: "章節連結",
                                description:
                                    thread.title ||
                                    thread.titleTraditional ||
                                    `第${thread.chapterNumber || "?"}章`,
                                isSearchUrl: false,
                            });
                        }
                    }
                });
            }

            return links;
        },
        isSearchUrlUsed(url) {
            if (!url || !this.selectedJob) return false;
            const searchUrls = this.getSearchUrls(this.selectedJob);
            // Normalize URLs for comparison (remove trailing slashes, convert to lowercase)
            const normalizeUrl = (u) => {
                if (!u) return "";
                return u.toString().toLowerCase().replace(/\/$/, "");
            };
            const normalizedUrl = normalizeUrl(url);
            return searchUrls.some(
                (searchUrl) => normalizeUrl(searchUrl) === normalizedUrl
            );
        },
        formatDate(dateString) {
            if (!dateString) return "";
            const date = new Date(dateString);
            return date.toLocaleString("zh-TW");
        },
        formatFileSize(bytes) {
            if (!bytes) return "0 B";
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
            return (bytes / (1024 * 1024)).toFixed(2) + " MB";
        },
        isJobSelected(job) {
            return this.selectedJobs.some(
                (j) => j.type === job.type && j.id === job.id
            );
        },
        toggleJobSelection(job) {
            const index = this.selectedJobs.findIndex(
                (j) => j.type === job.type && j.id === job.id
            );
            if (index > -1) {
                this.selectedJobs.splice(index, 1);
            } else {
                this.selectedJobs.push({ type: job.type, id: job.id });
            }
        },
        toggleSelectAll() {
            if (this.allJobsSelected) {
                // Deselect all
                this.selectedJobs = [];
            } else {
                // Select all
                this.selectedJobs = this.jobs.map((job) => ({
                    type: job.type,
                    id: job.id,
                }));
            }
        },
        async bulkDeleteJobs() {
            if (this.selectedJobs.length === 0) {
                return;
            }

            if (
                !confirm(
                    `確定要刪除選取的 ${this.selectedJobs.length} 個作業嗎？`
                )
            ) {
                return;
            }

            this.deletingJobs = true;
            let successCount = 0;
            let failCount = 0;

            try {
                const deletePromises = this.selectedJobs.map((job) =>
                    window.API.deleteJob(job.type, job.id)
                        .then(() => {
                            successCount++;
                        })
                        .catch(() => {
                            failCount++;
                        })
                );

                await Promise.all(deletePromises);

                this.selectedJobs = [];
                this.loadJobs();

                if (failCount === 0) {
                    alert(`已成功刪除 ${successCount} 個作業`);
                } else {
                    alert(`已刪除 ${successCount} 個，失敗 ${failCount} 個`);
                }
            } catch (error) {
                console.error("Error bulk deleting jobs:", error);
                alert("批量刪除失敗: " + (error.message || "Unknown error"));
            } finally {
                this.deletingJobs = false;
            }
        },
        async showJobDetails(job) {
            this.selectedJob = job;
            this.showDetailsModal = true;
            this.jobSearchResults = null;
            this.jobSearchResultsError = null;
            this.downloadJobChapters = null;

            // Load search results for book_search jobs
            if (
                job.type === "book_search" &&
                (job.status === "completed" ||
                    job.status === "waiting_for_input")
            ) {
                this.loadingJobSearchResults = true;
                try {
                    const results = await window.API.getBookSearchResults(
                        job.bookId,
                        job.id
                    );
                    this.jobSearchResults = results;
                } catch (error) {
                    console.error("Error loading search results:", error);
                    this.jobSearchResultsError = error.message || "載入失敗";
                } finally {
                    this.loadingJobSearchResults = false;
                }
            }

            // Load chapters for download jobs
            if (job.type === "download") {
                this.loadingDownloadChapters = true;
                try {
                    const jobDetails = await window.API.getJob(
                        "download",
                        job.id
                    );
                    this.downloadJobChapters = jobDetails.chapters || [];
                } catch (error) {
                    console.error(
                        "Error loading download job chapters:",
                        error
                    );
                } finally {
                    this.loadingDownloadChapters = false;
                }
            }
        },
        closeDetailsModal() {
            this.showDetailsModal = false;
            this.selectedJob = null;
            this.jobSearchResults = null;
            this.jobSearchResultsError = null;
            this.loadingJobSearchResults = false;
            this.downloadJobChapters = null;
            this.loadingDownloadChapters = false;
        },
        async loadBooks() {
            try {
                this.allBooks = await window.API.getBooks();
            } catch (error) {
                console.error("Error loading books:", error);
            }
        },
        async reviewUploadJob(job) {
            this.selectedJob = job;
            this.showUploadModal = true;
            this.loadingUploadDetails = true;
            this.uploadJobDetails = null;
            this.uploadBookSelection = "new";
            this.uploadBookMetadata = {
                bookName: "",
                author: "",
                category: "",
                description: "",
                sourceUrl: "",
            };

            try {
                // Fetch full job details
                const details = await window.API.getJob("upload", job.id);
                this.uploadJobDetails = details;

                // Populate form with analysis data if available
                if (details.analysis_data) {
                    const analysis = details.analysis_data;
                    this.uploadBookMetadata.bookName =
                        analysis.bookNameSimplified || "";
                    this.uploadBookMetadata.author =
                        analysis.metadata?.author || "";
                    this.uploadBookMetadata.category =
                        analysis.metadata?.category || "";
                    this.uploadBookMetadata.description =
                        analysis.metadata?.description || "";
                    this.uploadBookMetadata.sourceUrl =
                        analysis.metadata?.sourceUrl || "";

                    // Check for matched books
                    if (
                        analysis.matchedBooks &&
                        analysis.matchedBooks.length > 0
                    ) {
                        this.uploadBookSelection = analysis.matchedBooks[0].id;
                    }
                }
            } catch (error) {
                console.error("Error loading upload job details:", error);
                alert(
                    "載入上傳作業詳情失敗: " +
                        (error.message || "Unknown error")
                );
            } finally {
                this.loadingUploadDetails = false;
            }
        },
        closeUploadModal() {
            this.showUploadModal = false;
            this.selectedJob = null;
            this.uploadJobDetails = null;
            this.uploadBookSelection = "new";
            this.uploadBookMetadata = {
                bookName: "",
                author: "",
                category: "",
                description: "",
                sourceUrl: "",
            };
        },
        onUploadBookSelectChange() {
            // Form visibility is handled by v-if in template
        },
        getUploadChapterPreview() {
            if (
                !this.uploadJobDetails ||
                !this.uploadJobDetails.analysis_data ||
                !this.uploadJobDetails.analysis_data.chapters
            ) {
                return "無章節資訊";
            }

            const chapters = this.uploadJobDetails.analysis_data.chapters.slice(
                0,
                10
            );
            let preview = chapters
                .map((ch, idx) => {
                    const title = ch.titleTraditional || ch.title || "";
                    return `${idx + 1}. ${title}`;
                })
                .join("\n");

            if (this.uploadJobDetails.analysis_data.totalChapters > 10) {
                preview += `\n... 還有 ${
                    this.uploadJobDetails.analysis_data.totalChapters - 10
                } 個章節`;
            }

            return preview;
        },
        async confirmUploadProcessing() {
            if (!this.selectedJob || !this.uploadJobDetails) {
                return;
            }

            if (
                this.uploadBookSelection === "new" &&
                !this.uploadBookMetadata.bookName.trim()
            ) {
                alert("請輸入新書籍名稱");
                return;
            }

            this.processingUpload = true;
            try {
                let bookId =
                    this.uploadBookSelection === "new"
                        ? null
                        : parseInt(this.uploadBookSelection);
                let bookName = null;
                let bookMetadata = null;

                if (this.uploadBookSelection === "new") {
                    bookName = this.uploadBookMetadata.bookName.trim();
                    bookMetadata = {
                        author: this.uploadBookMetadata.author.trim() || null,
                        category:
                            this.uploadBookMetadata.category.trim() || null,
                        description:
                            this.uploadBookMetadata.description.trim() || null,
                        sourceUrl:
                            this.uploadBookMetadata.sourceUrl.trim() || null,
                    };
                }

                // Update job with user input and start processing
                const result = await window.API.confirmUploadJob(
                    this.selectedJob.id,
                    {
                        bookId,
                        bookName,
                        bookMetadata,
                    }
                );

                alert("上傳作業已開始處理");
                this.closeUploadModal();
                this.loadJobs();
            } catch (error) {
                console.error("Error confirming upload processing:", error);
                alert("確認處理失敗: " + (error.message || "Unknown error"));
            } finally {
                this.processingUpload = false;
            }
        },
        async reviewSearchResults(job) {
            // Close details modal if open
            if (this.showDetailsModal) {
                this.closeDetailsModal();
            }

            this.selectedJob = job;
            this.showReviewModal = true;
            this.loadingResults = true;
            this.searchResults = null;
            this.selectedChapters = [];

            try {
                // Fetch search results
                const results = await window.API.getBookSearchResults(
                    job.bookId,
                    job.id
                );
                this.searchResults = results;
            } catch (error) {
                console.error("Error loading search results:", error);
                alert(
                    "載入搜尋結果失敗: " + (error.message || "Unknown error")
                );
            } finally {
                this.loadingResults = false;
            }
        },
        closeReviewModal() {
            this.showReviewModal = false;
            this.selectedJob = null;
            this.searchResults = null;
            this.selectedChapters = [];
        },
        async finishJob() {
            if (!this.selectedJob) {
                return;
            }

            if (
                !confirm(
                    "確定要完成這個搜尋任務嗎？任務將被標記為已完成，不會建立下載任務。"
                )
            ) {
                return;
            }

            this.finishingJob = true;
            try {
                await window.API.finishBookSearchJob(this.selectedJob.id);
                alert("任務已標記為已完成");
                this.closeReviewModal();
                this.loadJobs();
            } catch (error) {
                console.error("Error finishing job:", error);
                alert("完成任務失敗: " + (error.message || "Unknown error"));
            } finally {
                this.finishingJob = false;
            }
        },
        selectAllChapters() {
            if (!this.searchResults || !this.searchResults.threads) {
                return;
            }
            // Select all chapter URLs
            this.selectedChapters = this.searchResults.threads.map(
                (thread) => thread.url
            );
        },
        deselectAllChapters() {
            this.selectedChapters = [];
        },
        async createDownloadFromSearch() {
            if (!this.selectedJob || this.selectedChapters.length === 0) {
                return;
            }

            // Get selected chapter data from search results
            const selectedChapterData = [];

            // Get chapter data from selected checkboxes
            const modal = document.querySelector(".modal.show");
            if (modal) {
                const checkboxes = modal.querySelectorAll(
                    'input[type="checkbox"]:checked'
                );
                for (const checkbox of checkboxes) {
                    const url = checkbox.value;
                    const chapterNumber = parseInt(checkbox.dataset.chapter);
                    const thread = this.searchResults.threads.find(
                        (t) =>
                            t.url === url && t.chapterNumber === chapterNumber
                    );
                    if (thread) {
                        selectedChapterData.push({
                            url: thread.url,
                            title:
                                thread.title || thread.titleTraditional || "",
                            chapterNumber: thread.chapterNumber,
                        });
                    }
                }
            }

            if (selectedChapterData.length === 0) {
                alert("請至少選擇一個章節");
                return;
            }

            this.creatingDownload = true;
            try {
                const result = await window.API.createDownloadFromSearch(
                    this.selectedJob.id,
                    selectedChapterData,
                    Object.keys(this.conflictResolutions).length > 0
                        ? this.conflictResolutions
                        : null
                );

                // Check if there are conflicts
                if (result.hasConflicts) {
                    this.conflicts = result.conflicts;
                    this.conflictResolutions = {};
                    // Initialize resolutions
                    for (const conflict of this.conflicts) {
                        this.conflictResolutions[conflict.chapterNumber] = {
                            action: null,
                            newNumber: null,
                        };
                    }
                    this.showConflictModal = true;
                    this.creatingDownload = false;
                    return;
                }

                // No conflicts, proceed
                alert(`下載任務已建立 (任務 ID: ${result.downloadJobId})`);
                this.closeReviewModal();
                this.loadJobs();
            } catch (error) {
                console.error("Error creating download:", error);
                alert(
                    "建立下載任務失敗: " + (error.message || "Unknown error")
                );
            } finally {
                this.creatingDownload = false;
            }
        },
        async resolveConflicts() {
            // Validate all conflicts have resolutions
            for (const conflict of this.conflicts) {
                const resolution =
                    this.conflictResolutions[conflict.chapterNumber];
                if (!resolution || !resolution.action) {
                    alert(`請為第 ${conflict.chapterNumber} 章選擇處理方式`);
                    return;
                }
                if (
                    resolution.action === "new_number" &&
                    !resolution.newNumber
                ) {
                    alert(
                        `請為第 ${conflict.chapterNumber} 章輸入新的章節編號`
                    );
                    return;
                }
            }

            this.resolvingConflicts = true;
            try {
                // Get selected chapter data again
                const selectedChapterData = [];
                const modal = document.querySelector(".modal.show");
                if (modal) {
                    const checkboxes = modal.querySelectorAll(
                        'input[type="checkbox"]:checked'
                    );
                    for (const checkbox of checkboxes) {
                        const url = checkbox.value;
                        const chapterNumber = parseInt(
                            checkbox.dataset.chapter
                        );
                        const thread = this.searchResults.threads.find(
                            (t) =>
                                t.url === url &&
                                t.chapterNumber === chapterNumber
                        );
                        if (thread) {
                            selectedChapterData.push({
                                url: thread.url,
                                title:
                                    thread.title ||
                                    thread.titleTraditional ||
                                    "",
                                chapterNumber: thread.chapterNumber,
                            });
                        }
                    }
                }

                const result = await window.API.createDownloadFromSearch(
                    this.selectedJob.id,
                    selectedChapterData,
                    this.conflictResolutions
                );

                if (result.hasConflicts) {
                    alert("仍有未解決的衝突，請檢查");
                    return;
                }

                alert(`下載任務已建立 (任務 ID: ${result.downloadJobId})`);
                this.closeConflictModal();
                this.closeReviewModal();
                this.loadJobs();
            } catch (error) {
                console.error("Error resolving conflicts:", error);
                alert(
                    "建立下載任務失敗: " + (error.message || "Unknown error")
                );
            } finally {
                this.resolvingConflicts = false;
            }
        },
        closeConflictModal() {
            this.showConflictModal = false;
            this.conflicts = [];
            this.conflictResolutions = {};
        },
        async getNextAvailableChapterNumber(bookId, startFrom = 1) {
            try {
                const chapters = await window.API.getBookChapters(bookId);
                const existingNumbers = new Set(
                    chapters
                        .filter(
                            (ch) =>
                                ch.chapter_number !== null &&
                                ch.chapter_number !== undefined
                        )
                        .map((ch) => ch.chapter_number)
                );
                let nextNumber = startFrom;
                while (existingNumbers.has(nextNumber)) {
                    nextNumber++;
                }
                return nextNumber;
            } catch (error) {
                console.error("Error getting next chapter number:", error);
                return startFrom;
            }
        },
        async setConflictAction(conflict, action) {
            if (!this.conflictResolutions[conflict.chapterNumber]) {
                this.conflictResolutions[conflict.chapterNumber] = {};
            }
            this.conflictResolutions[conflict.chapterNumber].action = action;

            if (action === "new_number") {
                // Auto-suggest next available number
                const nextNumber = await this.getNextAvailableChapterNumber(
                    this.selectedJob.bookId,
                    conflict.chapterNumber
                );
                this.conflictResolutions[conflict.chapterNumber].newNumber =
                    nextNumber;
            } else {
                this.conflictResolutions[conflict.chapterNumber].newNumber =
                    null;
            }
        },
        async retryJob(job) {
            if (!confirm("確定要重試這個作業嗎？")) {
                return;
            }

            try {
                await window.API.retryJob(job.type, job.id);
                alert("作業已重新加入佇列");
                this.loadJobs();
            } catch (error) {
                console.error("Error retrying job:", error);
                alert("重試失敗: " + (error.message || "Unknown error"));
            }
        },
        async deleteJob(job) {
            if (!confirm("確定要刪除這個作業嗎？")) {
                return;
            }

            try {
                await window.API.deleteJob(job.type, job.id);
                alert("作業已刪除");
                this.loadJobs();
            } catch (error) {
                console.error("Error deleting job:", error);
                alert("刪除失敗: " + (error.message || "Unknown error"));
            }
        },
        toggleAutoSearch() {
            // Save preference to localStorage
            localStorage.setItem(
                "autoSearchEnabled",
                this.autoSearchEnabled.toString()
            );
            // Update backend service
            this.updateAutoSearchService();
        },
        async updateAutoSearchService() {
            try {
                await window.API.setAutoSearchEnabled(this.autoSearchEnabled);
            } catch (error) {
                console.error("Error updating auto search service:", error);
                // Don't show alert, just log the error
            }
        },
    },
    computed: {
        allJobsSelected() {
            if (this.jobs.length === 0) return false;
            return (
                this.selectedJobs.length === this.jobs.length &&
                this.jobs.every((job) =>
                    this.selectedJobs.some(
                        (j) => j.type === job.type && j.id === job.id
                    )
                )
            );
        },
        otherWaitingJobsCount() {
            if (!this.selectedJob) return 0;
            return this.jobs.filter(
                (job) =>
                    job.status === "waiting_for_input" &&
                    !(
                        job.type === this.selectedJob.type &&
                        job.id === this.selectedJob.id
                    )
            ).length;
        },
        waitingForInputCount() {
            return this.jobs.filter((job) => job.status === "waiting_for_input")
                .length;
        },
    },
    watch: {
        autoRefresh(newVal) {
            if (newVal) {
                this.startAutoRefresh();
            } else {
                this.stopAutoRefresh();
            }
        },
    },
});
