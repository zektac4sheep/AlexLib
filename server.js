const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Routes will be added here
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API routes placeholder
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Cool18 Reborn v3 API' });
});

app.listen(PORT, () => {
  console.log(`Cool18 Reborn v3 server running on http://localhost:${PORT}`);
});

