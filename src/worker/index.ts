import { Hono } from "hono";
import { setCookie, getCookie } from "hono/cookie";
import { cors } from "hono/cors";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

interface CommitFileSummary {
	filename: string;
	status: string;
	additions?: number;
	deletions?: number;
	changes?: number;
}

interface CommitDigest {
	language: string;
	changedFiles: string[];
	topFiles: string[];
	insight: string;
	confidence: "low" | "medium" | "high";
}

const GITHUB_API_HEADERS = {
	Accept: "application/vnd.github+json",
	"User-Agent": "Commit-Bingo-App",
};

function normalizeFileType(filename: string) {
	const lower = filename.toLowerCase();

	if (lower.endsWith(".tsx") || lower.endsWith(".ts") || lower.endsWith(".jsx") || lower.endsWith(".js")) {
		return "frontend";
	}

	if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".html")) {
		return "ui";
	}

	if (lower.endsWith(".md") || lower.includes("readme") || lower.includes("docs")) {
		return "docs";
	}

	if (lower.includes("package-lock") || lower.includes("pnpm-lock") || lower.includes("yarn.lock") || lower.endsWith("package.json")) {
		return "dependencies";
	}

	if (lower.includes("test") || lower.includes("spec")) {
		return "tests";
	}

	if (lower.endsWith(".json") || lower.endsWith(".toml") || lower.endsWith(".yml") || lower.endsWith(".yaml")) {
		return "config";
	}

	return "code";
}

function buildDigest(files: CommitFileSummary[]): CommitDigest {
	const counts = new Map<string, number>();
	const topFiles = files
		.slice()
		.sort((left, right) => (right.changes ?? 0) - (left.changes ?? 0))
		.slice(0, 3)
		.map((file) => file.filename);

	for (const file of files) {
		const bucket = normalizeFileType(file.filename);
		counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
	}

	const dominant = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "code";
	const changedFiles = files.map((file) => file.filename);

	let insight = "Mostly code changes.";
	if (dominant === "docs") insight = "Docs-heavy change.";
	if (dominant === "ui") insight = "UI-focused change.";
	if (dominant === "dependencies") insight = "Dependency or lockfile update.";
	if (dominant === "tests") insight = "Test coverage or test behavior changed.";
	if (dominant === "config") insight = "Configuration or build settings changed.";

	const confidence = files.length >= 5 ? "high" : files.length >= 2 ? "medium" : "low";

	return {
		language: dominant,
		changedFiles,
		topFiles,
		insight,
		confidence,
	};
}

async function getCommitFiles(accessToken: string, repoFullName: string, sha: string) {
	const response = await fetch(`https://api.github.com/repos/${repoFullName}/commits/${sha}`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			...GITHUB_API_HEADERS,
		},
	});

	if (!response.ok) {
		return [] as CommitFileSummary[];
	}

	const data = await response.json() as { files?: CommitFileSummary[] };
	return data.files ?? [];
}

// Cloudflare Workers AI models. Running on the same edge as the Worker means
// there's no external provider to be rate-limited by (the source of the old
// Gemini 503s). Both genuinely support native JSON-schema output at runtime.
//
// FAST handles the high-volume/batch work. It's a 17B mixture-of-experts model:
// fast enough to avoid the gateway (504) timeouts the dense 70B hit on batches,
// and unlike the 8B models it actually supports JSON Schema mode (they return
// error 5025). SMART is the larger model, reserved for the one-shot roast where
// wit matters most.
const FAST_AI_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const SMART_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

type AiModel = typeof FAST_AI_MODEL | typeof SMART_AI_MODEL;

/**
 * Run a Workers AI text model in JSON mode and return the parsed object.
 * The `json_schema` constrains the model to emit exactly the shape we ask for,
 * which removes the whole class of "clean up the model's markdown/prose" hacks.
 */
async function runAiJson<T>(
	env: Env,
	model: AiModel,
	messages: Array<{ role: "system" | "user"; content: string }>,
	jsonSchema: Record<string, unknown>,
	options: { temperature?: number; maxTokens?: number } = {}
): Promise<T> {
	// Both models accept this same input shape, but a union model type makes the
	// per-model .run() overloads ambiguous; narrow it for type resolution only.
	const result = (await env.AI.run(model as typeof SMART_AI_MODEL, {
		messages,
		response_format: { type: "json_schema", json_schema: jsonSchema },
		temperature: options.temperature ?? 0.2,
		max_tokens: options.maxTokens ?? 512,
	})) as { response?: unknown };

	const payload = result.response;
	if (payload == null) {
		throw new Error("Empty AI response");
	}

	// In json_schema mode the runtime usually returns an already-parsed object,
	// but stay defensive in case a model hands back a JSON string.
	return (typeof payload === "string" ? JSON.parse(payload) : payload) as T;
}

