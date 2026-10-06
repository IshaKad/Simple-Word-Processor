const { ipcRenderer } = require("electron");

const editor = document.getElementById("editor");
const wordCount = document.getElementById("word-count");
const charCount = document.getElementById("char-count");
const readingTime = document.getElementById("reading-time");
const autosaveStatus = document.getElementById("autosave-status");
const zoomSlider = document.getElementById("zoom-slider");
const zoomValue = document.getElementById("zoom-value");
const currentFile = document.getElementById("current-file");
const editorView = document.getElementById("editor-view");
const recentView = document.getElementById("recent-view");
const recentFilesList = document.getElementById("recent-files-list");
const backBtn = document.getElementById("back-btn");
const searchPanel = document.getElementById("search-panel");
const findInput = document.getElementById("find-input");
const replaceInput = document.getElementById("replace-input");
const replaceRow = document.getElementById("replace-row");
const matchCount = document.getElementById("match-count");
const findPrevBtn = document.getElementById("find-prev-btn");
const findNextBtn = document.getElementById("find-next-btn");
const replaceOneBtn = document.getElementById("replace-one-btn");
const replaceAllBtn = document.getElementById("replace-all-btn");
const closeSearchBtn = document.getElementById("close-search-btn");
const outlinePanel = document.getElementById("outline-panel");
const outlineList = document.getElementById("outline-list");
const boldBtn = document.getElementById("bold-btn");
const italicBtn = document.getElementById("italic-btn");
const underlineBtn = document.getElementById("underline-btn");
const fontFamilySelect = document.getElementById("font-family-select");
const lineSpacingSelect = document.getElementById("line-spacing-select");
const themeSelect = document.getElementById("theme-select");
const utilityPanel = document.getElementById("utility-panel");
const utilityTitle = document.getElementById("utility-title");
const closeUtilityBtn = document.getElementById("close-utility-btn");
const scratchPanel = document.getElementById("scratch-panel");
const scratchPad = document.getElementById("scratch-pad");
const flashcardsPanel = document.getElementById("flashcards-panel");
const flashcardsList = document.getElementById("flashcards-list");
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");

let currentFileName = "Untitled.txt";
let isDirty = false;
let autoSaveTimer = null;
let searchMatches = [];
let currentMatchIndex = -1;
let typewriterMode = false;
let paragraphFocusMode = false;
let bookmarks = [];
let currentBookmarkIndex = -1;
let flashcards = [];

if (CSS.highlights) {
    CSS.highlights.set(
        "find-matches",
        new Highlight()
    );

    CSS.highlights.set(
        "current-find-match",
        new Highlight()
    );
}

window.writerApp = {
    getContent() {
        return editor.innerText;
    }
};

function getEditorText() {
    return editor.innerText.replace(/\n$/, "");
}

function setEditorText(text) {
    editor.innerText = text;
    clearFindHighlights();
    updateCounts();
    updateOutline();
    updateParagraphFocus();
}

function getWordStats(text) {
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const chars = text.length;

    return {
        words,
        chars
    };
}

function updateTitle() {
    const prefix = isDirty ? "* " : "";

    document.title =
        `${prefix}${currentFileName} - Simple Word Processor`;

    currentFile.textContent =
        `${prefix}${currentFileName}`;
}

function updateCounts() {
    const stats = getWordStats(getEditorText());
    const selectedStats = getSelectedStats();
    const minutes = Math.max(
        1,
        Math.ceil(stats.words / 225)
    );

    wordCount.textContent =
        selectedStats
            ? `Selected: ${selectedStats.words} words`
            : `Words: ${stats.words}`;

    charCount.textContent =
        selectedStats
            ? `Characters: ${selectedStats.chars}`
            : `Characters: ${stats.chars}`;

    readingTime.textContent =
        `Reading Time: ${minutes} min`;
}

function getSelectedStats() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0)
        return null;

    if (!editor.contains(selection.anchorNode))
        return null;

    const text = selection.toString();

    if (!text.trim())
        return null;

    return getWordStats(text);
}

