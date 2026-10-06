const {
    app,
    BrowserWindow,
    Menu,
    dialog,
    ipcMain
} = require("electron");

const fs = require("fs");
const path = require("path");

const USER_DATA_PATH = path.join(
    __dirname,
    ".app-data"
);

app.setPath(
    "userData",
    USER_DATA_PATH
);

app.setPath(
    "cache",
    path.join(
        USER_DATA_PATH,
        "Cache"
    )
);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

let mainWindow;
let currentFilePath = null;
let hasUnsavedChanges = false;
let isClosingConfirmed = false;

const RECENT_FILES_PATH = path.join(
    app.getPath("userData"),
    "recent-files.json"
);

const BACKUPS_PATH = path.join(
    app.getPath("userData"),
    "backups"
);

function loadRecentFiles() {

    try {

        if (!fs.existsSync(RECENT_FILES_PATH))
            return [];

        return JSON.parse(
            fs.readFileSync(
                RECENT_FILES_PATH,
                "utf8"
            )
        );

    } catch {

        return [];
    }
}

function saveRecentFiles(files) {

    fs.writeFileSync(
        RECENT_FILES_PATH,
        JSON.stringify(
            files,
            null,
            2
        )
    );
}

function addRecentFile(filePath) {

    let files = loadRecentFiles();

    files = files.filter(
        file => file !== filePath
    );

    files.unshift(filePath);

    files = files.slice(0, 10);

    saveRecentFiles(files);
}

function removeRecentFile(filePath) {

    const files = loadRecentFiles().filter(
        file => file !== filePath
    );

    saveRecentFiles(files);
}

function ensureDirectory(directoryPath) {

    if (!fs.existsSync(directoryPath))
        fs.mkdirSync(
            directoryPath,
            {
                recursive: true
            }
        );
}

function getBackupKey(filePath) {

    return Buffer.from(
        filePath
    ).toString(
        "base64url"
    );
}

function createBackup(content) {

    if (!currentFilePath)
        return;

    const backupDirectory = path.join(
        BACKUPS_PATH,
        getBackupKey(currentFilePath)
    );

    ensureDirectory(backupDirectory);

    const timestamp =
        new Date().toISOString().replace(/[:.]/g, "-");

    fs.writeFileSync(
        path.join(
            backupDirectory,
            `${timestamp}.txt`
        ),
        content
    );
}

function getFileName() {

    if (!currentFilePath)
        return "Untitled.txt";

    return path.basename(
        currentFilePath
    );
}

function sendFileNameToRenderer() {

    if (!mainWindow) return;

    mainWindow.webContents.send(
        "file-name-changed",
        getFileName()
    );
}

async function saveContent(content, forceSaveAs = false) {

    if (!currentFilePath || forceSaveAs) {

        const result =
            await dialog.showSaveDialog({
                defaultPath:
                    getFileName(),

                filters: [
                    {
                        name:
                            "Text Files",
                        extensions: [
                            "txt"
                        ]
                    }
                ]
            });

        if (result.canceled)
            return null;

        currentFilePath =
            result.filePath;
    }

    fs.writeFileSync(
        currentFilePath,
        content
    );

    createBackup(
        content
    );

    addRecentFile(
        currentFilePath
    );

    hasUnsavedChanges = false;

    sendFileNameToRenderer();

    return {
        fileName: getFileName(),
        filePath: currentFilePath
    };
}

async function confirmUnsavedChanges() {

    if (!hasUnsavedChanges)
        return true;

    const result =
        await dialog.showMessageBox(
            mainWindow,
            {
                type: "warning",
                buttons: [
                    "Save",
                    "Don't Save",
                    "Cancel"
                ],
                defaultId: 0,
                cancelId: 2,
                title: "Unsaved Changes",
                message: "You have unsaved changes.",
                detail: "Save your changes before continuing?"
            }
        );

    if (result.response === 2)
        return false;

    if (result.response === 1)
        return true;

    const content =
        await mainWindow.webContents.executeJavaScript(
            "window.writerApp.getContent()"
        );

    const saved =
        await saveContent(content);

    if (!saved)
        return false;

    mainWindow.webContents.send(
        "document-clean",
        saved.fileName
    );

    return true;
}

async function openTextFile(filePath) {

    const content =
        fs.readFileSync(
            filePath,
            "utf8"
        );

    currentFilePath =
        filePath;

    hasUnsavedChanges = false;

    addRecentFile(
        filePath
    );

    mainWindow.webContents.send(
        "open-file",
        content
    );

    sendFileNameToRenderer();

    return {
        success: true,
        content,
        fileName: getFileName(),
        filePath
    };
}

