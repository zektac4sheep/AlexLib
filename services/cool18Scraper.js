/**
 * Cool18 Forum Scraper Service
 * Handles searching and downloading from Cool18 forum
 */

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const COOL18_BASE_URL =
    process.env.COOL18_BASE_URL || "https://www.cool18.com/bbs4";
const MAX_SEARCH_PAGES = parseInt(process.env.MAX_SEARCH_PAGES || "3");
const SEARCH_SUBMIT_PARAM = encodeURIComponent("查询");
const SAVE_HTML = process.env.SAVE_HTML !== "false"; // Default to true, set to 'false' to disable
const HTML_SAVE_DIR = path.join(process.cwd(), "data", "html");
const SEARCH_URL_BASE = `${COOL18_BASE_URL}/index.php?action=search&bbsdr=bbs4&act=threadsearch&app=forum`;

// User agent to avoid blocking
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Ensure HTML save directory exists
 */
function ensureHtmlSaveDir() {
    if (!fs.existsSync(HTML_SAVE_DIR)) {
        fs.mkdirSync(HTML_SAVE_DIR, { recursive: true });
    }
}

/**
 * Save HTML content to file
 * @param {string} html - HTML content
 * @param {string} filename - Filename to save
 * @returns {string} - Full path to saved file
 */
function saveHtmlToFile(html, filename) {
    if (!SAVE_HTML) {
        return null;
    }

    try {
        ensureHtmlSaveDir();
        const filePath = path.join(HTML_SAVE_DIR, filename);
        fs.writeFileSync(filePath, html, "utf8");
        logger.info("HTML saved to file", {
            filePath,
            size: Buffer.byteLength(html, "utf8"),
        });
        return filePath;
    } catch (error) {
        logger.error("Error saving HTML to file", { filename, error });
        return null;
    }
}

/**
 * Extract _PageData JSON from HTML
 * @param {string} html - HTML content
 * @returns {Array|null} - Parsed _PageData array or null
 */
function extractPageData(html) {
    try {
        // Match: const _PageData = [{...}];
        const regex = /const\s+_PageData\s*=\s*(\[[\s\S]*?\]);/;
        const match = html.match(regex);

        if (match && match[1]) {
            const jsonString = match[1];
            const pageData = JSON.parse(jsonString);
            logger.info("Extracted _PageData from HTML", {
                count: pageData.length,
            });
            return pageData;
        }

        logger.warn("_PageData not found in HTML");
        return null;
    } catch (error) {
        logger.error("Error extracting _PageData", { error: error.message });
        return null;
    }
}

/**
 * Convert _PageData item to thread object
 * @param {Object} item - _PageData item
 * @returns {Object|null} - Thread object or null
 */
function convertPageDataToThread(item) {
    // Only process main threads (rootid === "0" and uptid === "0")
    // Skip replies and empty subjects
    if (
        item.rootid !== "0" ||
        item.uptid !== "0" ||
        !item.subject ||
        item.subject.trim() === ""
    ) {
        return null;
    }

    // Clean subject - remove HTML tags like <span class='list-type-show'>『古风』</span>
    let title = item.subject;
    // Remove HTML tags
    title = title.replace(/<[^>]+>/g, "");
    // Decode HTML entities
    title = title
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    title = title.trim();

    if (!title || !item.tid) {
        return null;
    }

    // Build URL from thread ID
    const url = `${COOL18_BASE_URL}/index.php?app=forum&act=threadview&tid=${item.tid}`;

    return {
        title,
        url,
        threadId: item.tid,
        date: item.dateline || "",
        replies: 0, // _PageData doesn't include reply count directly
        size: parseInt(item.size) || 0,
        type: item.type || "",
        username: item.username || "",
    };
}

/**
 * Extract thread metadata from HTML
 * Priority:
 * 1. Extract from _PageData JSON (most reliable)
 * 2. Fallback to HTML parsing (table.dc_bar2 or #d_list)
 * @param {string} html - HTML content
 * @returns {Array} - Array of thread objects {title, date, replies, url}
 */
