require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./models/database');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static('public'));

// Initialize database on startup
initializeDatabase()
  .then(() => {
    logger.info('Database initialized');
  })
  .catch((err) => {
    logger.error('Failed to initialize database', { err });
    process.exit(1);
  });

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Alex Library API' });
});

// Mount API routes
const apiRoutes = require('./routes');
app.use('/api', apiRoutes);

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  logger.info(`Alex Library server running on ${url}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`👉 開發伺服器已啟動，請手動開啟瀏覽器：${url}`);
  }
});