function createWindow() {

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile("index.html");

    mainWindow.on(
        "close",
        async event => {

            if (isClosingConfirmed)
                return;

            event.preventDefault();

            const canClose =
                await confirmUnsavedChanges();

            if (!canClose)
                return;

            isClosingConfirmed = true;
            mainWindow.close();
        }
    );

    const menuTemplate = [

        {
            label: "File",
            submenu: [

                {
                    label: "New",
                    accelerator: "Ctrl+N",
                    async click() {

                        const canContinue =
                            await confirmUnsavedChanges();

                        if (!canContinue)
                            return;

                        currentFilePath = null;
                        hasUnsavedChanges = false;

                        mainWindow.webContents.send(
                            "new-file"
                        );

                        sendFileNameToRenderer();
                    }
                },

                {
                    label: "Open",
                    accelerator: "Ctrl+O",

                    async click() {

                        const canContinue =
                            await confirmUnsavedChanges();

                        if (!canContinue)
                            return;

                        const result =
                            await dialog.showOpenDialog({
                                properties: [
                                    "openFile"
                                ],
                                filters: [
                                    {
                                        name: "Text Files",
                                        extensions: [
                                            "txt"
                                        ]
                                    }
                                ]
                            });

                        if (result.canceled)
                            return;

                        const filePath =
                            result.filePaths[0];

                        await openTextFile(
                            filePath
                        );
                    }
                },

                {
                    label: "Save",
                    accelerator: "Ctrl+S",

                    click() {

                        mainWindow.webContents.send(
                            "save-file"
                        );
                    }
                },

                {
                    label: "Save As",
                    accelerator:
                        "Ctrl+Shift+S",

                    click() {

                        mainWindow.webContents.send(
                            "save-as-file"
                        );
                    }
                },

                {
                    type: "separator"
                },

                {
                    label: "Find",
                    accelerator: "Ctrl+F",
                    click() {

                        mainWindow.webContents.send(
                            "show-find"
                        );
                    }
                },

                {
                    label: "Find & Replace",
                    accelerator: "Ctrl+H",
                    click() {

                        mainWindow.webContents.send(
                            "show-replace"
                        );
                    }
                },

                {
                    type: "separator"
                },

                {
                    label: "Recent Files",

                    click() {

                        mainWindow.webContents.send(
                            "show-recent-files"
                        );
                    }
                }

            ]
        },

        {
            label: "Edit",
            submenu: [
                {
                    label: "Bold",
                    accelerator: "Ctrl+B",
                    click() {

                        mainWindow.webContents.send(
                            "format-command",
                            "bold"
                        );
                    }
                },
                {
                    label: "Italic",
                    accelerator: "Ctrl+I",
                    click() {

                        mainWindow.webContents.send(
                            "format-command",
                            "italic"
                        );
                    }
                },
                {
                    label: "Underline",
                    accelerator: "Ctrl+U",
                    click() {

                        mainWindow.webContents.send(
                            "format-command",
                            "underline"
                        );
                    }
                }
            ]
        },

        {
            label: "Insert",
            submenu: [
                {
                    label: "Code Block",
                    click() {

                        mainWindow.webContents.send(
                            "insert-code-block"
                        );
                    }
                },
                {
                    label: "Formula",
                    click() {

                        mainWindow.webContents.send(
                            "insert-formula-block"
                        );
                    }
                },
                {
                    label: "Flashcard from Selection",
                    click() {

                        mainWindow.webContents.send(
                            "generate-flashcard"
                        );
                    }
                }
            ]
        },

        {
            label: "View",
            submenu: [
                {
                    label: "Dark Mode",
                    type: "checkbox",
                    accelerator: "Ctrl+D",
                    click(menuItem) {

                        mainWindow.webContents.send(
                            "toggle-dark-mode",
                            menuItem.checked
                        );
                    }
                },
                {
                    label: "Sepia Theme",
                    click() {

                        mainWindow.webContents.send(
                            "set-theme",
                            "sepia"
                        );
                    }
                },
                {
                    label: "Midnight Theme",
                    click() {

                        mainWindow.webContents.send(
                            "set-theme",
                            "midnight"
                        );
                    }
                },
                {
                    label: "Word Wrap",
                    type: "checkbox",
                    checked: true,
                    click(menuItem) {

                        mainWindow.webContents.send(
                            "toggle-word-wrap",
                            menuItem.checked
                        );
                    }
                },
                {
                    label: "Focus Mode",
                    accelerator: "F11",
                    click() {

                        mainWindow.webContents.send(
                            "toggle-focus-mode"
                        );
                    }
                },
                {
                    label: "Typewriter Mode",
                    accelerator: "Ctrl+Alt+T",
                    click() {

                        mainWindow.webContents.send(
                            "toggle-typewriter-mode"
                        );
                    }
                },
                {
                    label: "Paragraph Focus",
                    accelerator: "Ctrl+Alt+P",
                    click() {

                        mainWindow.webContents.send(
                            "toggle-paragraph-focus"
                        );
                    }
                },
                {
                    label: "Scratch Pad",
                    accelerator: "Ctrl+Alt+S",
                    click() {

                        mainWindow.webContents.send(
                            "toggle-scratch-pad"
                        );
                    }
                },
                {
                    label: "Flashcards",
                    accelerator: "Ctrl+Alt+F",
                    click() {

                        mainWindow.webContents.send(
                            "toggle-flashcards"
                        );
                    }
                },
                {
                    label: "Notes Outline",
                    accelerator: "Ctrl+Shift+O",
                    click() {

                        mainWindow.webContents.send(
                            "toggle-outline"
                        );
                    }
                },
                {
                    type: "separator"
                },
                {
                    role: "reload"
                }
            ]
        },

        {
            label: "Export",
            submenu: [
                {
                    label: "PDF",
                    click() {

                        mainWindow.webContents.send(
                            "export-pdf"
                        );
                    }
                },
                {
                    label: "Markdown",
                    click() {

                        mainWindow.webContents.send(
                            "export-markdown"
                        );
                    }
                },
                {
                    label: "HTML",
                    click() {

                        mainWindow.webContents.send(
                            "export-html"
                        );
                    }
                }
            ]
        },

        {
            label: "History",
            submenu: [
                {
                    label: "Version History",
                    click() {

                        mainWindow.webContents.send(
                            "show-version-history"
                        );
                    }
                }
            ]
        },

        {
            label: "Help",
            submenu: [
                {
                    label: "About",

                    click() {

                        dialog.showMessageBox(
                            mainWindow,
                            {
                                title: "About",
                                message:
                                    "Simple Word Processor"
                            }
                        );
                    }
                }
            ]
        }

    ];

    Menu.setApplicationMenu(
        Menu.buildFromTemplate(
            menuTemplate
        )
    );

    sendFileNameToRenderer();
}

