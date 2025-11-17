/**
 * Bot Status Service
 * Tracks all active bot operations (searches, downloads, file processing)
 */

const DownloadJob = require('../models/download');

// Store active operations
const activeOperations = new Map();

// Track last activity time (when any operation ended)
let lastActivityTime = new Date();

/**
 * Register an active operation
 * @param {string} type - Operation type: 'search', 'download', 'upload', 'export'
 * @param {string|number} id - Operation ID
 * @param {Object} data - Operation data
 */
function registerOperation(type, id, data) {
    const operationId = `${type}-${id}`;
    activeOperations.set(operationId, {
        type,
        id,
        ...data,
        startTime: new Date(),
        status: 'active'
    });
}

/**
 * Update operation status
 * @param {string} type - Operation type
 * @param {string|number} id - Operation ID
 * @param {Object} updates - Updates to apply
 */
function updateOperation(type, id, updates) {
    const operationId = `${type}-${id}`;
    const operation = activeOperations.get(operationId);
    if (operation) {
        Object.assign(operation, updates);
        if (updates.status === 'completed' || updates.status === 'failed') {
            operation.endTime = new Date();
            // Update last activity time when operation ends
            lastActivityTime = new Date();
            // Remove completed operations after 5 minutes
            setTimeout(() => {
                activeOperations.delete(operationId);
            }, 5 * 60 * 1000);
        }
    }
}

/**
 * Remove operation
 * @param {string} type - Operation type
 * @param {string|number} id - Operation ID
 */
function removeOperation(type, id) {
    const operationId = `${type}-${id}`;
    activeOperations.delete(operationId);
}

/**
 * Get all active operations
 * @returns {Array} Array of active operations
 */
function getActiveOperations() {
    return Array.from(activeOperations.values());
}

/**
 * Get operation by ID
 * @param {string} type - Operation type
 * @param {string|number} id - Operation ID
 * @returns {Object|null} Operation data
 */
function getOperation(type, id) {
    const operationId = `${type}-${id}`;
    return activeOperations.get(operationId) || null;
}

/**
 * Get operations by type
 * @param {string} type - Operation type
 * @returns {Array} Array of operations of that type
 */
function getOperationsByType(type) {
    return Array.from(activeOperations.values()).filter(op => op.type === type);
}

/**
 * Check if bot is active (has any active operations)
 * @returns {boolean}
 */
function isBotActive() {
    return activeOperations.size > 0;
}

/**
 * Get last activity time (when any operation ended)
 * @returns {Date}
 */
function getLastActivityTime() {
    return lastActivityTime;
}

/**
 * Get idle duration in milliseconds
 * @returns {number}
 */
function getIdleDuration() {
    return new Date() - lastActivityTime;
}

/**
 * Get summary statistics
 * @returns {Object} Summary stats
 */
function getSummary() {
    const operations = Array.from(activeOperations.values());
    const byType = {};
    operations.forEach(op => {
        if (!byType[op.type]) {
            byType[op.type] = { active: 0, completed: 0, failed: 0 };
        }
        if (op.status === 'active') {
            byType[op.type].active++;
        } else if (op.status === 'completed') {
            byType[op.type].completed++;
        } else if (op.status === 'failed') {
            byType[op.type].failed++;
        }
    });

    return {
        total: operations.length,
        active: operations.filter(op => op.status === 'active').length,
        byType
    };
}

module.exports = {
    registerOperation,
    updateOperation,
    removeOperation,
    getActiveOperations,
    getOperation,
    getOperationsByType,
    isBotActive,
    getSummary,
    getLastActivityTime,
    getIdleDuration
};