function extractThreadMetadata(html) {
    const threads = [];
    const seenUrls = new Set();

    // First, try to extract from _PageData JSON (most reliable)
    const pageData = extractPageData(html);
    if (pageData && Array.isArray(pageData) && pageData.length > 0) {
        logger.info("Using _PageData JSON extraction method");
        for (const item of pageData) {
            const thread = convertPageDataToThread(item);
            if (thread && thread.url && !seenUrls.has(thread.url)) {
                seenUrls.add(thread.url);
                threads.push(thread);
            }
        }

        if (threads.length > 0) {
            logger.info("Thread extraction from _PageData complete", {
                threadsFound: threads.length,
            });
            return threads;
        }
    }

    // Fallback to HTML parsing
    logger.info("Falling back to HTML parsing method");
    const $ = cheerio.load(html);

    // Find the specific table first: <table width="998" align="center" bgcolor="#FFFFFF" class="dc_bar2">
    const targetTable = $("table.dc_bar2");

    if (targetTable.length > 0) {
        // Extract links from the target table (all nested links)
        targetTable.find("a").each((i, elem) => {
            const $link = $(elem);
            const href = $link.attr("href");
            // Check if it's a thread link
            if (
                href &&
                (href.includes("index.php?app=forum&act=threadview") ||
                    href.includes("tid="))
            ) {
                const thread = processLink($, elem);
                if (thread && thread.url && !seenUrls.has(thread.url)) {
                    seenUrls.add(thread.url);
                    threads.push(thread);
                }
            }
        });
    } else {
        logger.warn("Target table not found, trying alternative selectors...");
        // Try alternative selectors as fallback
        const altTable = $("table.dc_bar2").first();
        if (altTable.length > 0) {
            altTable.find("a").each((i, elem) => {
                const $link = $(elem);
                const href = $link.attr("href");
                // Check if it's a thread link
                if (
                    href &&
                    (href.includes("index.php?app=forum&act=threadview") ||
                        href.includes("tid="))
                ) {
                    const thread = processLink($, elem);
                    if (thread && thread.url && !seenUrls.has(thread.url)) {
                        seenUrls.add(thread.url);
                        threads.push(thread);
                    }
                }
            });
        }
    }

    // Also search within div with id="d_list" (all nested links, not just direct children)
    const dListDiv = $("#d_list");
    if (dListDiv.length > 0) {
        logger.info(
            "Found d_list div, extracting all links from it (including nested)"
        );
        // Use find() to search all descendants, not just direct children
        dListDiv.find("a").each((i, elem) => {
            const $link = $(elem);
            const href = $link.attr("href");
            // Check if it's a thread link
            if (
                href &&
                (href.includes("index.php?app=forum&act=threadview") ||
                    href.includes("tid="))
            ) {
                const thread = processLink($, elem);
                if (thread && thread.url && !seenUrls.has(thread.url)) {
                    seenUrls.add(thread.url);
                    threads.push(thread);
                }
            }
        });
    } else {
        logger.warn("d_list div not found");
    }

    // If still no threads found, try searching all links in the document for thread links
    // This handles search result pages that use different HTML structures
    if (threads.length === 0) {
        logger.info(
            "No threads found with standard selectors, trying comprehensive link search"
        );
        $("a").each((i, elem) => {
            const $link = $(elem);
            const href = $link.attr("href");
            // Check if it's a thread link (search results often use relative URLs)
            if (
                href &&
                (href.includes("act=threadview") || href.includes("tid="))
            ) {
                const thread = processLink($, elem);
                if (thread && thread.url && !seenUrls.has(thread.url)) {
                    // Additional validation: make sure it's actually a thread link, not a category link
                    const tidMatch = href.match(/tid=(\d+)/);
                    if (tidMatch && tidMatch[1]) {
                        seenUrls.add(thread.url);
                        threads.push(thread);
                    }
                }
            }
        });
        if (threads.length > 0) {
            logger.info("Found threads using comprehensive link search", {
                count: threads.length,
            });
        }
    }

    logger.info("Thread extraction complete", {
        threadsFound: threads.length,
        hasTable: targetTable.length > 0,
        hasDList: dListDiv.length > 0,
        usedPageData: pageData !== null,
    });

    return threads;
}

/**
 * Process a single link element and return thread object
 * @param {Object} $ - Cheerio instance
 * @param {Object} elem - Link element
 * @returns {Object|null} - Thread object or null
 */
