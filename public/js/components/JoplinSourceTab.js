// JoplinSourceTab Component
Vue.component("joplin-source-tab", {
    template: `
        <div class="tab-content p-4">
            <h3 class="h5 mb-4">Joplin 來源</h3>

            <!-- Connection Settings -->
            <div class="card mb-4">
                <div class="card-header">
                    <h5 class="mb-0">連線設定</h5>
                </div>
                <div class="card-body">
                    <div class="row mb-3">
                        <div class="col-md-3">
                            <label for="sourceJoplinUrl" class="form-label">API URL</label>
                            <input 
                                type="text" 
                                class="form-control" 
                                id="sourceJoplinUrl" 
                                v-model="connectionSettings.apiUrl"
                                placeholder="http://localhost:41184"
                                @blur="saveConnectionSettings"
                            />
                        </div>
                        <div class="col-md-9">
                            <label for="sourceJoplinToken" class="form-label">Token</label>
                            <div class="input-group">
                                <input 
                                    :type="showToken ? 'text' : 'password'" 
                                    class="form-control" 
                                    id="sourceJoplinToken" 
                                    v-model="connectionSettings.apiToken"
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
                            :disabled="testingConnection || !connectionSettings.apiToken"
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
                            :disabled="!connectionSettings.apiToken || syncingStructure"
                        >
                            <span v-if="syncingStructure" class="spinner-border spinner-border-sm me-2"></span>
                            同步來源 Joplin 結構到資料庫
                        </button>
                        <button 
                            class="btn btn-danger" 
                            @click="removeEbooksFolder"
                            :disabled="!connectionSettings.apiToken || removingEbooksFolder"
                        >
                            <span v-if="removingEbooksFolder" class="spinner-border spinner-border-sm me-2"></span>
                            移除 "Ebooks" 資料夾
                        </button>
                        <small class="text-muted">此操作將刪除 Joplin Source 中名為 "Ebooks" 的資料夾及其所有內容（從 Joplin Source 和資料庫中移除）</small>
                    </div>
                </div>
            </div>

            <!-- Search Notes -->
            <div class="card mb-4">
                <div class="card-header">
                    <h5 class="mb-0">搜尋筆記內容</h5>
                </div>
                <div class="card-body">
                    <div class="row g-3 mb-3">
                        <div class="col-md-10">
                            <input
                                type="text"
                                class="form-control"
                                v-model="searchSubtext"
                                placeholder="輸入要搜尋的文字..."
                                @keyup.enter="searchNotes"
                            />
                        </div>
                        <div class="col-md-2">
                            <button 
                                class="btn btn-primary w-100" 
                                @click="searchNotes"
                                :disabled="!searchSubtext || searching"
                            >
                                <span v-if="searching" class="spinner-border spinner-border-sm me-2"></span>
                                搜尋
                            </button>
                        </div>
                    </div>
                    <div v-if="searchResults.length > 0" class="mt-3">
                        <div class="alert alert-info">
                            找到 {{ searchResults.length }} 個包含 "{{ searchSubtext }}" 的筆記
                        </div>
                        <div class="table-responsive">
                            <table class="table table-hover table-sm">
                                <thead>
                                    <tr>
                                        <th>標題</th>
                                        <th>資料夾</th>
                                        <th>匹配位置</th>
                                        <th>最後更新</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="result in searchResults" :key="result.id">
                                        <td>
                                            <strong>{{ result.title || '(無標題)' }}</strong>
                                        </td>
                                        <td>{{ result.folderName || '根目錄' }}</td>
                                        <td>
                                            <span v-if="result.matchInTitle" class="badge bg-warning me-1">標題</span>
                                            <span v-if="result.matchInContent" class="badge bg-info">內容</span>
                                        </td>
                                        <td>{{ formatDate(result.updated_time) }}</td>
                                        <td>
                                            <button 
                                                class="btn btn-sm btn-outline-primary"
                                                @click="viewSearchResult(result)"
                                                title="查看內容"
                                            >
                                                查看
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div v-else-if="searchSubtext && !searching && hasSearched" class="alert alert-warning mt-3">
                        沒有找到包含 "{{ searchSubtext }}" 的筆記
                    </div>
                </div>
            </div>

            <!-- Source Structure Display -->
            <div class="card mb-4">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">來源結構</h5>
                    <div class="btn-group">
                        <button 
                            class="btn btn-sm btn-outline-secondary" 
                            @click="rebuildTree"
                            :disabled="loadingStructure"
                            title="重新建立樹狀結構（不需要重新同步）"
                        >
                            <span v-if="rebuildingTree" class="spinner-border spinner-border-sm me-1"></span>
                            重建樹狀結構
                        </button>
                        <button 
                            class="btn btn-sm btn-outline-secondary" 
                            @click="loadSourceStructure"
                            :disabled="loadingStructure"
                        >
                            <span v-if="loadingStructure" class="spinner-border spinner-border-sm me-1"></span>
                            重新整理
                        </button>
                    </div>
                </div>
                <div class="card-body">
                    <div v-if="loadingStructure" class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">載入中...</span>
                        </div>
                    </div>
                    <div v-else-if="treeData.length === 0" class="text-muted">
                        尚未同步結構，請先點擊「同步來源 Joplin 結構到資料庫」
                    </div>
                    <div v-else class="source-structure-tree">
                        <div class="mb-3">
                            <button 
                                class="btn btn-sm btn-success me-2"
                                @click="importSelected"
                                :disabled="selectedItems.length === 0 || importing"
                            >
                                <span v-if="importing" class="spinner-border spinner-border-sm me-2"></span>
                                匯入選取項目 ({{ selectedItems.length }})
                            </button>
                            <button 
                                class="btn btn-sm btn-outline-secondary"
                                @click="clearSelection"
                            >
                                清除選取
                            </button>
                        </div>
                        <tree-node
                            v-for="node in treeData"
                            :key="node.id"
                            :node="node"
                            :expanded-folders="expandedFolders"
                            :selectable="true"
                            :selected-items="selectedItems"
                            @toggle-folder="toggleFolder"
                            @select-item="toggleSelection"
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
                apiUrl: "http://localhost:41184",
                apiToken: "",
            },
            showToken: false,
            testingConnection: false,
            connectionStatus: null,
            syncingStructure: false,
            removingEbooksFolder: false,
            folders: [],
            notes: {}, // Changed to object: { folderId: [notes] } for lazy loading
            loadedFolders: new Set(), // Track which folders have notes loaded
            loadingStructure: false,
            rebuildingTree: false,
            loadingNotes: {}, // Track which folders are currently loading notes
            expandedFolders: {},
            selectedItems: [],
            importing: false,
            jobs: [],
            loadingJobs: false,
            jobRefreshInterval: null,
            searchSubtext: "",
            searching: false,
            searchResults: [],
            hasSearched: false,
            selectedSearchResult: null,
        };
    },
    computed: {
        treeData() {
            if (!this.folders.length) {
                return [];
            }

            const isRootParent = (parentId) => {
                return !parentId || parentId === "";
            };

            // Helper function to recursively count notes in a folder and all subfolders
            const countNotesRecursive = (folderId) => {
                let count = 0;

                // Count direct notes in this folder
                const directNotes = this.notes[folderId] || [];
                count += directNotes.length;

                // Count notes in all subfolders recursively
                const subfolders = this.folders.filter(
                    (f) => f.parent_id === folderId
                );
                for (const subfolder of subfolders) {
                    count += countNotesRecursive(subfolder.id);
                }

                return count;
            };

            const buildTree = (parentId, noteIndex = { value: 1 }) => {
                const children = [];

                let childFolders = this.folders.filter((f) => {
                    if (isRootParent(parentId)) {
                        return isRootParent(f.parent_id);
                    } else {
                        return f.parent_id === parentId;
                    }
                });

                // Sort folders: prioritize xMVPold and xMVPoId at the top
                const priorityFolders = ['xMVPold', 'xMVPoId'];
                childFolders.sort((a, b) => {
                    const aIndex = priorityFolders.indexOf(a.title);
                    const bIndex = priorityFolders.indexOf(b.title);
                    
                    // If both are priority folders, maintain their order in priorityFolders array
                    if (aIndex !== -1 && bIndex !== -1) {
                        return aIndex - bIndex;
                    }
                    // Priority folders come first
                    if (aIndex !== -1) return -1;
                    if (bIndex !== -1) return 1;
                    // Other folders sorted alphabetically
                    return a.title.localeCompare(b.title, 'zh-CN');
                });

                for (const folder of childFolders) {
                    // Count notes recursively (including subfolders)
                    const recursiveNoteCount = countNotesRecursive(folder.id);

                    // Build children first to get their structure
                    const folderChildren = buildTree(folder.id, noteIndex);

                    const folderNode = {
                        id: folder.id,
                        name: folder.title,
                        type: "folder",
                        children: folderChildren,
                        noteCount: recursiveNoteCount,
                        isLoading: this.loadingNotes[folder.id] || false,
                        isLoaded: this.loadedFolders.has(folder.id),
                    };
                    children.push(folderNode);
                }

                // Only show notes for folders that have been loaded
                const folderNotes = this.notes[parentId || "__root"] || [];
                for (const note of folderNotes) {
                    const noteNode = {
                        id: note.id,
                        name: note.title || "(無標題)",
                        type: "note",
                        noteNumber: noteIndex.value++,
                        metadata: {
                            updated_time: note.updated_time,
                        },
                    };
                    children.push(noteNode);
                }

                return children;
            };

            return buildTree(null);
        },
    },
    mounted() {
        this.loadConnectionSettings();
        this.refreshJobs();
        this.loadSourceStructure();
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
        async loadConnectionSettings() {
            try {
                const settings = await window.API.getSourceJoplinSettings();
                if (settings) {
                    this.connectionSettings.apiUrl =
                        settings.apiUrl || "http://localhost:41184";
                    this.connectionSettings.apiToken = settings.apiToken || "";
                }
            } catch (error) {
                console.error("Error loading connection settings:", error);
            }
        },
        async saveConnectionSettings() {
            try {
                await window.API.saveSourceJoplinSettings(
                    this.connectionSettings
                );
            } catch (error) {
                console.error("Error saving connection settings:", error);
            }
        },
        toggleTokenVisibility() {
            this.showToken = !this.showToken;
        },
        async testConnection() {
            this.testingConnection = true;
            this.connectionStatus = null;
            try {
                const result = await window.API.testSourceJoplinConnection(
                    this.connectionSettings.apiUrl,
                    this.connectionSettings.apiToken
                );
                this.connectionStatus = result.connected;
                if (result.connected) {
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
            if (!this.connectionSettings.apiToken) {
                alert("請先輸入 Joplin Token");
                return;
            }

            this.saveConnectionSettings();

            this.syncingStructure = true;
            try {
                const result = await window.API.syncSourceJoplinStructure(
                    this.connectionSettings.apiUrl,
                    this.connectionSettings.apiToken
                );
                alert("同步結構作業已開始 (Job ID: " + result.jobId + ")");
                this.refreshJobs();
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
        async removeEbooksFolder() {
            if (!this.connectionSettings.apiToken) {
                alert("請先輸入 Joplin Source Token");
                return;
            }

            // Confirm before deleting
            if (!confirm("確定要刪除 Joplin Source 中名為 \"Ebooks\" 的資料夾嗎？此操作無法復原。")) {
                return;
            }

            // Save settings before starting operation
            this.saveConnectionSettings();

            this.removingEbooksFolder = true;
            try {
                const result = await window.API.removeSourceEbooksFolder();
                if (result.deleted) {
                    let message = `已成功刪除 ${result.deletedCount || 0} 個 "Ebooks" 資料夾。\n已刪除 ${result.totalDeletedFolders || 0} 個資料夾和 ${result.totalDeletedNotes || 0} 個筆記。`;
                    if (result.errors && result.errors.length > 0) {
                        message += `\n\n警告: ${result.errors.length} 個資料夾處理時發生錯誤。`;
                    }
                    alert(message);
                    // Refresh structure
                    this.loadSourceStructure();
                } else {
                    alert(result.message || "Ebooks 資料夾未找到");
                }
            } catch (error) {
                console.error("Error removing Ebooks folder:", error);
                let errorMsg = error.message || "Unknown error";
                if (error.status === 403 || errorMsg.includes("403")) {
                    errorMsg =
                        "認證失敗 (403): Token 可能無效或已過期，請檢查 Joplin Source 設定中的 API Token";
                }
                alert("移除 Ebooks 資料夾失敗: " + errorMsg);
            } finally {
                this.removingEbooksFolder = false;
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
                            this.loadSourceStructure();
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
        async loadSourceStructure() {
            this.loadingStructure = true;
            try {
                // Only load folders initially (lazy load notes when folders are expanded)
                const folders = await window.API.getSourceJoplinFolders();
                this.folders = folders || [];
                this.notes = {}; // Reset notes object
                this.loadedFolders.clear();
                console.log(
                    `Loaded ${this.folders.length} folders (notes will be loaded on demand)`
                );

                // Load root level notes immediately (notes without parent_id)
                await this.loadRootNotes();
            } catch (error) {
                console.error("Error loading source structure:", error);
            } finally {
                this.loadingStructure = false;
            }
        },
        async rebuildTree() {
            // Rebuild tree from existing database data (no resync needed)
            this.rebuildingTree = true;
            try {
                // Just reload the structure - the new tree building logic will be applied
                await this.loadSourceStructure();
                console.log("Tree rebuilt with updated logic");
            } catch (error) {
                console.error("Error rebuilding tree:", error);
                alert(
                    "重建樹狀結構失敗: " + (error.message || "Unknown error")
                );
            } finally {
                this.rebuildingTree = false;
            }
        },
        async toggleFolder(folderId) {
            const wasExpanded = this.expandedFolders[folderId];
            this.$set(this.expandedFolders, folderId, !wasExpanded);

            // If expanding and notes not loaded yet, load them
            if (!wasExpanded && !this.loadedFolders.has(folderId)) {
                await this.loadFolderNotes(folderId);
            }
        },
        async loadFolderNotes(folderId) {
            if (
                this.loadingNotes[folderId] ||
                this.loadedFolders.has(folderId)
            ) {
                return; // Already loading or loaded
            }

            this.$set(this.loadingNotes, folderId, true);
            try {
                console.log(`Loading notes for folder: ${folderId}`);
                const notes = await window.API.getSourceJoplinNotesByFolder(
                    folderId
                );

                // Store notes by folder ID (use "__root" for root level notes)
                const key = folderId || "__root";
                this.$set(this.notes, key, notes || []);
                this.loadedFolders.add(folderId);
                console.log(
                    `Loaded ${notes?.length || 0} notes for folder: ${folderId}`
                );
            } catch (error) {
                console.error(
                    `Error loading notes for folder ${folderId}:`,
                    error
                );
                // Still mark as loaded to prevent retry loops
                this.loadedFolders.add(folderId);
            } finally {
                this.$set(this.loadingNotes, folderId, false);
            }
        },
        async loadRootNotes() {
            // Load root level notes (notes without parent_id)
            await this.loadFolderNotes(null);
        },
        // Get all children (subfolders and notes) of a folder recursively
        getAllChildren(folderId) {
            const children = [];

            // Get direct subfolders
            const subfolders = this.folders.filter(
                (f) => f.parent_id === folderId
            );
            for (const subfolder of subfolders) {
                children.push({
                    id: subfolder.id,
                    type: "folder",
                    name: subfolder.title,
                });
                // Recursively get children of subfolders
                children.push(...this.getAllChildren(subfolder.id));
            }

            // Get direct notes in this folder
            const folderNotes = this.notes[folderId] || [];
            for (const note of folderNotes) {
                children.push({
                    id: note.id,
                    type: "note",
                    name: note.title || "(無標題)",
                });
            }

            return children;
        },

        toggleSelection(item) {
            const index = this.selectedItems.findIndex(
                (i) => i.id === item.id && i.type === item.type
            );
            const isCurrentlySelected = index >= 0;

            if (item.type === "folder") {
                if (isCurrentlySelected) {
                    // Unchecking folder: only remove the folder itself, keep children checked
                    this.selectedItems.splice(index, 1);

                    // Uncheck parent folder if it exists and is selected
                    const folder = this.folders.find((f) => f.id === item.id);
                    if (folder && folder.parent_id) {
                        const parentIndex = this.selectedItems.findIndex(
                            (i) =>
                                i.id === folder.parent_id && i.type === "folder"
                        );
                        if (parentIndex >= 0) {
                            this.selectedItems.splice(parentIndex, 1);
                        }
                    }
                } else {
                    // Checking folder: add folder and all its children recursively
                    this.selectedItems.push(item);
                    const allChildren = this.getAllChildren(item.id);
                    for (const child of allChildren) {
                        // Only add if not already selected
                        const childIndex = this.selectedItems.findIndex(
                            (i) => i.id === child.id && i.type === child.type
                        );
                        if (childIndex < 0) {
                            this.selectedItems.push(child);
                        }
                    }
                }
            } else {
                // For notes
                if (isCurrentlySelected) {
                    this.selectedItems.splice(index, 1);

                    // If unchecking a note, uncheck parent folder if it's selected
                    // Find the note's parent folder
                    for (const folderId in this.notes) {
                        const notes = this.notes[folderId] || [];
                        const note = notes.find((n) => n.id === item.id);
                        if (note) {
                            const parentFolderId =
                                folderId === "__root" ? null : folderId;
                            if (parentFolderId) {
                                const parentIndex =
                                    this.selectedItems.findIndex(
                                        (i) =>
                                            i.id === parentFolderId &&
                                            i.type === "folder"
                                    );
                                if (parentIndex >= 0) {
                                    // Uncheck parent folder
                                    this.selectedItems.splice(parentIndex, 1);

                                    // Also uncheck grandparent if exists
                                    const parentFolder = this.folders.find(
                                        (f) => f.id === parentFolderId
                                    );
                                    if (
                                        parentFolder &&
                                        parentFolder.parent_id
                                    ) {
                                        const grandparentIndex =
                                            this.selectedItems.findIndex(
                                                (i) =>
                                                    i.id ===
                                                        parentFolder.parent_id &&
                                                    i.type === "folder"
                                            );
                                        if (grandparentIndex >= 0) {
                                            this.selectedItems.splice(
                                                grandparentIndex,
                                                1
                                            );
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    }
                } else {
                    this.selectedItems.push(item);
                }
            }
        },
        clearSelection() {
            this.selectedItems = [];
        },
        async importSelected() {
            if (this.selectedItems.length === 0) {
                alert("請先選取要匯入的項目");
                return;
            }

            const noteItems = this.selectedItems.filter(
                (item) => item.type === "note"
            );
            const folderItems = this.selectedItems.filter(
                (item) => item.type === "folder"
            );

            const noteIds = noteItems.map((item) => item.id);
            const folderIds = folderItems.map((item) => item.id);

            // Build confirmation message with note names
            let confirmMessage = "確定要匯入以下項目嗎？\n\n";
            if (noteItems.length > 0) {
                confirmMessage += `• ${noteItems.length} 個筆記：\n`;
                // List note names (limit to first 10 to avoid dialog being too long)
                const notesToShow = noteItems.slice(0, 10);
                notesToShow.forEach((item) => {
                    confirmMessage += `  - ${item.name || "(無標題)"}\n`;
                });
                if (noteItems.length > 10) {
                    confirmMessage += `  ... 還有 ${
                        noteItems.length - 10
                    } 個筆記\n`;
                }
                confirmMessage += "\n";
            }
            if (folderItems.length > 0) {
                confirmMessage += `• ${folderItems.length} 個資料夾（將匯入資料夾內的所有筆記）：\n`;
                folderItems.forEach((item) => {
                    confirmMessage += `  - ${item.name}\n`;
                });
                confirmMessage += "\n";
            }
            confirmMessage += `總計: ${this.selectedItems.length} 個項目`;

            if (!confirm(confirmMessage)) {
                return;
            }

            this.importing = true;
            try {
                const result = await window.API.importFromSourceJoplin({
                    noteIds,
                    folderIds,
                });

                alert(
                    `匯入工作已開始！\n工作 ID: ${result.jobId}\n\n您可以在「工作」標籤中查看進度。`
                );
                this.clearSelection();
                // Refresh jobs to show the new import job
                this.refreshJobs();
            } catch (error) {
                console.error("Error importing:", error);
                alert("匯入失敗: " + (error.message || "Unknown error"));
            } finally {
                this.importing = false;
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
        async searchNotes() {
            if (!this.searchSubtext || this.searchSubtext.trim().length === 0) {
                return;
            }

            this.searching = true;
            this.hasSearched = false;
            try {
                const result = await window.API.searchSourceJoplinNotes(
                    this.searchSubtext.trim()
                );
                this.searchResults = result.results || [];
                this.hasSearched = true;
            } catch (error) {
                console.error("Error searching notes:", error);
                alert("搜尋失敗: " + (error.message || "Unknown error"));
                this.searchResults = [];
                this.hasSearched = true;
            } finally {
                this.searching = false;
            }
        },
        viewSearchResult(result) {
            // Show modal or navigate to view the note content
            this.selectedSearchResult = result;

            // Create a simple modal to display the content
            const modal = document.createElement("div");
            modal.className = "modal fade show";
            modal.style.display = "block";
            modal.style.backgroundColor = "rgba(0,0,0,0.5)";
            modal.style.zIndex = "1055";
            modal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${
                                result.title || "(無標題)"
                            }</h5>
                            <button type="button" class="btn-close" onclick="this.closest('.modal').remove()"></button>
                        </div>
                        <div class="modal-body">
                            <p><strong>資料夾:</strong> ${
                                result.folderName || "根目錄"
                            }</p>
                            <p><strong>匹配位置:</strong> 
                                ${
                                    result.matchInTitle
                                        ? '<span class="badge bg-warning">標題</span>'
                                        : ""
                                }
                                ${
                                    result.matchInContent
                                        ? '<span class="badge bg-info">內容</span>'
                                        : ""
                                }
                            </p>
                            <hr>
                            <h6>內容預覽:</h6>
                            <pre style="white-space: pre-wrap; max-height: 500px; overflow-y: auto; background: #f5f5f5; padding: 10px; border-radius: 4px;">${this.escapeHtml(
                                result.matchContext || result.body || "無內容"
                            )}</pre>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">關閉</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Close on backdrop click
            modal.addEventListener("click", (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        },
        escapeHtml(text) {
            const div = document.createElement("div");
            div.textContent = text;
            return div.innerHTML;
        },
    },
});
