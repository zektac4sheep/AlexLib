// JoplinTab Component
Vue.component("joplin-tab", {
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">Joplin 整合</h3>

            <!-- Connection Settings -->
            <div class="card mb-4">
                <div class="card-header">
                    <h5 class="mb-0">連線設定</h5>
                </div>
                <div class="card-body">
                    <div class="row mb-3">
                        <div class="col-md-3">
                            <label for="joplinPort" class="form-label">Port</label>
                            <input 
                                type="number" 
                                class="form-control" 
                                id="joplinPort" 
                                v-model="connectionSettings.port"
                                placeholder="41184"
                                @blur="saveConnectionSettings"
                            />
                        </div>
                        <div class="col-md-9">
                            <label for="joplinToken" class="form-label">Token</label>
                            <div class="input-group">
                                <input 
                                    type="password" 
                                    class="form-control" 
                                    id="joplinToken" 
                                    v-model="connectionSettings.token"
                                    placeholder="Enter Joplin API token"
                                    @blur="saveConnectionSettings"
                                />
                                <button 
                                    class="btn btn-outline-secondary" 
                                    type="button"
                                    @click="toggleTokenVisibility"
                                >
                                    <span v-if="showToken">隱藏</span>
                                    <span v-else>顯示</span>
                                </button>
                            </div>
                            <div class="form-check mt-2">
                                <input 
                                    class="form-check-input" 
                                    type="checkbox" 
                                    id="rememberToken"
                                    v-model="rememberToken"
                                    @change="saveConnectionSettings"
                                />
                                <label class="form-check-label" for="rememberToken">
                                    記住 Token
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex gap-2">
                        <button 
                            class="btn btn-primary" 
                            @click="testConnection"
                            :disabled="testingConnection || !connectionSettings.token"
                        >
                            <span v-if="testingConnection" class="spinner-border spinner-border-sm me-2"></span>
                            測試連線
                        </button>
                        <div v-if="connectionStatus !== null" class="align-self-center ms-2">
                            <span 
                                :class="['badge', connectionStatus ? 'bg-success' : 'bg-danger']"
                            >
                                {{ connectionStatus ? '已連線' : '連線失敗' }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Sync Actions -->
            <div class="card mb-4">
                <div class="card-header">
                    <h5 class="mb-0">同步操作</h5>
                </div>
                <div class="card-body">
                    <div class="d-flex flex-column gap-2">
                        <button 
                            class="btn btn-outline-primary" 
                            @click="startSyncStructure"
                            :disabled="!connectionSettings.token || syncingStructure"
                        >
                            <span v-if="syncingStructure" class="spinner-border spinner-border-sm me-2"></span>
                            同步 Joplin 結構到資料庫
                        </button>
                        <button 
                            class="btn btn-outline-primary" 
                            @click="startSyncBooks"
                            :disabled="!connectionSettings.token || syncingBooks"
                        >
                            <span v-if="syncingBooks" class="spinner-border spinner-border-sm me-2"></span>
                            同步所有標記的書籍到 Joplin
                        </button>
                        <button 
                            class="btn btn-outline-success" 
                            @click="startSyncTaggedBooks"
                            :disabled="!connectionSettings.token || syncingTaggedBooks"
                        >
                            <span v-if="syncingTaggedBooks" class="spinner-border spinner-border-sm me-2"></span>
                            同步所有有標籤的書籍到 Joplin
                        </button>
                    </div>
                </div>
            </div>

            <!-- Book Management -->
            <div class="card mb-4">
                <div class="card-header">
                    <h5 class="mb-0">書籍管理</h5>
                </div>
                <div class="card-body">
                    <div class="mb-3">
                        <label for="bookSelect" class="form-label">選擇書籍</label>
                        <select 
                            class="form-select" 
                            id="bookSelect" 
                            v-model="selectedBookId"
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
                    <button 
                        class="btn btn-warning" 
                        @click="recreateBookFolder"
                        :disabled="!connectionSettings.token || !selectedBookId || recreatingFolder"
                    >
                        <span v-if="recreatingFolder" class="spinner-border spinner-border-sm me-2"></span>
                        移除並重新建立書籍資料夾
                    </button>
                </div>
            </div>

            <!-- Sync Structure Display -->
            <div class="card mb-4">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">同步結構</h5>
                    <button 
                        class="btn btn-sm btn-outline-secondary" 
                        @click="loadSyncStructure"
                        :disabled="loadingStructure"
                    >
                        <span v-if="loadingStructure" class="spinner-border spinner-border-sm me-1"></span>
                        重新整理
                    </button>
                </div>
                <div class="card-body">
                    <div v-if="loadingStructure" class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">載入中...</span>
                        </div>
                    </div>
                    <div v-else-if="treeData.length === 0" class="text-muted">
                        尚未同步結構，請先點擊「同步 Joplin 結構到資料庫」
                    </div>
                    <div v-else class="sync-structure-tree">
                        <tree-node
                            v-for="node in treeData"
                            :key="node.id"
                            :node="node"
                            :expanded-folders="expandedFolders"
                            @toggle-folder="toggleFolder"
                        ></tree-node>
                    </div>
                </div>
            </div>

            <!-- Job Status -->
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">作業狀態</h5>
                    <button 
                        class="btn btn-sm btn-outline-secondary" 
                        @click="refreshJobs"
                        :disabled="loadingJobs"
                    >
                        <span v-if="loadingJobs" class="spinner-border spinner-border-sm me-1"></span>
                        重新整理
                    </button>
                </div>
                <div class="card-body">
                    <div v-if="jobs.length === 0" class="text-muted">
                        尚無作業
                    </div>
                    <div v-else>
                        <div 
                            v-for="job in jobs" 
                            :key="job.id" 
                            class="mb-3 p-3 border rounded"
                        >
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                    <strong>{{ getJobTypeName(job.job_type) }}</strong>
                                    <span 
                                        :class="['badge ms-2', getStatusBadgeClass(job.status)]"
                                    >
                                        {{ getStatusName(job.status) }}
                                    </span>
                                </div>
                                <small class="text-muted">{{ formatDate(job.created_at) }}</small>
                            </div>
                            <div v-if="job.status === 'processing' && job.total_items > 0" class="mb-2">
                                <div class="progress" style="height: 20px;">
                                    <div 
                                        class="progress-bar" 
                                        :style="{ width: (job.completed_items / job.total_items * 100) + '%' }"
                                    >
                                        {{ job.completed_items }} / {{ job.total_items }}
                                    </div>
                                </div>
                            </div>
                            <div v-if="job.error_message" class="text-danger small">
                                錯誤: {{ job.error_message }}
                            </div>
                            <div v-if="job.completed_at" class="text-muted small">
                                完成時間: {{ formatDate(job.completed_at) }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    data() {
        return {
            connectionSettings: {
                port: 41184,
                token: "",
            },
            rememberToken: true,
            showToken: false,
            testingConnection: false,
            connectionStatus: null,
            syncingStructure: false,
            syncingBooks: false,
            syncingTaggedBooks: false,
            recreatingFolder: false,
            selectedBookId: "",
            books: [],
            jobs: [],
            loadingJobs: false,
            jobRefreshInterval: null,
            folders: [],
            notes: [],
            loadingStructure: false,
            expandedFolders: {},
        };
    },
    computed: {
        structureTree() {
            // Build tree structure from folders (only root folders)
            return this.folders.filter(
                (f) => !f.parent_id || f.parent_id === ""
            );
        },
        treeData() {
            // Transform flat folders and notes arrays into nested tree structure
            if (!this.folders.length && !this.notes.length) {
                return [];
            }

            // Helper function to check if a parent_id is root
            const isRootParent = (parentId) => {
                return !parentId || parentId === "";
            };

            // Helper function to build tree recursively
            const buildTree = (parentId) => {
                const children = [];

                // Add child folders
                const childFolders = this.folders.filter((f) => {
                    if (isRootParent(parentId)) {
                        // For root, match both null and empty string
                        return isRootParent(f.parent_id);
                    } else {
                        return f.parent_id === parentId;
                    }
                });

                for (const folder of childFolders) {
                    const folderNode = {
                        id: folder.id,
                        name: folder.title,
                        type: "folder",
                        children: buildTree(folder.id), // Recursively build children
                        noteCount: this.getFolderNoteCount(folder.id),
                    };
                    children.push(folderNode);
                }

                // Add notes in this folder
                const folderNotes = this.notes.filter((n) => {
                    if (isRootParent(parentId)) {
                        // For root, match both null and empty string
                        return isRootParent(n.parent_id);
                    } else {
                        return n.parent_id === parentId;
                    }
                });

                for (const note of folderNotes) {
                    const noteNode = {
                        id: note.id,
                        name: note.title || "(無標題)",
                        type: "note",
                        metadata: {
                            updated_time: note.updated_time,
                        },
                    };
                    children.push(noteNode);
                }

                return children;
            };

            // Build tree starting from root
            return buildTree(null);
        },
    },
    mounted() {
        // Load saved connection settings from localStorage
        this.loadConnectionSettings();
        this.loadBooks();
        this.refreshJobs();
        this.loadSyncStructure();
        // Auto-refresh jobs every 3 seconds
        this.jobRefreshInterval = setInterval(() => {
            this.refreshJobs();
        }, 3000);
    },
    beforeDestroy() {
        if (this.jobRefreshInterval) {
            clearInterval(this.jobRefreshInterval);
        }
    },
    methods: {
        loadConnectionSettings() {
            try {
                const savedPort = localStorage.getItem("joplin_port");
                const savedToken = localStorage.getItem("joplin_token");
                const savedRememberToken = localStorage.getItem(
                    "joplin_remember_token"
                );

                if (savedPort) {
                    this.connectionSettings.port = parseInt(savedPort) || 41184;
                }

                // Load remember token preference (default to true if not set)
                this.rememberToken =
                    savedRememberToken !== null
                        ? savedRememberToken === "true"
                        : true;

                // Only load token if remember token is enabled
                if (this.rememberToken && savedToken) {
                    this.connectionSettings.token = savedToken;
                }
            } catch (error) {
                console.error("Error loading connection settings:", error);
            }
        },
        saveConnectionSettings() {
            try {
                localStorage.setItem(
                    "joplin_port",
                    this.connectionSettings.port.toString()
                );
                localStorage.setItem(
                    "joplin_remember_token",
                    this.rememberToken.toString()
                );

                if (this.rememberToken && this.connectionSettings.token) {
                    localStorage.setItem(
                        "joplin_token",
                        this.connectionSettings.token
                    );
                } else {
                    // Remove token from storage if remember is disabled
                    localStorage.removeItem("joplin_token");
                }
            } catch (error) {
                console.error("Error saving connection settings:", error);
            }
        },
        toggleTokenVisibility() {
            this.showToken = !this.showToken;
            const input = document.getElementById("joplinToken");
            if (input) {
                input.type = this.showToken ? "text" : "password";
            }
        },
        async testConnection() {
            this.testingConnection = true;
            this.connectionStatus = null;
            try {
                const result = await window.API.testJoplinConnection(
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                this.connectionStatus = result.connected;
                if (result.connected) {
                    // Save settings on successful connection
                    this.saveConnectionSettings();
                }
            } catch (error) {
                console.error("Error testing connection:", error);
                this.connectionStatus = false;
                alert("連線測試失敗: " + (error.message || "Unknown error"));
            } finally {
                this.testingConnection = false;
            }
        },
        async startSyncStructure() {
            if (!this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            // Save settings before starting sync
            this.saveConnectionSettings();

            this.syncingStructure = true;
            try {
                const result = await window.API.syncJoplinStructure(
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                alert("同步結構作業已開始 (Job ID: " + result.jobId + ")");
                this.refreshJobs();
                // Start polling for job completion to refresh structure
                this.pollForSyncCompletion(result.jobId);
            } catch (error) {
                console.error("Error starting sync structure:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg =
                        "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                }
                alert("啟動同步結構作業失敗: " + errorMsg);
            } finally {
                this.syncingStructure = false;
            }
        },
        async pollForSyncCompletion(jobId) {
            // Poll every 2 seconds for up to 5 minutes
            const maxAttempts = 150;
            let attempts = 0;
            const pollInterval = setInterval(async () => {
                attempts++;
                try {
                    const job = await window.API.getJoplinJob(jobId);
                    if (job.status === "completed" || job.status === "failed") {
                        clearInterval(pollInterval);
                        if (job.status === "completed") {
                            this.loadSyncStructure();
                        }
                    }
                } catch (error) {
                    console.error("Error polling job status:", error);
                }
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                }
            }, 2000);
        },
        async loadSyncStructure() {
            this.loadingStructure = true;
            try {
                const [folders, notes] = await Promise.all([
                    window.API.getJoplinFolders(),
                    window.API.getJoplinNotes(1000), // Get more notes
                ]);
                this.folders = folders || [];
                this.notes = notes || [];
            } catch (error) {
                console.error("Error loading sync structure:", error);
            } finally {
                this.loadingStructure = false;
            }
        },
        toggleFolder(folderId) {
            this.$set(
                this.expandedFolders,
                folderId,
                !this.expandedFolders[folderId]
            );
        },
        getChildFolders(parentId) {
            return this.folders.filter((f) => f.parent_id === parentId);
        },
        getFolderNotes(folderId) {
            return this.notes.filter((n) => n.parent_id === folderId);
        },
        getFolderNoteCount(folderId) {
            // Count notes in this folder and all subfolders
            let count = this.getFolderNotes(folderId).length;
            const childFolders = this.getChildFolders(folderId);
            for (const childFolder of childFolders) {
                count += this.getFolderNoteCount(childFolder.id);
            }
            return count;
        },
        async startSyncBooks() {
            if (!this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            // Save settings before starting sync
            this.saveConnectionSettings();

            this.syncingBooks = true;
            try {
                const result = await window.API.syncJoplinBooks(
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                alert("同步書籍作業已開始 (Job ID: " + result.jobId + ")");
                this.refreshJobs();
                // Start polling for job completion to refresh structure
                this.pollForSyncCompletion(result.jobId);
            } catch (error) {
                console.error("Error starting sync books:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg =
                        "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                }
                alert("啟動同步書籍作業失敗: " + errorMsg);
            } finally {
                this.syncingBooks = false;
            }
        },
        async startSyncTaggedBooks() {
            if (!this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            // Save settings before starting sync
            this.saveConnectionSettings();

            this.syncingTaggedBooks = true;
            try {
                const result = await window.API.syncJoplinTaggedBooks(
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                alert(
                    "同步有標籤書籍作業已開始 (Job ID: " + result.jobId + ")"
                );
                this.refreshJobs();
                // Start polling for job completion to refresh structure
                this.pollForSyncCompletion(result.jobId);
            } catch (error) {
                console.error("Error starting sync tagged books:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg =
                        "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                }
                alert("啟動同步有標籤書籍作業失敗: " + errorMsg);
            } finally {
                this.syncingTaggedBooks = false;
            }
        },
        async recreateBookFolder() {
            if (!this.selectedBookId) {
                alert("請選擇書籍");
                return;
            }
            if (!this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            // Save settings before starting operation
            this.saveConnectionSettings();

            this.recreatingFolder = true;
            try {
                const result = await window.API.recreateJoplinBookFolder(
                    this.selectedBookId,
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                alert(
                    "重新建立書籍資料夾作業已開始 (Job ID: " +
                        result.jobId +
                        ")"
                );
                this.refreshJobs();
                // Start polling for job completion to refresh structure
                this.pollForSyncCompletion(result.jobId);
            } catch (error) {
                console.error("Error recreating book folder:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg =
                        "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                }
                alert("啟動重新建立作業失敗: " + errorMsg);
            } finally {
                this.recreatingFolder = false;
            }
        },
        async loadBooks() {
            try {
                this.books = await window.API.getBooks();
            } catch (error) {
                console.error("Error loading books:", error);
            }
        },
        async refreshJobs() {
            this.loadingJobs = true;
            try {
                this.jobs = await window.API.getJoplinJobs();
            } catch (error) {
                console.error("Error loading jobs:", error);
            } finally {
                this.loadingJobs = false;
            }
        },
        getJobTypeName(type) {
            const names = {
                sync_structure: "同步結構",
                source_sync: "來源同步",
                source_import: "來源匯入",
                sync_books: "同步書籍",
                recreate_book_folder: "重新建立書籍資料夾",
            };
            return names[type] || type;
        },
        getStatusName(status) {
            const names = {
                queued: "排隊中",
                processing: "處理中",
                completed: "已完成",
                failed: "失敗",
            };
            return names[status] || status;
        },
        getStatusBadgeClass(status) {
            const classes = {
                queued: "bg-secondary",
                processing: "bg-primary",
                completed: "bg-success",
                failed: "bg-danger",
            };
            return classes[status] || "bg-secondary";
        },
        formatDate(dateString) {
            if (!dateString) return "";
            // Handle both ISO string and timestamp formats
            let date;
            if (typeof dateString === "number") {
                date = new Date(dateString);
            } else {
                date = new Date(dateString);
            }
            return date.toLocaleString("zh-TW");
        },
    },
});