function processLink($, elem) {
    const $link = $(elem);
    const href = $link.attr("href");
    const title = $link.text().trim();

    if (!href || !title) {
        return null;
    }

    // Construct full URL
    let url = href;
    if (href.startsWith("index.php")) {
        url = `${COOL18_BASE_URL}/${href}`;
    } else if (href.startsWith("/")) {
        url = `${COOL18_BASE_URL}${href}`;
    } else if (!href.startsWith("http")) {
        url = `${COOL18_BASE_URL}/${href}`;
    }

    // Try to extract thread ID
    const tidMatch = href.match(/tid=(\d+)/);
    const threadId = tidMatch ? tidMatch[1] : null;

    // Try to find date and reply count from nearby elements
    const $row = $link.closest("tr, li, div");
    let date = "";
    let replies = 0;

    // Look for date patterns
    const dateText = $row.find("td, span, div").text();
    const dateMatch = dateText.match(
        /(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2})/
    );
    if (dateMatch) {
        date = dateMatch[1];
    }

    // Look for reply count
    const replyMatch = $row.text().match(/(\d+)\s*(回复|回覆|回复数)/);
    if (replyMatch) {
        replies = parseInt(replyMatch[1]) || 0;
    }

    return {
        title,
        url,
        threadId,
        date,
        replies,
    };
}

/**
 * Search Cool18 forum with keyword
 * @param {string} keyword - Search keyword
 * @param {number} maxPages - Maximum pages to search (default: 10)
 * @returns {Promise<Array>} - Array of thread objects
 */
async function searchForum(keyword, maxPages = MAX_SEARCH_PAGES) {
    if (!keyword) {
        throw new Error("Keyword is required");
    }

    const allThreads = [];
    const seenUrls = new Set();

    try {
        // Cool18 search URL format (may need adjustment)
        // Common patterns: search.php?keyword=, index.php?search=
        const searchBaseUrl = `${COOL18_BASE_URL}/index.php`;

        for (let page = 1; page <= maxPages; page++) {
            try {
                // Construct search URL - this may need to be adjusted based on actual Cool18 search
                // https://www.cool18.com/bbs4/index.php?action=search&bbsdr=bbs4&act=threadsearch&app=forum&keywords=%E3%80%90%E7%98%BE%E3%80%91&submit=%E6%9F%A5%E8%AF%A2
                const searchUrl = `${searchBaseUrl}?action=search&bbsdr=bbs4&act=threadsearch&app=forum&keywords=${encodeURIComponent(
                    keyword
                )}&submit=%E6%9F%A5%E8%AF%A2`;
                //        nst searchUrl = `${searchBaseUrl}?app=forum&act=search&keyword=${encodeURIComponent(keyword)}&page=${page}`;

                logger.debug("Fetching Cool18 search page", { searchUrl });
                const response = await axios.get(searchUrl, {
                    headers: {
                        "User-Agent": USER_AGENT,
                        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                    },
                    timeout: 30000, // Increased timeout for large pages
                    maxContentLength: Infinity, // No limit on response size
                    maxBodyLength: Infinity, // No limit on body size
                    validateStatus: function (status) {
                        return status < 500; // Don't throw on 4xx errors
                    },
                });

                if (response.status !== 200) {
                    logger.warn("Search returned non-200 status", {
                        status: response.status,
                        page,
                    });
                    break;
                }

                // Check for potential truncation
                const contentLength = response.headers["content-length"];
                const htmlString =
                    typeof response.data === "string"
                        ? response.data
                        : String(response.data || "");
                const actualLength = Buffer.byteLength(htmlString, "utf8");

                logger.info("Search page response received", {
                    page,
                    actualByteLength: actualLength,
                    contentLengthHeader: contentLength,
                    htmlLength: htmlString.length,
                    htmlEndsWith:
                        htmlString.length > 100
                            ? htmlString.slice(-100)
                            : htmlString,
                    mightBeTruncated:
                        contentLength && parseInt(contentLength) > actualLength,
                });

                // Check if HTML appears truncated (doesn't end with closing tags)
                // Make check case-insensitive since HTML can have uppercase or lowercase tags
                const trimmedHtml = htmlString.trim();
                const endsWithHtml = /<\/html>$/i.test(trimmedHtml);
                const endsWithBody = /<\/body>$/i.test(trimmedHtml);
                if (htmlString && !endsWithHtml && !endsWithBody) {
                    logger.warn(
                        "HTML response may be truncated - does not end with closing tags",
                        {
                            page,
                            htmlEnd: htmlString.slice(-200),
                        }
                    );
                }

                // Save HTML content to file for examination
                const safeKeyword = keyword
                    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
                    .substring(0, 50);
                const timestamp = new Date()
                    .toISOString()
                    .replace(/[:.]/g, "-");
                const htmlFilename = `search_${safeKeyword}_page${page}_${timestamp}.html`;
                const savedPath = saveHtmlToFile(htmlString, htmlFilename);
                if (savedPath) {
                    logger.info("Search HTML saved", {
                        savedPath,
                        keyword,
                        page,
                    });
                }

                const threads = extractThreadMetadata(response.data);
                logger.info("Threads extracted from search page", {
                    page,
                    threadCount: threads.length,
                });

                // Filter duplicates
                for (const thread of threads) {
                    if (thread.url && !seenUrls.has(thread.url)) {
                        seenUrls.add(thread.url);
                        allThreads.push(thread);
                    }
                }

                // If no threads found on this page, stop
                if (threads.length === 0) {
                    break;
                }

                // Small delay to avoid overwhelming the server
                await new Promise((resolve) => setTimeout(resolve, 500));
            } catch (error) {
                logger.error("Error searching Cool18 page", {
                    page,
                    error: error.message,
                });
                // Continue to next page even if one fails
            }
        }
    } catch (error) {
        logger.error("Error in searchForum", { error });
        throw error;
    }

    return allThreads;
}

