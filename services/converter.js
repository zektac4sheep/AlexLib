/**
 * Chinese Converter Service
 * Wrapper around opencc-js for Simplified ↔ Traditional conversion
 * Uses HK variant for Traditional Chinese
 */

const { Converter } = require("opencc-js");
const logger = require("../utils/logger");

// Initialize converters
const s2tConverter = Converter({ from: "cn", to: "hk" });
const t2sConverter = Converter({ from: "hk", to: "cn" });

/**
 * Convert Simplified Chinese to Traditional Chinese (HK variant)
 * @param {string} text - Text in Simplified Chinese
 * @returns {string} - Text in Traditional Chinese
 */
function toTraditional(text) {
    if (!text) return "";
    try {
        return s2tConverter(text);
    } catch (error) {
        logger.error("Error converting to Traditional Chinese", { error });
        return text;
    }
}

/**
 * Convert Traditional Chinese to Simplified Chinese
 * @param {string} text - Text in Traditional Chinese
 * @returns {string} - Text in Simplified Chinese
 */
function toSimplified(text) {
    if (!text) return "";
    try {
        return t2sConverter(text);
    } catch (error) {
        logger.error("Error converting to Simplified Chinese", { error });
        return text;
    }
}

/**
 * Convert book name for UI display (Simplified → Traditional)
 * @param {string} bookNameSimplified - Book name in Simplified Chinese
 * @returns {string} - Book name in Traditional Chinese for display
 */
function convertBookNameForDisplay(bookNameSimplified) {
    return toTraditional(bookNameSimplified);
}

/**
 * Convert book name for Joplin export (Simplified → Traditional)
 * @param {string} bookNameSimplified - Book name in Simplified Chinese
 * @returns {string} - Book name in Traditional Chinese for Joplin
 */
function convertBookNameForJoplin(bookNameSimplified) {
    return toTraditional(bookNameSimplified);
}

/**
 * Convert full-width English characters and numbers to half-width
 * @param {string} text - Text to normalize
 * @returns {string} - Text with half-width English characters and numbers
 */
function normalizeToHalfWidth(text) {
    if (!text) return text;

    // Full-width to half-width mapping for English characters and numbers
    const fullToHalf = {
        Ａ: "A",
        Ｂ: "B",
        Ｃ: "C",
        Ｄ: "D",
        Ｅ: "E",
        Ｆ: "F",
        Ｇ: "G",
        Ｈ: "H",
        Ｉ: "I",
        Ｊ: "J",
        Ｋ: "K",
        Ｌ: "L",
        Ｍ: "M",
        Ｎ: "N",
        Ｏ: "O",
        Ｐ: "P",
        Ｑ: "Q",
        Ｒ: "R",
        Ｓ: "S",
        Ｔ: "T",
        Ｕ: "U",
        Ｖ: "V",
        Ｗ: "W",
        Ｘ: "X",
        Ｙ: "Y",
        Ｚ: "Z",
        ａ: "a",
        ｂ: "b",
        ｃ: "c",
        ｄ: "d",
        ｅ: "e",
        ｆ: "f",
        ｇ: "g",
        ｈ: "h",
        ｉ: "i",
        ｊ: "j",
        ｋ: "k",
        ｌ: "l",
        ｍ: "m",
        ｎ: "n",
        ｏ: "o",
        ｐ: "p",
        ｑ: "q",
        ｒ: "r",
        ｓ: "s",
        ｔ: "t",
        ｕ: "u",
        ｖ: "v",
        ｗ: "w",
        ｘ: "x",
        ｙ: "y",
        ｚ: "z",
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
        "　": " ", // Full-width space to half-width space
    };

    let normalized = text;
    for (const [full, half] of Object.entries(fullToHalf)) {
        normalized = normalized.replace(new RegExp(full, "g"), half);
    }

    return normalized;
}

module.exports = {
    toTraditional,
    toSimplified,
    convertBookNameForDisplay,
    convertBookNameForJoplin,
    normalizeToHalfWidth,
};
