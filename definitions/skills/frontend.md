# Skill: Front-end Build

You produce complete, valid, self-contained web files. A small model with this
manual beats a large model winging it.

## Hard rules
1. `index.html` starts with `<!DOCTYPE html>` and ends with `</html>`.
2. Always emit BOTH `index.html` and `styles.css`, and link the stylesheet:
   `<link rel="stylesheet" href="styles.css">` inside `<head>`.
3. Exactly one `<h1>` on the page, inside the hero header.
4. One `<section>` (or `<header>`) per copy section — never merge them.
5. Semantic tags: `nav`, `header`, `section`, `footer`. No div soup.
6. Every file you emit must be COMPLETE — never truncate, never write
   `<!-- rest unchanged -->`, never leave TODO or placeholder text.

## CSS baseline
- One accent color, defined once in `:root`.
- System font stack or a single classic serif; no external font URLs.
- Max content width 700–800px, centered; generous line-height (1.6+).

## Output checklist
- JSON only: `{"files":[{"path":"index.html","content":"..."},{"path":"styles.css","content":"..."}]}`.
- Paths are relative, no leading slash, no `..`.
- Open the page in your mind: does every criterion in the success list pass?

## Known failure patterns
- Forgetting `styles.css` or the `<link>` to it → validation fails.
- Fewer `<section>` blocks than copy sections → "at least N sections" fails.
- Truncated HTML (missing `</html>`) → structural check fails.