ipcMain.handle(
    "save-document",
    async (event, content) => {

        return saveContent(content);
    }
);

ipcMain.handle(
    "save-document-as",
    async (event, content) => {

        return saveContent(content, true);
    }
);

ipcMain.handle(
    "auto-save-document",
    async (event, content) => {

        if (!currentFilePath)
            return null;

        return saveContent(content);
    }
);

ipcMain.handle(
    "export-document",
    async (event, exportType, payload) => {

        const extensions = {
            pdf: "pdf",
            markdown: "md",
            html: "html"
        };

        const result =
            await dialog.showSaveDialog({
                defaultPath:
                    getFileName().replace(/\.[^.]+$/, "") +
                    "." +
                    extensions[exportType],

                filters: [
                    {
                        name:
                            exportType.toUpperCase(),
                        extensions: [
                            extensions[exportType]
                        ]
                    }
                ]
            });

        if (result.canceled)
            return false;

        if (exportType === "pdf") {

            const printWindow =
                new BrowserWindow({
                    show: false
                });

            await printWindow.loadURL(
                "data:text/html;charset=utf-8," +
                encodeURIComponent(payload.html)
            );

            const pdfData =
                await printWindow.webContents.printToPDF({
                    printBackground: true
                });

            fs.writeFileSync(
                result.filePath,
                pdfData
            );

            printWindow.close();

            return true;
        }

        fs.writeFileSync(
            result.filePath,
            payload.content
        );

        return true;
    }
);

ipcMain.handle(
    "get-version-history",
    () => {

        if (!currentFilePath)
            return [];

        const backupDirectory = path.join(
            BACKUPS_PATH,
            getBackupKey(currentFilePath)
        );

        if (!fs.existsSync(backupDirectory))
            return [];

        return fs.readdirSync(backupDirectory)
            .filter(file => file.endsWith(".txt"))
            .sort()
            .reverse()
            .slice(0, 20)
            .map(file => {
                const filePath =
                    path.join(
                        backupDirectory,
                        file
                    );

                return {
                    id: file,
                    label: fs.statSync(filePath).mtime.toLocaleString(),
                    filePath
                };
            });
    }
);

ipcMain.handle(
    "restore-version",
    (event, filePath) => {

        return fs.readFileSync(
            filePath,
            "utf8"
        );
    }
);

ipcMain.handle(
    "get-recent-files",
    () => {

        return loadRecentFiles();
    }
);

ipcMain.handle(
    "get-current-file-name",
    () => {

        return getFileName();
    }
);

ipcMain.handle(
    "open-recent-file",
    async (event, filePath) => {

        try {

            const canContinue =
                await confirmUnsavedChanges();

            if (!canContinue)
                return {
                    success: false,
                    canceled: true
                };

            return openTextFile(
                filePath
            );

        } catch (error) {

            removeRecentFile(
                filePath
            );

            return {
                success: false,
                error: error.message
            };
        }
    }
);

ipcMain.on(
    "document-modified",
    () => {

        hasUnsavedChanges = true;
    }
);

ipcMain.on(
    "document-saved",
    () => {

        hasUnsavedChanges = false;
    }
);

app.whenReady().then(
    createWindow
);
