const express = require('express');
const router = express.Router();
const autoSearchService = require('../services/autoSearchService');
const logger = require('../utils/logger');

/**
 * Set auto search enabled state
 */
router.post('/enabled', (req, res) => {
    try {
        const { enabled } = req.body;
        autoSearchService.setEnabled(enabled === true);
        
        logger.info('Auto search service state changed', { enabled: enabled === true });
        
        res.json({
            success: true,
            enabled: autoSearchService.getEnabled()
        });
    } catch (error) {
        logger.error('Error setting auto search enabled', { error });
        res.status(500).json({
            error: 'Failed to set auto search enabled',
            message: error.message
        });
    }
});

/**
 * Get auto search enabled state
 */
router.get('/enabled', (req, res) => {
    try {
        res.json({
            success: true,
            enabled: autoSearchService.getEnabled()
        });
    } catch (error) {
        logger.error('Error getting auto search enabled', { error });
        res.status(500).json({
            error: 'Failed to get auto search enabled',
            message: error.message
        });
    }
});

module.exports = router;