function markDirty() {
    isDirty = true;

    ipcRenderer.send(
        "document-modified"
    );

    updateTitle();
    scheduleAutoSave();
}

function markClean(fileName) {
    if (fileName)
        currentFileName = fileName;

    isDirty = false;

    ipcRenderer.send(
        "document-saved"
    );

    updateTitle();
}

function showEditorView() {
    recentView.classList.add("hidden");
    editorView.classList.remove("hidden");
    editor.focus();
}

function runEditorCommand(command, value = null) {
    editor.focus();

    document.execCommand(
        command,
        false,
        value
    );

    markDirty();
    updateCounts();
    updateOutline();
}

function setTheme(theme) {
    document.body.classList.remove(
        "theme-dark",
        "theme-sepia",
        "theme-midnight"
    );

    if (theme !== "light")
        document.body.classList.add(`theme-${theme}`);

    themeSelect.value = theme;
}

function showUtilityPanel(panelName) {
    utilityPanel.classList.remove("hidden");
    scratchPanel.classList.add("hidden");
    flashcardsPanel.classList.add("hidden");
    historyPanel.classList.add("hidden");

    if (panelName === "scratch") {
        utilityTitle.textContent = "Scratch Pad";
        scratchPanel.classList.remove("hidden");
        scratchPad.focus();
    }

    if (panelName === "flashcards") {
        utilityTitle.textContent = "Flashcards";
        flashcardsPanel.classList.remove("hidden");
        renderFlashcards();
    }

    if (panelName === "history") {
        utilityTitle.textContent = "Version History";
        historyPanel.classList.remove("hidden");
        renderVersionHistory();
    }
}

function toggleUtilityPanel(panelName) {
    const isShowing =
        !utilityPanel.classList.contains("hidden") &&
        !document.getElementById(`${panelName}-panel`)?.classList.contains("hidden");

    if (isShowing) {
        utilityPanel.classList.add("hidden");
        return;
    }

    showUtilityPanel(panelName);
}

function showSearchPanel(showReplace) {
    searchPanel.classList.remove("hidden");
    replaceRow.classList.toggle("hidden", !showReplace);
    document.body.classList.toggle("replace-open", showReplace);
    findInput.focus();
    findInput.select();
    runFind();
}

function hideSearchPanel() {
    searchPanel.classList.add("hidden");
    document.body.classList.remove("replace-open");
    clearFindHighlights();
    editor.focus();
}

function getTextNodes(root) {
    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
    );

    const nodes = [];
    let node = walker.nextNode();

    while (node) {
        nodes.push(node);
        node = walker.nextNode();
    }

    return nodes;
}

function getEditorBlocks() {
    const blocks = [];
    const childNodes = Array.from(editor.childNodes);

    childNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const text = node.innerText || node.textContent || "";

            if (text.trim()) {
                blocks.push({
                    node,
                    text
                });
            }

            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            const pieces = node.nodeValue.split("\n");
            let offset = 0;

            pieces.forEach(piece => {
                if (piece.trim()) {
                    blocks.push({
                        node,
                        text: piece,
                        offset
                    });
                }

                offset += piece.length + 1;
            });
        }
    });

    if (blocks.length === 0 && editor.innerText.trim()) {
        blocks.push({
            node: editor,
            text: editor.innerText
        });
    }

    return blocks;
}

function clearFindHighlights() {
    searchMatches = [];
    currentMatchIndex = -1;

    if (CSS.highlights) {
        CSS.highlights.get("find-matches").clear();
        CSS.highlights.get("current-find-match").clear();
    }

    matchCount.textContent = "0 matches";
}

function runFind() {
    clearFindHighlights();

    const query = findInput.value;

    if (!query)
        return;

    const lowerQuery = query.toLowerCase();
    const textNodes = getTextNodes(editor);

    textNodes.forEach(node => {
        const text = node.nodeValue;
        const lowerText = text.toLowerCase();
        let index = lowerText.indexOf(lowerQuery);

        while (index !== -1) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + query.length);
            searchMatches.push(range);

            if (CSS.highlights) {
                CSS.highlights.get("find-matches").add(range);
            }

            index = lowerText.indexOf(
                lowerQuery,
                index + query.length
            );
        }
    });

    if (searchMatches.length > 0) {
        currentMatchIndex = 0;
        focusCurrentMatch();
    }

    matchCount.textContent =
        `${searchMatches.length} match${searchMatches.length === 1 ? "" : "es"}`;
}

