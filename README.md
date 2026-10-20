# CodeAtlas

CodeAtlas turns a public GitHub repository or local project into an evidence-aware workspace for understanding architecture, execution paths, requirements, and interview topics.

## Current capabilities

- Public GitHub repository analysis through the web UI.
- Safe static analysis: source code is never executed.
- File filtering for dependencies, build outputs, generated files, and secret-like paths.
- Shared project model with technologies, evidence, flow steps, system-design nodes, and interview seeds.
- Artifact-scoped chat with source references and out-of-scope handling.
- Locally persisted workspace restoration after a page refresh.
- Gemini-backed structured PRD generation with evidence IDs, section editing, regeneration, version history, and local persistence.
- Genuine PDF, DOCX, and PPTX exports.
- Local CLI analysis for repositories that should not be pushed to GitHub.

## Run the web app

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, enter a public GitHub URL, and choose **Analyze repository**.

To enable the PRD workspace, copy `.env.example` to `.env.local` and set a server-only Gemini key:

```bash
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL=gemini-2.0-flash
```

The key is used only by `app/api/prd/generate/route.ts`; it is never sent to the browser. Without it, repository analysis and the non-AI artifacts continue to work, while PRD generation shows a configuration error.

Production checks:

```bash
npm run typecheck
npm test
npm run build
npm start
```

Development output is stored in `.next-dev`, while production builds use `.next`. This keeps a running `npm run dev` server from being corrupted when a production build is run in another terminal.

## Local CLI

The CLI analyzes the current directory by default and does not execute project code.

```bash
npm run cli -- --help
npm run cli -- --output ./codeatlas-docs
npm run cli -- prd --output ./codeatlas-docs --format all
npm run cli -- flow --output ./codeatlas-docs --format pdf
npm run cli -- system --output ./codeatlas-docs --format docx
npm run cli -- questions --output ./codeatlas-docs --format pptx
```

To analyze a public GitHub repository through the CLI:

```bash
npm run cli -- --repo https://github.com/owner/repository prd --output ./codeatlas-docs
```

The default no-command flow writes `prd.json` and `prd.md`. Artifact commands write the requested document formats.

## Privacy and safety

- GitHub analysis currently supports public repositories without a token.
- Local analysis stays on the machine until a user explicitly sends selected content elsewhere.
- `.env`, private-key, credential-like, dependency, build, and generated paths are excluded by default.
- The analyzer treats repository files as untrusted data and does not follow instructions found in source files.
- Analysis is bounded by file, content, evidence, and graph limits. Partial results include warnings.
- Export payloads are sanitized and bounded; raw source trees are not included in exports.

## Architecture

```text
GitHub REST API / local filesystem
              ↓
     bounded static analysis
              ↓
       shared ProjectModel
       ↙        ↓        ↘
    PRD     flow/system    questions
              ↓
          export engine
```

The web routes are `app/api/analyze/route.ts`, `app/api/prd/generate/route.ts`, and `app/api/export/route.ts`. Shared analysis code lives in `lib/analysis`, structured PRD generation lives in `lib/prd`, and document generation lives in `lib/exports`.

## Known limitations

- GitHub ingestion is public-repository-only and unauthenticated.
- Gemini PRD generation requires `GEMINI_API_KEY`; generated documents are stored in browser local storage in this MVP rather than a server database.
- Relationships inferred from paths and roles are explicitly marked and are not runtime call graphs.
- Local analysis currently provides a lighter path-and-language model than GitHub analysis.
- Diagram exports include a structured summary rather than a rendered interactive canvas.
- The npm package/command name has not been published; use the repository CLI script until packaging is finalized.
