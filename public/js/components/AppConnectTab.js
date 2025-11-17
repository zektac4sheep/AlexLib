// AppConnectTab Component - Unified component for Joplin and OneNote
Vue.component("app-connect-tab", {
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">App Connect</h3>

            <!-- App Type Selector -->
            <div class="card mb-4">
                <div class="card-header">
                    <h5 class="mb-0">選擇應用程式</h5>
                </div>
                <div class="card-body">
                    <div class="btn-group" role="group">
                        <input 
                            type="radio" 
                            class="btn-check" 
                            id="appTypeJoplin" 
                            value="joplin" 
                            v-model="appType"
                            @change="onAppTypeChange"
                        />
                        <label class="btn btn-outline-primary" for="appTypeJoplin">Joplin</label>
                        
                        <input 
                            type="radio" 
                            class="btn-check" 
                            id="appTypeOneNote" 
                            value="onenote" 
                            v-model="appType"
                            @change="onAppTypeChange"
                        />
                        <label class="btn btn-outline-primary" for="appTypeOneNote">OneNote</label>
                    </div>
                </div>
            </div>

            <!-- Connection Settings -->
            <div class="card mb-4">
                <div class="card-header">
                    <h5 class="mb-0">連線設定</h5>
                </div>
                <div class="card-body">
                    <!-- Joplin Connection Settings -->
                    <div v-if="appType === 'joplin'">
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
                                        :type="showToken ? 'text' : 'password'" 
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
                    <!-- OneNote Connection Settings -->
                    <div v-else>
                        <div class="alert alert-info">
                            OneNote 使用環境變數進行認證，無需手動輸入設定。
                        </div>
                        <div class="d-flex gap-2">
                            <button 
                                class="btn btn-primary" 
                                @click="testConnection"
                                :disabled="testingConnection"
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
            </div>

            <!-- Sync Actions -->
            <div class="card mb-4">
                <div class="card-header">
                    <h5 class="mb-0">同步操作</h5>
                </div>
                <div class="card-body">
                    <div class="d-flex flex-column gap-2">
                        <!-- Joplin Sync Actions -->
                        <template v-if="appType === 'joplin'">
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
                            <button 
                                class="btn btn-outline-warning" 
                                @click="startForceSyncBooks"
                                :disabled="!connectionSettings.token || forceSyncingBooks"
                            >
                                <span v-if="forceSyncingBooks" class="spinner-border spinner-border-sm me-2"></span>
                                強制同步所有書籍到 Joplin (重建並同步)
                            </button>
                            <small class="text-muted">強制同步會重建所有書籍的 chunks 並同步到 Joplin</small>
                        </template>
                        <!-- OneNote Sync Actions -->
                        <template v-else>
                            <button 
                                class="btn btn-outline-primary" 
                                @click="startSyncBooks"
                                :disabled="syncingBooks"
                            >
                                <span v-if="syncingBooks" class="spinner-border spinner-border-sm me-2"></span>
                                同步所有標記的書籍到 OneNote
                            </button>
                            <small class="text-muted">OneNote 同步基於 sync_to_onenote 標記，不支援結構同步</small>
                        </template>
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
                    <div class="d-flex flex-column gap-2">
                        <button 
                            class="btn btn-warning" 
                            @click="recreateBookFolder"
                            :disabled="(appType === 'joplin' && !connectionSettings.token) || !selectedBookId || recreatingFolder"
                        >
                            <span v-if="recreatingFolder" class="spinner-border spinner-border-sm me-2"></span>
                            {{ appType === 'joplin' ? '移除並重新建立書籍資料夾' : '移除並重新建立書籍區段' }}
                        </button>
                        <button 
                            v-if="appType === 'joplin'"
                            class="btn btn-danger" 
                            @click="removeEbooksFolder"
                            :disabled="!connectionSettings.token || removingEbooksFolder"
                        >
                            <span v-if="removingEbooksFolder" class="spinner-border spinner-border-sm me-2"></span>
                            移除 "Ebooks" 資料夾
                        </button>
                        <small v-if="appType === 'joplin'" class="text-muted">此操作將刪除 Joplin 中名為 "Ebooks" 的資料夾及其所有內容（從 Joplin 和資料庫中移除）</small>
                    </div>
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
                        <span v-if="appType === 'joplin'">尚未同步結構，請先點擊「同步 Joplin 結構到資料庫」</span>
                        <span v-else>尚未載入結構，請點擊「重新整理」</span>
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
            appType: "joplin", // 'joplin' or 'onenote'
            connectionSettings: {
                port: 41184,
                token: "",
            },
            showToken: false,
            testingConnection: false,
            connectionStatus: null,
            syncingStructure: false,
            syncingBooks: false,
            syncingTaggedBooks: false,
            recreatingFolder: false,
            removingEbooksFolder: false,
            selectedBookId: "",
            books: [],
            jobs: [],
            loadingJobs: false,
            jobRefreshInterval: null,
            folders: [],
            notes: [],
            onenoteStructure: [],
            loadingStructure: false,
            expandedFolders: {},
        };
    },
    computed: {
        treeData() {
            if (this.appType === "joplin") {
                // Joplin tree structure
                if (!this.folders.length && !this.notes.length) {
                    return [];
                }

                const isRootParent = (parentId) => {
                    return !parentId || parentId === "";
                };

                const buildTree = (parentId) => {
                    const children = [];

                    const childFolders = this.folders.filter((f) => {
                        if (isRootParent(parentId)) {
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
                            children: buildTree(folder.id),
                            noteCount: this.getFolderNoteCount(folder.id),
                        };
                        children.push(folderNode);
                    }

                    const folderNotes = this.notes.filter((n) => {
                        if (isRootParent(parentId)) {
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

                return buildTree(null);
            } else {
                // OneNote tree structure - convert to folder/note format for TreeNode
                if (!this.onenoteStructure || this.onenoteStructure.length === 0) {
                    return [];
                }

                const convertOneNoteNode = (node) => {
                    // Map OneNote types to folder/note types for TreeNode
                    const isFolder = node.type === "notebook" || 
                                    node.type === "section_group" || 
                                    node.type === "section";
                    
                    const converted = {
                        id: node.id,
                        name: node.name,
                        type: isFolder ? "folder" : "note",
                        children: [],
                        noteCount: node.pageCount || 0,
                        metadata: node.metadata,
                    };

                    if (node.children && node.children.length > 0) {
                        converted.children = node.children.map(child => convertOneNoteNode(child));
                    }

                    return converted;
                };

                return this.onenoteStructure.map(notebook => convertOneNoteNode(notebook));
            }
        },
    },
    mounted() {
        // Ensure Joplin is selected by default
        this.appType = "joplin";
        this.loadConnectionSettings();
        this.loadBooks();
        this.refreshJobs();
        this.loadSyncStructure();
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
        onAppTypeChange() {
            this.connectionStatus = null;
            this.loadSyncStructure();
        },
        async loadConnectionSettings() {
            if (this.appType === "joplin") {
                try {
                    const settings = await window.API.getJoplinSettings();
                    
                    if (settings.apiUrl) {
                        const urlMatch = settings.apiUrl.match(/:(\d+)/);
                        if (urlMatch) {
                            this.connectionSettings.port = parseInt(urlMatch[1]) || 41184;
                        } else {
                            this.connectionSettings.port = 41184;
                        }
                    } else {
                        this.connectionSettings.port = 41184;
                    }
                    
                    if (settings.apiToken) {
                        this.connectionSettings.token = settings.apiToken;
                    }
                } catch (error) {
                    console.error("Error loading connection settings:", error);
                    this.connectionSettings.port = 41184;
                }
            }
        },
        async saveConnectionSettings() {
            if (this.appType === "joplin") {
                try {
                    const apiUrl = `http://localhost:${this.connectionSettings.port}`;
                    await window.API.saveJoplinSettings({
                        apiUrl: apiUrl,
                        apiToken: this.connectionSettings.token || "",
                    });
                } catch (error) {
                    console.error("Error saving connection settings:", error);
                    alert("儲存設定失敗: " + (error.message || "Unknown error"));
                }
            }
        },
        toggleTokenVisibility() {
            this.showToken = !this.showToken;
        },
        async testConnection() {
            this.testingConnection = true;
            this.connectionStatus = null;
            try {
                if (this.appType === "joplin") {
                    const result = await window.API.testJoplinConnection(
                        this.connectionSettings.port,
                        this.connectionSettings.token
                    );
                    this.connectionStatus = result.connected;
                    if (result.connected) {
                        this.saveConnectionSettings();
                    }
                } else {
                    const result = await window.API.testOneNoteConnection();
                    this.connectionStatus = result.connected;
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
            if (this.appType !== "joplin") return;
            
            if (!this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            this.saveConnectionSettings();
            this.syncingStructure = true;
            try {
                const result = await window.API.syncJoplinStructure(
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                alert("同步結構作業已開始 (Job ID: " + result.jobId + ")");
                this.refreshJobs();
                this.pollForSyncCompletion(result.jobId);
            } catch (error) {
                console.error("Error starting sync structure:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg = "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                }
                alert("啟動同步結構作業失敗: " + errorMsg);
            } finally {
                this.syncingStructure = false;
            }
        },
        async pollForSyncCompletion(jobId) {
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
                if (this.appType === "joplin") {
                    const [folders, notes] = await Promise.all([
                        window.API.getJoplinFolders(),
                        window.API.getJoplinNotes(1000),
                    ]);
                    this.folders = folders || [];
                    this.notes = notes || [];
                } else {
                    const structure = await window.API.getOneNoteStructure();
                    this.onenoteStructure = structure || [];
                }
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
            let count = this.getFolderNotes(folderId).length;
            const childFolders = this.getChildFolders(folderId);
            for (const childFolder of childFolders) {
                count += this.getFolderNoteCount(childFolder.id);
            }
            return count;
        },
        async startSyncBooks() {
            if (this.appType === "joplin") {
                if (!this.connectionSettings.token) {
                    alert("請先輸入 Joplin Token");
                    return;
                }
                this.saveConnectionSettings();
                this.syncingBooks = true;
                try {
                    const result = await window.API.syncJoplinBooks(
                        this.connectionSettings.port,
                        this.connectionSettings.token
                    );
                    alert("同步書籍作業已開始 (Job ID: " + result.jobId + ")");
                    this.refreshJobs();
                    this.pollForSyncCompletion(result.jobId);
                } catch (error) {
                    console.error("Error starting sync books:", error);
                    let errorMsg = error.message || "Unknown error";
                    if (error.status === 403 || errorMsg.includes("403")) {
                        errorMsg = "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                    }
                    alert("啟動同步書籍作業失敗: " + errorMsg);
                } finally {
                    this.syncingBooks = false;
                }
            } else {
                this.syncingBooks = true;
                try {
                    const result = await window.API.syncOneNoteBooks();
                    alert("同步書籍作業已開始 (Job ID: " + result.jobId + ")");
                    this.refreshJobs();
                    this.pollForSyncCompletion(result.jobId);
                } catch (error) {
                    console.error("Error starting OneNote sync books:", error);
                    alert("啟動同步書籍作業失敗: " + (error.message || "Unknown error"));
                } finally {
                    this.syncingBooks = false;
                }
            }
        },
        async startSyncTaggedBooks() {
            if (this.appType !== "joplin") return;
            
            if (!this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            this.saveConnectionSettings();
            this.syncingTaggedBooks = true;
            try {
                const result = await window.API.syncJoplinTaggedBooks(
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                alert("同步有標籤書籍作業已開始 (Job ID: " + result.jobId + ")");
                this.refreshJobs();
                this.pollForSyncCompletion(result.jobId);
            } catch (error) {
                console.error("Error starting sync tagged books:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg = "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                }
                alert("啟動同步有標籤書籍作業失敗: " + errorMsg);
            } finally {
                this.syncingTaggedBooks = false;
            }
        },
        async startForceSyncBooks() {
            if (this.appType !== "joplin") return;
            
            if (!this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            if (!confirm("確定要強制同步所有書籍嗎？這將重建所有書籍的 chunks 並同步到 Joplin。")) {
                return;
            }

            this.saveConnectionSettings();
            this.forceSyncingBooks = true;
            try {
                const result = await window.API.forceSyncJoplinBooks(
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                alert("強制同步書籍作業已開始 (Job ID: " + result.jobId + ", 書籍數量: " + (result.booksCount || 0) + ")");
                this.refreshJobs();
                this.pollForSyncCompletion(result.jobId);
            } catch (error) {
                console.error("Error starting force sync books:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg = "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                }
                alert("啟動強制同步書籍作業失敗: " + errorMsg);
            } finally {
                this.forceSyncingBooks = false;
            }
        },
        async recreateBookFolder() {
            if (!this.selectedBookId) {
                alert("請選擇書籍");
                return;
            }
            
            if (this.appType === "joplin" && !this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            if (this.appType === "joplin") {
                this.saveConnectionSettings();
            }

            this.recreatingFolder = true;
            try {
                if (this.appType === "joplin") {
                    const result = await window.API.recreateJoplinBookFolder(
                        this.selectedBookId,
                        this.connectionSettings.port,
                        this.connectionSettings.token
                    );
                    alert("重新建立書籍資料夾作業已開始 (Job ID: " + result.jobId + ")");
                    this.refreshJobs();
                    this.pollForSyncCompletion(result.jobId);
                } else {
                    const result = await window.API.recreateOneNoteBookSection(this.selectedBookId);
                    alert("重新建立書籍區段作業已開始 (Job ID: " + result.jobId + ")");
                    this.refreshJobs();
                    this.pollForSyncCompletion(result.jobId);
                }
            } catch (error) {
                console.error("Error recreating book folder/section:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg = "認證失敗 (403): Token 可能無效或已過期";
                }
                alert("啟動重新建立作業失敗: " + errorMsg);
            } finally {
                this.recreatingFolder = false;
            }
        },
        async removeEbooksFolder() {
            if (this.appType !== "joplin") return;
            
            if (!this.connectionSettings.token) {
                alert("請先輸入 Joplin Token");
                return;
            }

            if (!confirm("確定要刪除 Joplin 中名為 \"Ebooks\" 的資料夾嗎？此操作無法復原。")) {
                return;
            }

            this.saveConnectionSettings();
            this.removingEbooksFolder = true;
            try {
                const result = await window.API.removeEbooksFolder(
                    this.connectionSettings.port,
                    this.connectionSettings.token
                );
                if (result.deleted) {
                    alert(`Ebooks 資料夾已成功刪除。\n已清除 ${result.booksCleared || 0} 本書籍的 Joplin 參考。`);
                    this.loadSyncStructure();
                    this.loadBooks();
                } else {
                    alert(result.message || "Ebooks 資料夾未找到");
                }
            } catch (error) {
                console.error("Error removing Ebooks folder:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg = "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin 設定中的 API Token";
                }
                alert("移除 Ebooks 資料夾失敗: " + errorMsg);
            } finally {
                this.removingEbooksFolder = false;
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
                sync_tagged_books: "同步有標籤書籍",
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

