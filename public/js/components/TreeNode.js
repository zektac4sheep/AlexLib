// TreeNode Component - Recursive tree node for unlimited depth
Vue.component("tree-node", {
    props: {
        node: {
            type: Object,
            required: true,
        },
        expandedFolders: {
            type: Object,
            default: () => ({}),
        },
        selectable: {
            type: Boolean,
            default: false,
        },
        selectedItems: {
            type: Array,
            default: () => [],
        },
    },
    computed: {
        isSelected() {
            if (!this.selectable) return false;
            return this.selectedItems.some(
                (item) =>
                    item.id === this.node.id && item.type === this.node.type
            );
        },
    },
    template: `
        <div class="tree-node">
            <div 
                v-if="node.type === 'folder' || node.type === 'notebook' || node.type === 'section_group' || node.type === 'section'"
                class="folder-header d-flex align-items-center mb-1"
                style="cursor: pointer; user-select: none;"
            >
                <input 
                    v-if="selectable"
                    type="checkbox"
                    class="form-check-input me-2"
                    :checked="isSelected"
                    @click.stop="$emit('select-item', { id: node.id, type: node.type, name: node.name })"
                />
                <span 
                    @click="$emit('toggle-folder', node.id)"
                    class="d-flex align-items-center flex-grow-1"
            >
                <span class="folder-icon me-2">
                    {{ expandedFolders[node.id] ? '📂' : '📁' }}
                </span>
                <strong>{{ node.name }}</strong>
                <span v-if="node.noteCount !== undefined" class="badge bg-secondary ms-2">
                    {{ node.noteCount }}
                    </span>
                    <span v-if="node.isLoading" class="spinner-border spinner-border-sm ms-2" role="status">
                        <span class="visually-hidden">載入中...</span>
                    </span>
                </span>
            </div>
            <div 
                v-else
                class="note-item d-flex align-items-center mb-1"
                :style="selectable ? 'cursor: pointer;' : ''"
            >
                <input 
                    v-if="selectable"
                    type="checkbox"
                    class="form-check-input me-2"
                    :checked="isSelected"
                    @click.stop="$emit('select-item', { id: node.id, type: node.type, name: node.name })"
                />
                <span 
                    @click="selectable && $emit('select-item', { id: node.id, type: node.type, name: node.name })"
                    class="d-flex align-items-center flex-grow-1"
            >
                <span class="me-2">📄</span>
                <span v-if="node.noteNumber !== undefined" class="me-2 text-muted">#{{ node.noteNumber }}</span>
                <span>{{ node.name || '(無標題)' }}</span>
                <small v-if="node.metadata && node.metadata.updated_time" class="text-muted ms-2">
                    {{ formatDate(node.metadata.updated_time) }}
                </small>
                </span>
            </div>
            <div 
                v-if="(node.type === 'folder' || node.type === 'notebook' || node.type === 'section_group' || node.type === 'section') && expandedFolders[node.id] && node.children && node.children.length > 0"
                class="folder-content ms-4 mt-2"
            >
                <tree-node
                    v-for="child in node.children"
                    :key="child.id"
                    :node="child"
                    :expanded-folders="expandedFolders"
                    :selectable="selectable"
                    :selected-items="selectedItems"
                    @toggle-folder="$emit('toggle-folder', $event)"
                    @select-item="$emit('select-item', $event)"
                ></tree-node>
            </div>
        </div>
    `,
    methods: {
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
