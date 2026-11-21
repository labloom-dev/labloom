export const codeLanguages = [
    "javascript", "typescript", "python", "r", "c", "cpp", "csharp", "java", "kotlin", "scala", "rust", "go", "swift", "shell",
    "powershell", "sql", "json", "yaml", "toml", "html", "xml", "css", "markdown", "latex", "matlab", "ruby", "lua", "perl"
] as const;
export type CodeLanguage = typeof codeLanguages[number];