async function getAiDigest(c: { env: Env }, commit: { message: string; repo: string; files: CommitFileSummary[] }, fallback: CommitDigest) {
	try {
		const parsed = await runAiJson<Partial<CommitDigest>>(
			c.env,
			FAST_AI_MODEL,
			[
				{
					role: "system",
					content: "You classify a single Git commit. Respond with the requested JSON only.",
				},
				{
					role: "user",
					content: [
						"Classify this commit change in one short sentence.",
						`Commit message: ${commit.message}`,
						`Repository: ${commit.repo}`,
						`Changed files: ${commit.files.map((file) => file.filename).join(", ") || "none"}`,
					].join("\n"),
				},
			],
			{
				type: "object",
				properties: {
					language: { type: "string" },
					insight: { type: "string" },
					confidence: { type: "string", enum: ["low", "medium", "high"] },
				},
				required: ["language", "insight", "confidence"],
			},
			{ temperature: 0.2, maxTokens: 200 }
		);

		return {
			...fallback,
			language: parsed.language || fallback.language,
			insight: parsed.insight || fallback.insight,
			confidence:
				parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
					? parsed.confidence
					: fallback.confidence,
		};
	} catch (error) {
		console.error("AI digest failed:", error);
		return fallback;
	}
}

const TROPE_CATEGORIES = [
	{ id: "wip", label: "WIP", hint: "Half-finished commits that still got pushed." },
	{ id: "quick-fix", label: "Quick fix", hint: "A change made to stop the bleeding." },
	{ id: "typo-fix", label: "Typo fix", hint: "A commit that only corrected text." },
	{ id: "docs-cleanup", label: "Docs cleanup", hint: "The docs got some attention." },
	{ id: "dependency-bump", label: "Dependency bump", hint: "A package version moved." },
	{ id: "merge-branch", label: "Merge branch", hint: "A branch got folded in." },
	{ id: "refactor", label: "Refactor", hint: "Code changed without changing behavior." },
	{ id: "remove-dead-code", label: "Remove dead code", hint: "Something got deleted for good reason." },
	{ id: "add-null-check", label: "Add null check", hint: "The classic guardrail commit." },
	{ id: "tests", label: "Tests", hint: "The safety net got updated." },
	{ id: "ci-green", label: "CI green", hint: "The build or pipeline was involved." },
	{ id: "rollback", label: "Rollback", hint: "The previous change was undone." },
	{ id: "rename-things", label: "Rename things", hint: "Symbols got a new name." },
	{ id: "edge-case", label: "Edge case", hint: "A weird branch of logic was handled." },
	{ id: "console-log", label: "Console log", hint: "Temporary debugging leftovers may lurk here." },
	{ id: "formatting-only", label: "Formatting only", hint: "No behavior changed, just the shape of the code." },
	{ id: "better-naming", label: "Better naming", hint: "The code reads a little better now." },
	{ id: "api-change", label: "API change", hint: "A contract probably shifted." },
	{ id: "build-fix", label: "Build fix", hint: "The app needed to compile again." },
	{ id: "todo-cleanup", label: "TODO cleanup", hint: "A note to future self got addressed." },
	{ id: "legacy-cleanup", label: "Legacy cleanup", hint: "Old code or patterns got removed." },
	{ id: "lockfile-update", label: "Lockfile update", hint: "Dependency metadata changed." },
	{ id: "permission-fix", label: "Permission fix", hint: "Access or auth handling changed." },
	{ id: "edge-deploy", label: "Edge deploy", hint: "Deployment or hosting changed." },
	{ id: "clean-up", label: "Cleanup", hint: "The codebase got a bit lighter." },
];

const TROPE_BATCH_SIZE = 15;

