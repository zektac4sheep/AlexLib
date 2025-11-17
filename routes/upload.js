const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const SOURCE_FOLDER = process.env.SOURCE_FOLDER || path.join(__dirname, '../source');

// Ensure source folder exists
if (!fs.existsSync(SOURCE_FOLDER)) {
  fs.mkdirSync(SOURCE_FOLDER, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, SOURCE_FOLDER);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Upload file
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  res.json({
    message: 'File uploaded successfully',
    filename: req.file.filename,
    path: req.file.path,
    size: req.file.size
  });
});

// Process uploaded file
router.post('/process', async (req, res) => {
  const { filename, bookId, bookName } = req.body;
  
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }
  
  // TODO: Implement file processing
  res.json({
    message: 'File processing coming soon',
    filename
  });
});

module.exports = router;