function focusCurrentMatch() {
    if (currentMatchIndex < 0 || searchMatches.length === 0)
        return;

    const range = searchMatches[currentMatchIndex];

    if (CSS.highlights) {
        const currentHighlight =
            CSS.highlights.get("current-find-match");

        currentHighlight.clear();
        currentHighlight.add(range);
    }

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    range.startContainer.parentElement?.scrollIntoView({
        block: "center"
    });

    matchCount.textContent =
        `${currentMatchIndex + 1} of ${searchMatches.length}`;
}

function moveFind(direction) {
    if (searchMatches.length === 0)
        return;

    currentMatchIndex =
        (currentMatchIndex + direction + searchMatches.length) %
        searchMatches.length;

    focusCurrentMatch();
}

function replaceCurrent() {
    if (currentMatchIndex < 0 || searchMatches.length === 0)
        return;

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(searchMatches[currentMatchIndex]);
    document.execCommand(
        "insertText",
        false,
        replaceInput.value
    );

    markDirty();
    updateCounts();
    updateOutline();
    runFind();
}

function replaceAll() {
    const query = findInput.value;

    if (!query)
        return;

    const text = getEditorText();
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "gi");
    const replaced = text.replace(pattern, replaceInput.value);

    if (replaced === text)
        return;

    setEditorText(replaced);
    markDirty();
    runFind();
}

function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);

    autoSaveTimer = setTimeout(
        autoSave,
        30000
    );
}

async function autoSave() {
    if (!isDirty)
        return;

    autosaveStatus.textContent = "Auto saving...";

    const result =
        await ipcRenderer.invoke(
            "auto-save-document",
            getEditorText()
        );

    if (!result) {
        autosaveStatus.textContent = "Auto Save: waiting for first save";
        return;
    }

    markClean(result.fileName);
    autosaveStatus.textContent =
        `Auto saved ${new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        })}`;
}

function updateOutline() {
    const blocks = getEditorBlocks();
    const headings = [];

    blocks.forEach((block, index) => {
        const trimmed = block.text.trim();
        const markdownHeading = trimmed.match(/^(#{1,3})\s+(.+)/);
        const titleLike =
            !markdownHeading &&
            trimmed.length > 0 &&
            trimmed.length <= 80 &&
            !/[.!?,;:]$/.test(trimmed);

        if (markdownHeading || titleLike) {
            headings.push({
                title: markdownHeading ? markdownHeading[2] : trimmed,
                block,
                level: markdownHeading ? markdownHeading[1].length : 1
            });
        }
    });

    outlineList.innerHTML = "";

    if (headings.length === 0) {
        const empty = document.createElement("p");
        empty.className = "outline-empty";
        empty.textContent = "Use short lines or # headings to build an outline.";
        outlineList.appendChild(empty);
        return;
    }

    headings.forEach(heading => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `outline-item level-${heading.level}`;
        item.textContent = heading.title;

        item.addEventListener(
            "click",
            () => moveCursorToBlock(heading.block)
        );

        outlineList.appendChild(item);
    });
}

function moveCursorToBlock(block) {
    const range = document.createRange();

    if (block.node.nodeType === Node.TEXT_NODE) {
        range.setStart(
            block.node,
            block.offset || 0
        );
    } else if (block.node.firstChild) {
        range.setStart(
            block.node.firstChild,
            0
        );
    } else {
        range.setStart(
            block.node,
            0
        );
    }

    range.collapse(true);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const target =
        block.node.nodeType === Node.TEXT_NODE
            ? block.node.parentElement
            : block.node;

    target.scrollIntoView({
        block: "center"
    });

    editor.focus();
    updateParagraphFocus();
    keepCursorCentered();
}

function keepCursorCentered() {
    if (!typewriterMode)
        return;

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0)
        return;

    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();

    if (!rect || rect.top === 0)
        return;

    const editorRect = editor.getBoundingClientRect();
    const cursorCenter = rect.top + rect.height / 2;
    const editorCenter = editorRect.top + editorRect.height / 2;

    editor.scrollTop += cursorCenter - editorCenter;
}

