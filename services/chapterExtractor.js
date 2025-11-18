/**
 * Chapter Number Extractor
 * Extracts chapter numbers from titles (第XXX章/回/集/話/篇)
 */

// Chinese number to integer conversion
const chineseNumbers = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    百: 100,
    千: 1000,
    万: 10000,
};

function chineseToNumber(chinese) {
    if (!chinese) {
        return 0;
    }

    // Convert full-width digits to half-width first
    const fullWidthToHalf = {
        "０": "0",
        "１": "1",
        "２": "2",
        "３": "3",
        "４": "4",
        "５": "5",
        "６": "6",
        "７": "7",
        "８": "8",
        "９": "9",
    };

    let normalized = chinese;
    for (const [full, half] of Object.entries(fullWidthToHalf)) {
        normalized = normalized.replace(new RegExp(full, "g"), half);
    }

    // If it's all digits after normalization, parse as integer
    if (/^\d+$/.test(normalized)) {
        return parseInt(normalized) || 0;
    }

    let result = 0;
    let temp = 0;

    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        const num = chineseNumbers[char];

        if (num === undefined) {
            continue;
        }

        if (num < 10) {
            // Single digit: if temp >= 10, add to temp (e.g., 五十六: 50 + 6)
            // Otherwise, set temp to this digit
            if (temp >= 10) {
                temp = temp + num;
            } else {
                temp = num;
            }
        } else if (num === 10) {
            // 十 (10): if temp is 0, it's just 10; otherwise multiply temp by 10
            if (temp === 0) {
                temp = 10;
            } else {
                temp = temp * 10;
            }
        } else if (num === 100) {
            // 百 (100): multiply temp by 100 and add to result, then reset temp
            if (temp === 0) {
                temp = 100;
            } else {
                result += temp * 100;
                temp = 0;
            }
        } else if (num === 1000) {
            // 千 (1000): multiply temp by 1000 and add to result, then reset temp
            if (temp === 0) {
                temp = 1000;
            } else {
                result += temp * 1000;
                temp = 0;
            }
        } else if (num === 10000) {
            // 万 (10000): multiply everything by 10000
            result = (result + temp) * 10000;
            temp = 0;
        }
    }

    // Add remaining temp to result
    return result + temp;
}

/**
 * Extract chapter number from title
 * Supports: 第1章, 第126章, 第零一章, 第一章, (44-46), （44-46）, etc.
 * For ranges like (44-46), extracts the first number (44)
 * @param {string} title - Chapter title
 * @returns {Object|null} - {number: 126, format: "章", fullMatch: "第126章"} or null
 */
function extractChapterNumber(title) {
    if (!title) return null;

    // Pattern: 第[零一二三四五六七八九十百两0-9]+(?:部[分]|季[度]|章|卷[书经]|篇[篇经文]|[部集])
    // Only match valid chapter markers: 章, 回, 集, 話, 篇, 部, 卷
    // Do NOT match: 張 (sheet), 天 (day), etc.
    // Full-width digits: ０１２３４５６７８９
    const fullWidthDigits = "０１２３４５６７８９";
    const digitPattern = `[零一二三四五六七八九十百千万两0-9${fullWidthDigits}]`;

    const patterns = [
        // Pattern 0: "（終）" - parentheses with 終 (check this first before other patterns)
        /[（(]終[）)]/,
        // Pattern 0.5: "（44-46）" or "（44－46）" - parentheses with number range (extract first number)
        // Matches: (44-46), （44-46）, (44－46), （44－46）, etc.
        // Handles both half-width and full-width dashes/hyphens: - and －
        new RegExp(
            `[（(【〔〖〝「『]\\s*(${digitPattern}+)\\s*[-－~～]\\s*${digitPattern}+\\s*[）)】〕〗〞」』]`
        ),
        // Pattern 1: 第XXX章/回/集/話/篇/部/卷/終 (with valid chapter marker, including 終)
        new RegExp(`第(${digitPattern}+)(章|回|集|話|篇|部|卷|終)`),
        // Pattern 1b: 終章/終回/終集 (終 as standalone marker)
        /終(章|回|集|話|篇|部|卷)?/,
        // Pattern 2: "bookname（3）chaptername" format - parentheses with number
        // Matches: 妻的風箏線（７）三十天的免費妓女, bookname（3）chaptername, etc.
        // Also matches with spaces: bookname （3） chaptername, bookname（3） chaptername, etc.
        new RegExp(`\\s*[（(]\\s*(${digitPattern}+)\\s*[）)]\\s*`),
        // Pattern 3: "（14）" or "（一）" - parentheses with number (only if followed by valid chapter marker or end of string)
        new RegExp(
            `[（(【〔〖〝「『](${digitPattern}+)[）)】〕〗〞」』](?=\\s*(?:章|回|集|話|篇|部|卷|終|$|\\s|：|:))`
        ),
        // Pattern 4: 第XXX (only if followed by valid chapter marker, whitespace, or end of string - but NOT 張, 天, etc.)
        new RegExp(
            `第(${digitPattern}+)(?=\\s*(?:章|回|集|話|篇|部|卷|終|$|\\s|：|:))`
        ),
    ];

    for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        const match = title.match(pattern);
        if (match) {
            // Check if it's the "（終）" pattern (Pattern 0)
            if (i === 0 && match[0].includes("終")) {
                return {
                    number: -1, // Special sentinel value for "終" (will be converted to max+1 by caller)
                    format: "",
                    fullMatch: match[0],
                    isFinal: true, // Flag to indicate this is "終"
                };
            }

            // Check if it's the "終" pattern (Pattern 1b)
            if (i === 2 && match[0].includes("終")) {
                return {
                    number: -1, // Special sentinel value for "終" (will be converted to max+1 by caller)
                    format: match[1] || "章",
                    fullMatch: match[0],
                    isFinal: true, // Flag to indicate this is "終"
                };
            }

            const numberStr = match[1] || match[2];
            const format = match[2] || "";

            // Check if format is "終"
            if (format === "終") {
                return {
                    number: -1, // Special sentinel value for "終"
                    format: "終",
                    fullMatch: match[0],
                    isFinal: true,
                };
            }

            const number = chineseToNumber(numberStr);

            if (number > 0) {
                return {
                    number,
                    format,
                    fullMatch: match[0],
                };
            }
        }
    }

    return null;
}

/**
 * Normalize chapter title
 * @param {string} title - Raw chapter title
 * @returns {string} - Normalized title
 */
function normalizeChapterTitle(title) {
    if (!title) return "";

    // Remove extra whitespace
    let normalized = title.trim();

    // Remove common prefixes/suffixes that might interfere
    normalized = normalized.replace(/^【.*?】/, "");
    normalized = normalized.replace(/^\[.*?\]/, "");

    return normalized.trim();
}

module.exports = {
    extractChapterNumber,
    normalizeChapterTitle,
};
