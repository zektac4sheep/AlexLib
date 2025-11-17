/**
 * Simple test to verify duplicate chapter filtering logic
 * Tests the core logic without requiring all dependencies
 */

const { extractChapterNumber } = require("./services/chapterExtractor");

// Simulate the duplicate filtering logic from detectChapters
function testDuplicateFiltering(content) {
    const lines = content.split("\n");
    const seenChapterNumbers = new Set();
    const extractedChapters = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const chapterInfo = extractChapterNumber(line);
        if (chapterInfo) {
            const chapterKey = chapterInfo.isFinal ? "終" : chapterInfo.number;
            
            // Skip if we've already seen this chapter number (only use first instance)
            if (seenChapterNumbers.has(chapterKey)) {
                console.log(`  [SKIP] Line ${i + 1}: Duplicate chapter ${chapterKey} - "${line.substring(0, 50)}..."`);
                continue;
            }
            
            // Mark as seen and record
            seenChapterNumbers.add(chapterKey);
            extractedChapters.push({
                line: i + 1,
                number: chapterInfo.number,
                isFinal: chapterInfo.isFinal,
                key: chapterKey,
                match: chapterInfo.fullMatch,
                preview: line.substring(0, 60)
            });
            console.log(`  [KEEP] Line ${i + 1}: First instance of chapter ${chapterKey} - "${line.substring(0, 50)}..."`);
        }
    }
    
    return extractedChapters;
}

// Test with sample content that has duplicates
const testContent = `妻的風箏線（２）第一章
Some content here
妻的風箏線（２）重复的第二章
More content
妻的風箏線（３）第三章
Even more content
妻的風箏線（２）又一个重复的第二章
Final content
終章
`;

console.log("=".repeat(80));
console.log("Testing Duplicate Chapter Filtering");
console.log("=".repeat(80));
console.log("\nTest content:");
console.log(testContent);
console.log("\nProcessing...\n");

const result = testDuplicateFiltering(testContent);

console.log("\n" + "=".repeat(80));
console.log("Results:");
console.log("=".repeat(80));
console.log(`Total unique chapters extracted: ${result.length}`);
result.forEach(ch => {
    const numDisplay = ch.isFinal ? "終" : ch.number;
    console.log(`  - Chapter ${numDisplay} (line ${ch.line}): "${ch.preview}..."`);
});
console.log("=".repeat(80));

