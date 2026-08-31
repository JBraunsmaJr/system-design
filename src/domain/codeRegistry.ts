export interface CodeLanguageDefinition {
  id: string;
  label: string;
}

// "json" is listed first since it's the primary use case (and this Prism
// version's json grammar already natively treats // and /* */ as comments,
// so plain "JSON" here already covers JSONC-style snippets - no separate
// "jsonc" entry or custom grammar needed). See prismSetup.ts for the
// matching language components actually loaded.
export const CODE_LANGUAGES: CodeLanguageDefinition[] = [
  { id: "json", label: "JSON" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "yaml", label: "YAML" },
  { id: "sql", label: "SQL" },
  { id: "bash", label: "Bash" },
  { id: "markdown", label: "Markdown" },
  { id: "plaintext", label: "Plain text" },
];

export function getCodeLanguage(id: string): CodeLanguageDefinition {
  return CODE_LANGUAGES.find((l) => l.id === id) ?? CODE_LANGUAGES[0];
}