async function classifyTropeBatch(
	env: Env,
	commits: Array<{ sha: string; message: string }>
): Promise<Record<string, string | null>> {
	const tropeList = TROPE_CATEGORIES.map((t) => `${t.id}: ${t.label} (${t.hint})`).join("\n");
	const commitList = commits.map((c) => `[${c.sha}] ${c.message}`).join("\n");

	const parsed = await runAiJson<{ classifications?: Array<{ sha?: string; tropeId?: string | null }> }>(
		env,
		FAST_AI_MODEL,
		[
			{
				role: "system",
				content: "You are an expert developer tool that classifies Git commit messages into tropes.",
			},
			{
				role: "user",
				content: [
					"Classify each commit into exactly one of these trope IDs, or null if none fit:",
					tropeList,
					"",
					"Return one entry per commit, preserving the exact SHA you were given.",
					"",
					"Commits to classify:",
					commitList,
				].join("\n"),
			},
		],
		{
			type: "object",
			properties: {
				classifications: {
					type: "array",
					items: {
						type: "object",
						properties: {
							sha: { type: "string" },
							tropeId: {
								type: ["string", "null"],
								enum: [...TROPE_CATEGORIES.map((t) => t.id), null],
							},
						},
						required: ["sha", "tropeId"],
					},
				},
			},
			required: ["classifications"],
		},
		{ temperature: 0.1, maxTokens: 1024 }
	);

	// Only trust SHAs the model was actually given, so it can't hallucinate keys.
	const validShas = new Set(commits.map((c) => c.sha));
	const validTropes = new Set(TROPE_CATEGORIES.map((t) => t.id));
	const matches: Record<string, string | null> = {};

	for (const entry of parsed.classifications ?? []) {
		if (entry?.sha && validShas.has(entry.sha)) {
			matches[entry.sha] = entry.tropeId && validTropes.has(entry.tropeId) ? entry.tropeId : null;
		}
	}
	return matches;
}

async function getAiTropeMatches(
	env: Env,
	commits: Array<{ sha: string; message: string }>
): Promise<Record<string, string | null>> {
	// Split into small batches: a single huge request is where truncation and
	// timeouts hurt most, and each batch fails (and falls back) independently.
	const batches: Array<Array<{ sha: string; message: string }>> = [];
	for (let i = 0; i < commits.length; i += TROPE_BATCH_SIZE) {
		batches.push(commits.slice(i, i + TROPE_BATCH_SIZE));
	}

	const results = await Promise.all(
		batches.map(async (batch) => {
			try {
				return await classifyTropeBatch(env, batch);
			} catch (error) {
				console.error("AI batch classification failed:", error);
				return {} as Record<string, string | null>;
			}
		})
	);

	return Object.assign({}, ...results) as Record<string, string | null>;
}

// Log all incoming requests for debugging
app.use("*", async (c, next) => {
	console.log(`[Worker] ${c.req.method} ${c.req.url}`);
	await next();
});

// Enable CORS for development
app.use("/*", cors({
	origin: "*",
	credentials: true,
    allowHeaders: ['X-Custom-Header', 'Upgrade-Insecure-Requests'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
}));

// Test endpoint to verify worker is running
app.get("/api/health", (c) => {
	return c.json({
		status: "ok",
		message: "Worker is running!",
		hasClientId: !!c.env.GITHUB_CLIENT_ID,
		url: c.req.url,
	});
});

app.get("/api/auth/login", (c) => {
	console.log("Login endpoint hit!");
	const clientId = c.env.GITHUB_CLIENT_ID;
	console.log("Client ID:", clientId);

	const callbackUrl = new URL("/api/auth/callback", c.req.url).toString();
	console.log("Callback URL:", callbackUrl);

	const state = crypto.randomUUID();

	// In development (localhost), secure must be false
	const isSecure = c.req.url.startsWith("https://");

	setCookie(c, "github_oauth_state", state, {
		httpOnly: true,
		secure: isSecure,
		sameSite: "Lax",
		maxAge: 600, // 10 minutes
	});

	// Redirect to GitHub OAuth authorization page
	const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
	githubAuthUrl.searchParams.set("client_id", clientId);
	githubAuthUrl.searchParams.set("redirect_uri", callbackUrl);
	githubAuthUrl.searchParams.set("scope", "repo read:user");
	githubAuthUrl.searchParams.set("state", state);

	console.log("Redirecting to:", githubAuthUrl.toString());
	return c.redirect(githubAuthUrl.toString());
});


app.get("/api/auth/callback", async (c) => {
	const code = c.req.query("code");
	const state = c.req.query("state");
	const storedState = getCookie(c, "github_oauth_state");

	// Validate state to prevent CSRF attacks
	if (!state || !storedState || state !== storedState) {
		return c.json({ error: "Invalid state parameter" }, 400);
	}

	if (!code) {
		return c.json({ error: "No authorization code provided" }, 400);
	}

	try {
		const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json",
			},
			body: JSON.stringify({
				client_id: c.env.GITHUB_CLIENT_ID,
				client_secret: c.env.GITHUB_CLIENT_SECRET,
				code,
			}),
		});

		const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };

		if (tokenData.error || !tokenData.access_token) {
			return c.json({ error: "Failed to get access token" }, 500);
		}

		// Store access token in cookie
		const isSecure = c.req.url.startsWith("https://");
		setCookie(c, "github_access_token", tokenData.access_token, {
			httpOnly: true,
			secure: isSecure,
			sameSite: "Lax",
			maxAge: 60 * 60 * 24 * 7, // 7 days
		});

		// Redirect back to the app
		return c.redirect("/");
	} catch (error) {
		console.error("OAuth callback error:", error);
		return c.json({ error: "Authentication failed" }, 500);
	}
});