function getCurrentBlock() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0)
        return null;

    let node = selection.anchorNode;

    while (node && node !== editor) {
        if (node.parentNode === editor)
            return node.nodeType === Node.ELEMENT_NODE
                ? node
                : node.parentElement;

        node = node.parentNode;
    }

    return null;
}

function updateParagraphFocus() {
    const blocks = getEditorBlocks();
    const currentBlock = getCurrentBlock();

    blocks.forEach(block => {
        const node =
            block.node.nodeType === Node.TEXT_NODE
                ? block.node.parentElement
                : block.node;

        node.classList?.toggle(
            "current-paragraph",
            paragraphFocusMode && node === currentBlock
        );
    });
}

function insertCodeBlock() {
    runEditorCommand(
        "insertHTML",
        '<pre class="code-block"><code>// code</code></pre><div><br></div>'
    );
}

function insertFormulaBlock() {
    runEditorCommand(
        "insertHTML",
        '<div class="formula-block">Formula: </div><div><br></div>'
    );
}

function addBookmark() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0)
        return;

    const id =
        `bookmark-${Date.now()}`;

    const marker = document.createElement("span");
    marker.className = "bookmark-anchor";
    marker.dataset.bookmarkId = id;
    marker.textContent = "";

    const range = selection.getRangeAt(0);
    range.insertNode(marker);

    bookmarks.push(id);
    currentBookmarkIndex = bookmarks.length - 1;
    markDirty();
}

function jumpToNextBookmark() {
    bookmarks = bookmarks.filter(id =>
        document.querySelector(`[data-bookmark-id="${id}"]`)
    );

    if (bookmarks.length === 0)
        return;

    currentBookmarkIndex =
        (currentBookmarkIndex + 1) % bookmarks.length;

    const marker =
        document.querySelector(
            `[data-bookmark-id="${bookmarks[currentBookmarkIndex]}"]`
        );

    marker.scrollIntoView({
        block: "center"
    });

    const range = document.createRange();
    range.setStartAfter(marker);
    range.collapse(true);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
}

function generateFlashcard() {
    const selection = window.getSelection();
    const selectedText =
        selection ? selection.toString().trim() : "";

    if (!selectedText)
        return;

    const words = selectedText.split(/\s+/);
    const subject = words.slice(0, 4).join(" ");
    const answer = selectedText.replace(/[.!?]$/, "");

    flashcards.unshift({
        question: `What is ${subject}?`,
        answer
    });

    showUtilityPanel("flashcards");
}

function renderFlashcards() {
    flashcardsList.innerHTML = "";

    if (flashcards.length === 0) {
        const empty = document.createElement("p");
        empty.className = "outline-empty";
        empty.textContent = "Select text, then use Insert > Flashcard from Selection.";
        flashcardsList.appendChild(empty);
        return;
    }

    flashcards.forEach(card => {
        const item = document.createElement("div");
        const question = document.createElement("strong");
        const answer = document.createElement("span");

        item.className = "flashcard";
        question.textContent = `Q: ${card.question}`;
        answer.textContent = `A: ${card.answer}`;

        item.appendChild(question);
        item.appendChild(answer);
        flashcardsList.appendChild(item);
    });
}

