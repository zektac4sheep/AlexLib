# Alex Library

Traditional Chinese novel downloader and Joplin integration system.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
# Edit .env and add your Joplin API token
```

3. Start the server:

```bash
npm start
```

4. Open http://localhost:3000 in your browser

## Features

-   Search and download from Cool18 forum
-   Automatic Traditional Chinese conversion (HK variant)
-   Smart chapter detection and merging
-   Joplin integration for note management
-   Book database tracking
-   File processing and chunking

## Configuration

Edit `.env` file to configure:

-   Joplin API token and URL
-   Database path
-   Cool18 forum settings
-   Concurrent download limits

## Development

```bash
npm run dev  # Start with nodemon for auto-reload
```
