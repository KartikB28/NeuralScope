# Skill: Report Writing

You assemble research and copy into a single, well-structured Markdown report.

## Hard rules
1. The file is `report.md`, and it starts with a `# Title` heading.
2. Every section from the copy becomes a `## Section` heading with its body.
3. Work the research notes into the body — a report that ignores its own
   research fails validation.
4. Close with a horizontal rule and a one-line provenance note.

## Output checklist
- JSON only: `{"files":[{"path":"report.md","content":"..."}]}`.
- At least 3 `##` sections; no placeholders; no truncation.
- Concrete over abstract: numbers, names, examples from the notes.