function getExportHtml() {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${currentFileName}</title>
<style>
body{font-family:${fontFamilySelect.value},sans-serif;line-height:${lineSpacingSelect.value};padding:48px;color:#1f2933}
pre{background:#f2f4f7;padding:14px;white-space:pre-wrap}
.formula-block{font-family:Georgia,serif;background:#fff8db;padding:12px}
</style>
</head>
<body>${editor.innerHTML}</body>
</html>`;
}

function getExportMarkdown() {
    return getEditorText();
}

async function exportDocument(type) {
    const payload =
        type === "html"
            ? {
                content: getExportHtml()
            }
            : type === "markdown"
                ? {
                    content: getExportMarkdown()
                }
                : {
                    html: getExportHtml()
                };

    await ipcRenderer.invoke(
        "export-document",
        type,
        payload
    );
}

async function renderVersionHistory() {
    historyList.innerHTML = "";

    const versions =
        await ipcRenderer.invoke(
            "get-version-history"
        );

    if (versions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "outline-empty";
        empty.textContent = "No saved versions yet.";
        historyList.appendChild(empty);
        return;
    }

    versions.forEach(version => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "history-item";
        item.textContent = version.label;

        item.addEventListener(
            "click",
            async () => {
                const content =
                    await ipcRenderer.invoke(
                        "restore-version",
                        version.filePath
                    );

                setEditorText(content);
                markDirty();
                showEditorView();
            }
        );

        historyList.appendChild(item);
    });
}

function renderRecentFiles(files) {
    recentFilesList.innerHTML = "";

    if (files.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No recent files found.";
        recentFilesList.appendChild(empty);
        return;
    }

    files.forEach(file => {
        const fileName = file.split(/[\\/]/).pop();
        const item = document.createElement("button");
        const name = document.createElement("strong");
        const path = document.createElement("small");

        item.type = "button";
        item.className = "recent-file";
        name.textContent = fileName;
        path.textContent = file;

        item.appendChild(name);
        item.appendChild(path);

        item.addEventListener(
            "click",
            async () => {
                const result =
                    await ipcRenderer.invoke(
                        "open-recent-file",
                        file
                    );

                if (result.canceled)
                    return;

                if (!result.success) {
                    alert(
                        "Could not open file. It may have moved or been deleted."
                    );
                    return;
                }

                setEditorText(result.content);
                markClean(result.fileName || fileName);
                showEditorView();
            }
        );

        recentFilesList.appendChild(item);
    });
}

editor.addEventListener(
    "input",
    () => {
        updateCounts();
        updateOutline();
        runFind();
        updateParagraphFocus();
        keepCursorCentered();
        markDirty();
    }
);

document.addEventListener(
    "selectionchange",
    () => {
        updateCounts();
        updateParagraphFocus();
    }
);

zoomSlider.addEventListener(
    "input",
    () => {
        const zoom = zoomSlider.value;
        zoomValue.textContent = `${zoom}%`;
        editor.style.fontSize = `${(zoom / 100) * 16}px`;
    }
);

findInput.addEventListener("input", runFind);
findPrevBtn.addEventListener("click", () => moveFind(-1));
findNextBtn.addEventListener("click", () => moveFind(1));
replaceOneBtn.addEventListener("click", replaceCurrent);
replaceAllBtn.addEventListener("click", replaceAll);
closeSearchBtn.addEventListener("click", hideSearchPanel);
boldBtn.addEventListener("click", () => runEditorCommand("bold"));
italicBtn.addEventListener("click", () => runEditorCommand("italic"));
underlineBtn.addEventListener("click", () => runEditorCommand("underline"));
fontFamilySelect.addEventListener(
    "change",
    () => runEditorCommand(
        "fontName",
        fontFamilySelect.value
    )
);
lineSpacingSelect.addEventListener(
    "change",
    () => {
        editor.style.lineHeight = lineSpacingSelect.value;
    }
);
themeSelect.addEventListener(
    "change",
    () => setTheme(themeSelect.value)
);
closeUtilityBtn.addEventListener(
    "click",
    () => utilityPanel.classList.add("hidden")
);

document.addEventListener(
    "keydown",
    event => {
        if (event.key === "Escape" && !searchPanel.classList.contains("hidden")) {
            hideSearchPanel();
        }

        if (event.ctrlKey && event.key === "F2") {
            event.preventDefault();
            addBookmark();
        }

        if (!event.ctrlKey && event.key === "F2") {
            event.preventDefault();
            jumpToNextBookmark();
        }
    }
);

editor.addEventListener(
    "keyup",
    keepCursorCentered
);

editor.addEventListener(
    "click",
    () => {
        updateParagraphFocus();
        keepCursorCentered();
    }
);

ipcRenderer.on(
    "file-name-changed",
    (event, fileName) => {
        currentFileName = fileName;
        updateTitle();
    }
);

ipcRenderer.on(
    "document-clean",
    (event, fileName) => {
        markClean(fileName);
    }
);

ipcRenderer.on(
    "new-file",
    () => {
        setEditorText("");
        currentFileName = "Untitled.txt";
        isDirty = false;
        autosaveStatus.textContent = "Auto Save: waiting for first save";
        updateTitle();
        editor.focus();
    }
);

ipcRenderer.on(
    "open-file",
    (event, content) => {
        setEditorText(content);
        isDirty = false;
        autosaveStatus.textContent = "Auto Save: on";
        updateTitle();
        showEditorView();
    }
);

ipcRenderer.on(
    "save-file",
    async () => {
        const result =
            await ipcRenderer.invoke(
                "save-document",
                getEditorText()
            );

        if (result) {
            markClean(result.fileName);
            autosaveStatus.textContent = "Auto Save: on";
        }
    }
);

ipcRenderer.on(
    "save-as-file",
    async () => {
        const result =
            await ipcRenderer.invoke(
                "save-document-as",
                getEditorText()
            );

        if (result) {
            markClean(result.fileName);
            autosaveStatus.textContent = "Auto Save: on";
        }
    }
);

ipcRenderer.on(
    "show-recent-files",
    async () => {
        const files =
            await ipcRenderer.invoke(
                "get-recent-files"
            );

        editorView.classList.add("hidden");
        recentView.classList.remove("hidden");
        renderRecentFiles(files);
    }
);

ipcRenderer.on(
    "show-find",
    () => showSearchPanel(false)
);

ipcRenderer.on(
    "show-replace",
    () => showSearchPanel(true)
);

ipcRenderer.on(
    "toggle-dark-mode",
    (event, enabled) => {
        setTheme(enabled ? "dark" : "light");
    }
);

ipcRenderer.on(
    "set-theme",
    (event, theme) => setTheme(theme)
);

ipcRenderer.on(
    "toggle-word-wrap",
    (event, enabled) => {
        editor.classList.toggle("no-wrap", !enabled);
    }
);

ipcRenderer.on(
    "toggle-focus-mode",
    () => {
        document.body.classList.toggle("focus-mode");
        editor.focus();
    }
);

ipcRenderer.on(
    "toggle-typewriter-mode",
    () => {
        typewriterMode = !typewriterMode;
        document.body.classList.toggle("typewriter-mode", typewriterMode);
        keepCursorCentered();
    }
);

ipcRenderer.on(
    "toggle-paragraph-focus",
    () => {
        paragraphFocusMode = !paragraphFocusMode;
        document.body.classList.toggle(
            "paragraph-focus-mode",
            paragraphFocusMode
        );
        updateParagraphFocus();
    }
);

ipcRenderer.on(
    "format-command",
    (event, command) => runEditorCommand(command)
);

ipcRenderer.on(
    "insert-code-block",
    insertCodeBlock
);

ipcRenderer.on(
    "insert-formula-block",
    insertFormulaBlock
);

ipcRenderer.on(
    "generate-flashcard",
    generateFlashcard
);

ipcRenderer.on(
    "toggle-scratch-pad",
    () => toggleUtilityPanel("scratch")
);

ipcRenderer.on(
    "toggle-flashcards",
    () => toggleUtilityPanel("flashcards")
);

ipcRenderer.on(
    "export-pdf",
    () => exportDocument("pdf")
);

ipcRenderer.on(
    "export-markdown",
    () => exportDocument("markdown")
);

ipcRenderer.on(
    "export-html",
    () => exportDocument("html")
);

ipcRenderer.on(
    "show-version-history",
    () => showUtilityPanel("history")
);

ipcRenderer.on(
    "toggle-outline",
    () => {
        outlinePanel.classList.toggle("hidden");
        updateOutline();
    }
);

backBtn.addEventListener(
    "click",
    showEditorView
);

setInterval(
    autoSave,
    60000
);

updateCounts();
updateOutline();
updateTitle();