/**
 * Download thread content from URL
 * @param {string} url - Thread URL
 * @returns {Promise<Object>} - {title, content, metadata}
 */
async function downloadThread(url) {
    if (!url) {
        throw new Error("URL is required");
    }

    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
            timeout: 30000,
            maxContentLength: Infinity, // No limit on response size
            maxBodyLength: Infinity, // No limit on body size
        });

        const htmlString =
            typeof response.data === "string"
                ? response.data
                : String(response.data || "");

        // Save HTML content to file for examination
        const urlTidMatch = url.match(/tid=(\d+)/);
        const urlThreadId = urlTidMatch ? urlTidMatch[1] : "unknown";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const htmlFilename = `thread_tid${urlThreadId}_${timestamp}.html`;
        const savedPath = saveHtmlToFile(htmlString, htmlFilename);
        if (savedPath) {
            logger.info("Thread HTML saved", {
                savedPath,
                url,
                threadId: urlThreadId,
            });
        }

        const $ = cheerio.load(response.data);

        // Extract title
        let title = $("title").text().trim();
        if (!title) {
            title = $("h1, h2, .title, .thread-title").first().text().trim();
        }

        // Extract content - common selectors for forum posts
        let content = "";
        const contentSelectors = [
            ".post-content",
            ".thread-content",
            ".content",
            "#post-content",
            "td[colspan]",
            ".message",
        ];

        for (const selector of contentSelectors) {
            const $content = $(selector).first();
            if ($content.length > 0) {
                content = $content.text().trim();
                if (content.length > 100) {
                    break;
                }
            }
        }

        // Fallback: get all text from body
        if (!content || content.length < 100) {
            content = $("body").text().trim();
        }

        // Extract thread ID from URL
        const tidMatch = url.match(/tid=(\d+)/);
        const threadId = tidMatch ? tidMatch[1] : null;

        // Extract metadata
        const metadata = {
            url,
            threadId,
            title,
            contentLength: content.length,
        };

        return {
            title,
            content,
            metadata,
        };
    } catch (error) {
        logger.error("Error downloading thread", { url, error });
        throw error;
    }
}

/**
 * Extract thread ID from URL
 * @param {string} url - Thread URL
 * @returns {string|null} - Thread ID or null
 */
function extractThreadId(url) {
    if (!url) return null;
    const match = url.match(/tid=(\d+)/);
    return match ? match[1] : null;
}

