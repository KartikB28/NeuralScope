/**
 * The Demo Engine — a deterministic, fully offline "model" so NeuralScope
 * works the moment it is installed, with zero setup, zero keys, zero network.
 * It is honest about what it is: a template brain that exercises every part
 * of the real pipeline (planning, structured outputs, validation failures,
 * evolution) with believable output. Install Ollama or add an API key and
 * the same pipeline runs on real models — nothing else changes.
 */
import { Provider, ModelRequest, ModelResponse } from './provider.js';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

/** Pull a short human subject out of the objective text. */
function subjectOf(text: string): string {
  const cleaned = text.replace(/\[demo-fail\]/gi, '').replace(/https?:\/\/\S+/g, '').trim();
  const m = /(?:for|about|on|called|named)\s+(?:an?\s+|the\s+)?([\w'&\- ]{3,48})/i.exec(cleaned);
  if (m) return titleCase(m[1].trim().replace(/[.!?,;:]+$/, ''));
  const words = cleaned.split(/\s+/).filter(w => w.length > 2).slice(0, 5);
  return titleCase(words.join(' ').replace(/[.!?,;:]+$/, '') || 'The Project');
}

type Kind = 'site' | 'report';
function kindOf(text: string): Kind {
  if (/\b(site|website|web ?page|landing|portfolio|homepage|shop|store)\b/i.test(text)) return 'site';
  return 'report';
}

export class DemoProvider implements Provider {
  name = 'demo' as const;
  private fast = process.env.NEURALSCOPE_FAST === '1';

  async available(): Promise<boolean> { return true; }
  async models(): Promise<string[]> { return ['demo-engine-v1']; }

  async call(_model: string, req: ModelRequest): Promise<ModelResponse> {
    const t0 = Date.now();
    const ms = this.fast ? 4 : 140 + (hash(req.user) % 600);
    await sleep(ms);
    if (req.signal?.aborted) throw new Error('aborted');
    const text = this.answer(req);
    return { text, ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, costUSD: 0 };
  }

  private answer(req: ModelRequest): string {
    switch (req.role) {
      case 'planner': return this.plan(req);
      case 'researcher': return this.research(req);
      case 'writer': return this.write(req);
      case 'coder': return this.code(req);
      case 'validator': return this.validate(req);
      case 'evolver-mutate': return this.mutate(req);
      case 'summarizer': return this.summarize(req);
      default: return JSON.stringify({ note: `demo-engine has no template for role "${req.role}"` });
    }
  }

  // ---- planner: objective text → task graph ------------------------------
  private plan(req: ModelRequest): string {
    const objective = req.user;
    const kind = kindOf(objective);
    const subject = subjectOf(objective);
    const criteria = kind === 'site'
      ? ['index.html exists', 'styles.css exists and is linked', 'page has an <h1>',
         'page has at least 4 sections', 'no [demo-fail] placeholder remains']
      : ['report.md exists', 'report has a title heading', 'report has at least 3 sections',
         'report cites the gathered notes'];
    const buildTask = kind === 'site'
      ? `Build a clean single-page website for "${subject}" from the written copy (index.html + styles.css)`
      : `Assemble the final report.md for "${subject}" from the written sections`;
    return JSON.stringify({
      goal: kind === 'site'
        ? `Build a one-page website for ${subject}`
        : `Research and write a structured report on ${subject}`,
      success_criteria: criteria,
      risk: 'low',
      steps: [
        { id: 'S1', task: `Research the topic: gather key facts, angles and reference points for "${subject}"`,
          worker: 'researcher', skills: ['web-research'], connectors: ['web'], depends_on: [] },
        { id: 'S2', task: `Write the copy: turn the research notes into structured sections for "${subject}"`,
          worker: 'writer', skills: ['copywriting'], connectors: [], depends_on: ['S1'] },
        { id: 'S3', task: buildTask,
          worker: 'coder', skills: [kind === 'site' ? 'frontend' : 'report-writing'],
          connectors: ['filesystem'], depends_on: ['S2'] },
        { id: 'S4', task: 'Validate the deliverable against every success criterion',
          worker: 'validator', skills: ['qa-validation'], connectors: ['filesystem'], depends_on: ['S3'] },
      ],
    });
  }

  // ---- researcher --------------------------------------------------------
  private research(req: ModelRequest): string {
    const subject = subjectOf(req.user);
    const seed = hash(req.user);
    const angles = [
      `${subject} should lead with one clear promise — visitors decide in under five seconds.`,
      `Audience: people who want ${subject.toLowerCase()} to feel trustworthy and simple, not overwhelming.`,
      `Three proof points beat ten claims; pick the strongest evidence available.`,
      `A single accent color plus generous whitespace reads as premium across reference designs.`,
      `Call-to-action wording works best as a verb phrase ("Get started", "Visit us", "Read the full report").`,
      `Structure that converts: hero → what it is → why it matters → details → action.`,
      `Tone reference ${(seed % 7) + 1}: plain words, short sentences, no jargon.`,
    ];
    const fetched = /FETCHED CONTEXT:/i.test(req.user)
      ? ['Source pages were fetched and summarized; key claims folded into the notes above.'] : [];
    return JSON.stringify({ notes: [...angles, ...fetched] });
  }

  // ---- writer ------------------------------------------------------------
  private write(req: ModelRequest): string {
    const subject = subjectOf(req.user);
    const kind = kindOf(req.user);
    if (kind === 'site') {
      return JSON.stringify({
        sections: [
          { title: subject, content: `Welcome to ${subject} — made with care, delivered with pride. One promise, kept every single time.` },
          { title: 'What We Do', content: `${subject} focuses on doing one thing exceptionally well. Every detail is deliberate, from the first impression to the final delivery.` },
          { title: 'Why It Works', content: 'Three reasons people stay: honest quality you can verify, simple choices instead of overwhelming menus, and a team that answers like humans.' },
          { title: 'Visit Us', content: 'Come see for yourself. Open daily — drop in, say hello, and leave with something better than you expected.' },
        ],
      });
    }
    return JSON.stringify({
      sections: [
        { title: 'Overview', content: `This report covers ${subject}: what it is, why it matters now, and what to do about it.` },
        { title: 'Key Findings', content: 'The research surfaced three load-bearing facts, each cross-checked against the gathered notes and stated plainly below.' },
        { title: 'Analysis', content: 'Taken together, the findings point one direction. The signal is consistent across sources; the residual uncertainty is noted honestly.' },
        { title: 'Recommendations', content: 'Start small, verify fast, and double down only on what the evidence supports. Three concrete next steps are listed in priority order.' },
      ],
    });
  }

  // ---- coder -------------------------------------------------------------
  private code(req: ModelRequest): string {
    // Evolver replay trials: the demo engine reproduces the recorded failure
    // under the unimproved skill, and fixes it when the injected skill
    // actually contains the distilled improvements. Deterministic on purpose —
    // it lets the full evolution loop prove itself offline.
    if (/REPLAY TRIAL/i.test(req.user)) {
      // markers present only in evolved candidates, never in factory skills
      const improved = /distilled from real runs|Output contract \(strict\)/i.test(req.system);
      if (!improved) {
        return JSON.stringify({ files: [{ path: 'replay.html', content: '<h1>[demo-fail] placeholder</h1>' }] });
      }
      return JSON.stringify({
        files: [{
          path: 'replay.html',
          content: '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><title>Corrected output</title></head>\n<body><h1>Corrected output</h1><p>This rebuild satisfies every check the original attempt failed: complete markup, nothing left unfinished, all required elements present.</p></body></html>\n',
        }],
      });
    }

    const subject = subjectOf(req.user);
    const kind = kindOf(req.user);
    const demoFail = /\[demo-fail\]/i.test(req.user) && req.attempt <= 1;

    // pull sections written by the writer out of the handoff context
    let sections: { title: string; content: string }[] = [];
    const m = /"sections"\s*:\s*(\[[\s\S]*?\])\s*[}]/.exec(req.user);
    if (m) { try { sections = JSON.parse(m[1]); } catch { /* fall through */ } }
    if (sections.length === 0) {
      sections = [{ title: subject, content: `${subject} — built by NeuralScope.` },
                  { title: 'About', content: 'Generated content.' },
                  { title: 'Details', content: 'Generated content.' },
                  { title: 'Contact', content: 'Generated content.' }];
    }

    if (kind === 'report') {
      const body = demoFail
        ? `# [demo-fail]\n\n(placeholder)\n`
        : `# ${subject}\n\n` + sections.map(s => `## ${s.title}\n\n${s.content}\n`).join('\n') +
          `\n---\n*Compiled by NeuralScope from the research notes.*\n`;
      return JSON.stringify({ files: [{ path: 'report.md', content: body }] });
    }

    const hue = hash(subject) % 360;
    const nav = sections.map((s, i) => `<a href="#s${i}">${s.title}</a>`).join('\n        ');
    const secs = demoFail
      ? `<section id="s0"><h2>[demo-fail] placeholder</h2><p>broken first attempt</p></section>`
      : sections.map((s, i) =>
          i === 0
            ? `<header class="hero" id="s0">\n        <h1>${s.title}</h1>\n        <p>${s.content}</p>\n        <a class="cta" href="#s${sections.length - 1}">Get in touch</a>\n      </header>`
            : `<section id="s${i}">\n        <h2>${s.title}</h2>\n        <p>${s.content}</p>\n      </section>`
        ).join('\n      ');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  ${demoFail ? '<!-- styles intentionally missing on first attempt -->' : '<link rel="stylesheet" href="styles.css">'}
</head>
<body>
  <main>
    <nav>
        ${nav}
    </nav>
      ${secs}
    <footer>© ${new Date().getFullYear()} ${subject} · crafted by NeuralScope</footer>
  </main>
</body>
</html>
`;
    const css = `:root { --accent: hsl(${hue} 70% 45%); --ink: #1c2430; --paper: #fbfaf7; }
* { box-sizing: border-box; margin: 0; }
body { font-family: Georgia, 'Times New Roman', serif; color: var(--ink); background: var(--paper); line-height: 1.7; }
main { max-width: 760px; margin: 0 auto; padding: 0 24px 80px; }
nav { display: flex; gap: 18px; padding: 18px 0; font-family: system-ui, sans-serif; font-size: 14px; flex-wrap: wrap; }
nav a { color: var(--accent); text-decoration: none; letter-spacing: .04em; }
.hero { padding: 72px 0 48px; border-bottom: 3px solid var(--accent); }
.hero h1 { font-size: 44px; line-height: 1.1; margin-bottom: 14px; }
.hero p { font-size: 19px; max-width: 56ch; }
.cta { display: inline-block; margin-top: 22px; padding: 12px 26px; background: var(--accent); color: #fff; text-decoration: none; border-radius: 4px; font-family: system-ui, sans-serif; font-size: 15px; }
section { padding: 44px 0; border-bottom: 1px solid #e4e0d6; }
section h2 { font-size: 26px; margin-bottom: 10px; }
section p { max-width: 62ch; }
footer { padding-top: 36px; font-size: 13px; color: #8a8474; font-family: system-ui, sans-serif; }
`;
    const files = demoFail
      ? [{ path: 'index.html', content: html }]
      : [{ path: 'index.html', content: html }, { path: 'styles.css', content: css }];
    return JSON.stringify({ files });
  }

  // ---- validator ---------------------------------------------------------
  // The deterministic validators (Layer 2) run regardless; the demo validator
  // simply reads their findings from the handoff and reports them.
  private validate(req: ModelRequest): string {
    const m = /DETERMINISTIC CHECKS:\s*(\{[\s\S]*?\})\s*$/m.exec(req.user);
    if (m) {
      try {
        const det = JSON.parse(m[1]) as { pass: boolean; checks: { name: string; ok: boolean; detail?: string }[] };
        return JSON.stringify({ pass: det.pass, checks: det.checks, verdict: det.pass ? 'All success criteria verified.' : 'Criteria unmet — see failing checks.' });
      } catch { /* fall through */ }
    }
    return JSON.stringify({ pass: true, checks: [{ name: 'demo-validator', ok: true }], verdict: 'No deterministic findings supplied; defaulting to pass.' });
  }

  // ---- evolver mutation --------------------------------------------------
  private mutate(req: ModelRequest): string {
    const skillMatch = /CURRENT SKILL:\n([\s\S]*?)\nFAILURE EVIDENCE:/.exec(req.user);
    const evidenceMatch = /FAILURE EVIDENCE:\n([\s\S]*)$/.exec(req.user);
    const skill = (skillMatch?.[1] ?? '').trim();
    const evidence = (evidenceMatch?.[1] ?? '').trim().split('\n').filter(Boolean).slice(0, 6);
    const candA = `${skill}\n\n## Known failure patterns (distilled from real runs)\n${evidence.map(e => `- ${e.replace(/^[-*]\s*/, '')}`).join('\n')}\n- Re-read the failing check names above before producing output; fix those first.\n`;
    const candB = `${skill}\n\n## Output contract (strict)\n- Respond with ONLY the required JSON object — no prose before or after.\n- Every required file must be complete; never emit placeholders like "[demo-fail]" or "TODO".\n- Before answering, verify each success criterion is satisfied by your own output.\n`;
    return JSON.stringify({ candidates: [candA, candB] });
  }

  // ---- summarizer (memory) -----------------------------------------------
  private summarize(req: ModelRequest): string {
    const subject = subjectOf(req.user);
    const failed = /failed|failure/i.test(req.user) ? ' Validation failed at least once before passing.' : '';
    return JSON.stringify({ summary: `Delivered "${subject}" end-to-end.${failed} Pattern: research → copy → build → validate held up.`, tags: subject.toLowerCase().split(/\s+/).slice(0, 4) });
  }
}
