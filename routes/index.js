const express = require('express');
const router = express.Router();

const booksRouter = require('./books');
const searchRouter = require('./search');
const downloadRouter = require('./download');
const joplinRouter = require('./joplin');
const uploadRouter = require('./upload');
const botStatusRouter = require('./botStatus');

// Mount all routes
router.use('/books', booksRouter);
router.use('/search', searchRouter);
router.use('/download', downloadRouter);
router.use('/joplin', joplinRouter);
router.use('/upload', uploadRouter);
router.use('/bot-status', botStatusRouter);

module.exports = router;