// Get current user info
app.get("/api/user", async (c) => {
	const accessToken = getCookie(c, "github_access_token");

	if (!accessToken) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	try {
		const userResponse = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				...GITHUB_API_HEADERS,
			},
		});

		if (!userResponse.ok) {
			return c.json({ error: "Failed to fetch user data" }, userResponse.status as never);
		}

		const userData = await userResponse.json();
		return c.json(userData);
	} catch (error) {
		console.error("Error fetching user:", error);
		return c.json({ error: "Failed to fetch user data" }, 500);
	}
});

// Get user's repositories
app.get("/api/repos", async (c) => {
	const accessToken = getCookie(c, "github_access_token");

	if (!accessToken) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	try {
		const reposResponse = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", {
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"Accept": "application/vnd.github+json",
				"User-Agent": "Commit-Bingo-App",
			},
		});

		if (!reposResponse.ok) {
			return c.json({ error: "Failed to fetch repositories" }, reposResponse.status as never);
		}

		const repos = await reposResponse.json();
		return c.json(repos);
	} catch (error) {
		console.error("Error fetching repos:", error);
		return c.json({ error: "Failed to fetch repositories" }, 500);
	}
});

// Get commits from user's repositories
app.get("/api/commits", async (c) => {
	const accessToken = getCookie(c, "github_access_token");

	if (!accessToken) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	try {
		const userResponse = await fetch("https://api.github.com/user", {
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"Accept": "application/vnd.github+json",
				"User-Agent": "Commit-Bingo-App",
			},
		});

		const user = await userResponse.json() as { login: string };

		// Get user's repositories
		const reposResponse = await fetch("https://api.github.com/user/repos?sort=updated&per_page=50", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				...GITHUB_API_HEADERS,
			},
		});

		const repos = await reposResponse.json() as Array<{ full_name: string; owner: { login: string } }>;

		const allCommits: Array<{ sha: string; message: string; repo: string; date: string; files?: CommitFileSummary[]; digest?: CommitDigest; tropeId?: string | null }> = [];

		for (const repo of repos.slice(0, 10)) { // Limit to 10 repos
			try {
				const commitsResponse = await fetch(
					`https://api.github.com/repos/${repo.full_name}/commits?author=${user.login}&per_page=20`,
					{
						headers: {
							Authorization: `Bearer ${accessToken}`,
							...GITHUB_API_HEADERS,
						},
					}
				);

				if (commitsResponse.ok) {
					const commits = await commitsResponse.json() as Array<{
						sha: string;
						commit: {
							message: string;
							author: { date: string }
						}
					}>;

					for (const commit of commits) {
						allCommits.push({
							sha: commit.sha,
							message: commit.commit.message,
							repo: repo.full_name,
							date: commit.commit.author.date,
						});
					}
				}
			} catch (err) {
				console.error(`Error fetching commits for ${repo.full_name}:`, err);
			}
		}

		// Perform AI batch classification on the latest 50 commits to avoid token limits
		const commitsToClassify = allCommits.slice(0, 50).map((c) => ({
			sha: c.sha,
			message: c.message,
		}));

		if (commitsToClassify.length > 0) {
			const aiMatches = await getAiTropeMatches(c.env, commitsToClassify);
			for (const commit of allCommits) {
				if (commit.sha in aiMatches) {
					commit.tropeId = aiMatches[commit.sha];
				}
			}
		}

		return c.json({ commits: allCommits, total: allCommits.length });
	} catch (error) {
		console.error("Error fetching commits:", error);
		return c.json({ error: "Failed to fetch commits" }, 500);
	}
});

