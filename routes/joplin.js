const express = require('express');
const router = express.Router();

// Placeholder for Joplin integration endpoints
// Will be implemented with joplinService

// List Joplin notebooks
router.get('/notebooks', async (req, res) => {
  // TODO: Implement Joplin API client
  res.json({
    message: 'Joplin integration coming soon',
    notebooks: []
  });
});

// Export book to Joplin
router.post('/export/:bookId', async (req, res) => {
  // TODO: Implement Joplin export
  res.json({
    message: 'Joplin export coming soon',
    bookId: req.params.bookId
  });
});

module.exports = router;

