# 🎯 Commit Bingo

See the tropes and patterns hiding in your commit history. **Commit Bingo** scans your GitHub repository commit logs, classifies developer tropes (such as `WIP`, `quick-fix`, `typo-fix`, `dependency-bump`, `remove-dead-code`, `add-null-check`), and builds an interactive bingo card mapping them to your real commit activity. It also includes an AI-powered code reviewer that generates a roast and calculates your dev "Chaos Rating."

Live website: [bingo.espiobest.me](https://bingo.espiobest.me)

---

## ✨ Features

- **GitHub OAuth Login**: Securely connect your GitHub account to analyze public and private repositories.
- **Interactive Bingo Board**: A $5 \times 5$ grid where each square represents a common developer trope. Matched squares glow and show the count of matching commits.
- **Evidence Explorer**: Click on any matched tile to expand it and see details, including file changes and the specific commits that matched the trope.
- **AI Dev Roast & Archetype**: A custom AI reviewer analyzes your commit messages to label your developer archetype and roast your habits.
- **Time Window Filters**: Quickly focus your analysis on a specific window (Past Week, Past Month, Past 90 Days, or custom dates).
- **iOS-style Share Toast**: Click "Share card" to capture a high-quality PNG of your bingo board to the clipboard, complete with an iOS-style corner preview thumbnail and success bubble.

---

## 🛠️ Tech Stack

- **Frontend**: [React 19](https://react.dev/) + [Vite](https://vite.dev/) + Vanilla CSS (modern dark-theme layout with micro-animations).
- **Backend API**: [Hono](https://hono.dev/) framework running on [Cloudflare Workers](https://developers.cloudflare.com/workers/).
- **AI Processing**: 
  - **Trope Classification**: Cloudflare Workers AI (`@cf/meta/llama-3-8b-instruct`) for rapid text analysis.
  - **Roast Generation**: Gemini API for developer archetype and roast generation.
- **Hosting**: Cloudflare Workers Static Assets for rapid global delivery.

---

## 💻 Local Development

### 1. Configuration & Secrets
Create a `.dev.vars` file in the root of the `commit-bingo` directory:
```env
# GitHub OAuth credentials (register an OAuth app in GitHub Settings -> Developer Settings)
# Authorization callback URL should be: http://localhost:5173/api/auth/callback (for local dev)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Gemini API Key for roasts
GEMINI_API_KEY=your_gemini_api_key
```

### 2. Run Locally
Install dependencies and start the development server:
```bash
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🚀 Production Configuration & Deployment

### Environment Configuration Switching
The `vite.config.ts` dynamically loads config files depending on the Vite mode:
- **Development**: Uses `wrangler.dev.json` (deploys to the `commit-bingo-dev` worker).
- **Production**: Uses `wrangler.json` (deploys to the `commit-bingo` worker).

### Routing & Static Assets
The project uses the Cloudflare Workers Static Assets framework. To ensure browser page navigation requests on `/api/*` reach the backend Hono router rather than being intercepted by the SPA fallback, the `assets` block in `wrangler.json` utilizes the `run_worker_first` setting:

```json
"assets": {
	"directory": "./dist/client",
	"not_found_handling": "single-page-application",
	"run_worker_first": ["/api/*"]
}
```

### Deploy to Cloudflare Workers

Build the production assets and deploy the worker:
```bash
npm run build && npm run deploy
```

Monitor your live logs:
```bash
npx wrangler tail
```