app.get("/api/commit-details", async (c) => {
	const accessToken = getCookie(c, "github_access_token");

	if (!accessToken) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const repo = c.req.query("repo");
	const sha = c.req.query("sha");
	const message = c.req.query("message") || "";

	if (!repo || !sha) {
		return c.json({ error: "Missing repo or sha" }, 400);
	}

	try {
		const files = await getCommitFiles(accessToken, repo, sha);
		const fallbackDigest = buildDigest(files);
		const digest = await getAiDigest(c, {
			message,
			repo,
			files,
		}, fallbackDigest);

		return c.json({ files, digest });
	} catch (error) {
		console.error("Error fetching commit details:", error);
		return c.json({ error: "Failed to fetch commit details" }, 500);
	}
});


app.post("/api/roast", async (c) => {
	const body = await c.req.json() as { commits?: Array<{ message: string; repo: string }> };
	const commits = body.commits || [];

	if (commits.length === 0) {
		return c.json({
			archetype: "The Ghost Developer",
			roast: "You haven't committed anything. Hard to roast someone who doesn't code, though that is one way to avoid bugs.",
			superpower: "Writing bug-free non-existent code.",
			chaosRating: 0,
		});
	}

	try {
		// Use a broad sample so the roast reflects the whole history rather than
		// whichever repo happened to be fetched first. The 70B model has plenty of
		// context headroom for this many one-line commit summaries.
		const commitSummary = commits
			.slice(0, 200)
			.map((commit) => `[${commit.repo}] ${commit.message}`)
			.join("\n");

		const parsed = await runAiJson<{
			archetype: string;
			roast: string;
			superpower: string;
			chaosRating: number;
		}>(
			c.env,
			SMART_AI_MODEL,
			[
				{
					role: "system",
					content: "You are a sarcastic, witty senior software engineer who has seen too much bad code.",
				},
				{
					role: "user",
					content: [
						"Analyze the following Git commit history of a developer. Based on it, generate:",
						"1. A sarcastic, funny senior-developer roast of their habits, messages, or repo styles (max 3 sentences).",
						"2. A funny 'Dev Archetype' title (e.g. 'The Apologetic Cowboy', 'WIP Wrangler', 'Whitespace Whisperer').",
						"3. A 'Dev Superpower' - one genuine positive habit.",
						"4. A 'Chaos Rating' (integer 0-100) reflecting how messy, brief, or chaotic their commit messages are.",
						"",
						"Commit History:",
						commitSummary,
					].join("\n"),
				},
			],
			{
				type: "object",
				properties: {
					archetype: { type: "string" },
					roast: { type: "string" },
					superpower: { type: "string" },
					chaosRating: { type: "integer", minimum: 0, maximum: 100 },
				},
				required: ["archetype", "roast", "superpower", "chaosRating"],
			},
			{ temperature: 0.8, maxTokens: 400 }
		);

		return c.json({
			archetype: parsed.archetype || "Mysterious Coder",
			roast: parsed.roast || "Your commits are too mysterious to roast.",
			superpower: parsed.superpower || "Staying off the radar.",
			chaosRating: Number.isInteger(parsed.chaosRating) ? parsed.chaosRating : 50,
		});

	} catch (error) {
		console.error("Failed to generate roast:", error);
		return c.json({
			archetype: "The Resilient One",
			roast: "Our AI senior dev fell asleep reviewing your commits. Be glad, you escaped the roast this time.",
			superpower: "Surviving compiler warnings.",
			chaosRating: 42,
		});
	}
});


app.get("/api/auth/logout", (c) => {
	const isSecure = c.req.url.startsWith("https://");
	setCookie(c, "github_access_token", "", {
		httpOnly: true,
		secure: isSecure,
		sameSite: "Lax",
		maxAge: 0, // Delete cookie
	});

	return c.redirect("/");
});

export default app;