/**
 * Extract comprehensive book metadata from a thread page
 * @param {string} url - Thread URL
 * @returns {Promise<Object>} - Book metadata object
 */
async function extractBookMetadata(url) {
    if (!url) {
        throw new Error("URL is required");
    }

    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        const htmlString =
            typeof response.data === "string"
                ? response.data
                : String(response.data || "");
        const $ = cheerio.load(response.data);

        // Extract title
        let title = $("title").text().trim();
        if (!title) {
            title = $("h1, h2, .title, .thread-title").first().text().trim();
        }

        // Extract author from title pattern: "【书名】（14）作者：duty111 - 禁忌书屋"
        let author = null;
        // Match "作者：" followed by text until " - " or end of string
        const authorMatch = title.match(/作者[：:]\s*([^\s-]+)(?:\s*[-－]|$)/);
        if (authorMatch) {
            author = authorMatch[1].trim();
            // Clean up any trailing punctuation
            author = author.replace(/[。，,\.]+$/, '');
        }

        // Extract category from title pattern: "『古风』", "『都市』", etc.
        let category = null;
        const categoryMatch = htmlString.match(
            /<span class=['"]list-type-show['"]>『([^』]+)』<\/span>/
        );
        if (categoryMatch) {
            category = categoryMatch[1].trim();
        }

        // Extract book name from title (remove chapter info, author, category tags)
        const bookDetector = require("./bookDetector");
        let bookName = bookDetector.detectBookName(title);
        if (!bookName || bookName.trim().length < 1) {
            // Fallback: remove common patterns
            bookName = title
                .replace(/作者[：:][^）)【】\s-]+(?:\s*[-－]|$)/g, "") // Remove author: "作者：duty111 - " or "作者：duty111"
                .replace(/『[^』]+』/g, "")
                .replace(/[（(][^）)]+[）)]/g, "") // Remove chapter in parentheses: "（14）"
                .replace(/【([^】]+)】.*/, "$1") // Extract from 【】 if present
                .replace(
                    /第[零一二三四五六七八九十百千万两0-9]+(?:章|回|集|話|篇|部|卷)/g,
                    ""
                )
                .replace(/\s*[-－]\s*.*$/, "") // Remove everything after " - "
                .trim();

            // If still empty, try to extract from 【】 pattern directly
            if (!bookName || bookName.trim().length < 1) {
                const bracketMatch = title.match(/【([^】]+)】/);
                if (bracketMatch && bracketMatch[1]) {
                    bookName = bracketMatch[1].trim();
                }
            }

            // Final fallback: use title as-is if still empty
            if (!bookName || bookName.trim().length < 1) {
                bookName = title.trim();
            }
        }

        // Extract description from content (first 500 characters)
        let description = "";
        const contentSelectors = [
            ".post-content",
            ".thread-content",
            ".content",
            "#post-content",
            "td[colspan]",
            ".message",
        ];

        for (const selector of contentSelectors) {
            const $content = $(selector).first();
            if ($content.length > 0) {
                description = $content.text().trim();
                if (description.length > 100) {
                    break;
                }
            }
        }

        // Limit description to 500 characters
        if (description.length > 500) {
            description = description.substring(0, 500) + "...";
        }

        // Extract tags
        const tagExtractor = require("./tagExtractor");
        const tags = tagExtractor.extractTags(title, description);
        if (category) {
            tags.push(category);
        }

        // Extract thread ID
        const threadId = extractThreadId(url);

        // Extract username/poster from page
        let username = null;
        const usernameMatch = htmlString.match(
            /username['"]\s*:\s*['"]([^'"]+)['"]/
        );
        if (usernameMatch) {
            username = usernameMatch[1];
        }

        // If no author found, use username
        if (!author && username) {
            author = username;
        }

        return {
            bookName: bookName || title,
            author: author || username || "",
            category: category || "",
            description: description || "",
            tags: [...new Set(tags)], // Remove duplicates
            sourceUrl: url,
            threadId: threadId,
            originalTitle: title,
        };
    } catch (error) {
        logger.error("Error extracting book metadata", {
            url,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        });
        throw error;
    }
}

module.exports = {
    searchForum,
    downloadThread,
    extractThreadMetadata,
    extractThreadId,
    extractBookMetadata,
};
