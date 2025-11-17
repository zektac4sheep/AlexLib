Here’s a clear set of formatting rules specifically optimized for reading long web novels on phones in Markdown (especially when you plan to use a [TOC] at the top). The goal is maximum comfort on small screens, fast scrolling, and clean appearance.

### 1. File Structure

-   One giant .md file (or one file per volume if it gets too big)
-   At the very top:

    ```
    # Novel Title

    [TOC]

    ```

-   Every chapter starts with a level-2 header (most Markdown readers treat ## as collapsible sections and TOC entries)

### 2. Chapter Header Format

Always exactly like this (no exceptions, so TOC works perfectly):

```
## 第1章 章节标题
```

or

```
## 序章
## 外传① 某某某
```

→ One blank line before the header  
→ One blank line after the header

### 3. Paragraph Rules (most important for phone reading)

-   Every paragraph gets a blank line before it (i.e. separate paragraphs with an empty line, the standard Markdown way).
-   Do NOT indent the first line (phones have narrow screens; indentation wastes space and looks bad).
-   Target line length: 30–45 Chinese characters per line is ideal on phones.  
    → When a paragraph is very long, manually insert a line break (soft return) at natural phrase boundaries so no line exceeds ~50 characters.  
    → Never let a line go beyond 60 characters (most phone screens in portrait mode will wrap ugly or need horizontal scroll).

Correct example:

```
「喂，你在听吗？」

少女微微歪头，露出一抹疑惑的表情。

「当然在听啦。」
我一边说着，一边把视线从手机屏幕移开。
虽然实际上有一半以上都听漏了，但这种时候还是得装作认真听的样子。
```

### 4. Dialogue Rules

-   Every piece of dialogue starts on a new line.
-   Speaking verb (说、问道、喊道 etc.) stays on the same line as the dialogue when short.
-   If the speaking verb part is long, break it to the next line.

Good:

```
「今天天气真好呢。」小樱笑着说。

「是啊，适合出去玩。」
我立刻附和。
```

Also acceptable when the tag is long:

```
「你到底在想什么啊！」
她突然提高了音量，
脸颊因为愤怒而微微泛红。
```

### 5. Punctuation & Spacing

-   Full-width Chinese punctuation only (，。！？「」『』《》 etc.)
-   No space after opening quotation 「 and no space before closing 」
-   No space before or after em-dashes — (or use ——)
-   Ellipsis: use …… (two full-width ellipses) or … (one Unicode ellipsis), never ......
-   Onomatopoeia or sound effects: usually put on their own line, centered with spaces or just left-aligned.

Example:

```
咚、咚、咚。

急促的敲门声在深夜响起。
```

### 6. Thoughts, Emphasis, Sound Effects

-   Thoughts: usually surrounded by 「」same as dialogue, or use _italics_ if you want to distinguish
-   Strong emphasis: **粗体** or ～～波浪号～ (common in web novels)
-   Sound effects: often **粗体** or on separate line

### 7. Scene Breaks / POV Changes

Use one of these centered dividers (three lines total):

```
*　*　*

———

～～～～～
```

### 8. Summary of the Golden Rules for Phone Comfort

1. Chapter → always ## exactly
2. One blank line before and after every header
3. One blank line between every paragraph
4. Manual soft line breaks inside long paragraphs (~40 chars max per line)
5. Dialogue always starts on a new line
6. No first-line indentations ever
7. Keep lines short enough that nothing overflows on a 1080p phone in portrait

Follow these and your novel will look extremely clean and pleasant to read on any phone Markdown reader (Obsidian, Markor, Joplin, Typora mobile, iA Writer, etc.). Readers will thank you because their thumbs won’t have to scroll horizontally and their eyes won’t get tired from super long lines.
