import { Hono } from "hono";
import { setCookie, getCookie } from "hono/cookie";
import { cors } from "hono/cors";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

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
				"Authorization": `Bearer ${accessToken}`,
				"Accept": "application/vnd.github+json",
				"User-Agent": "Commit-Bingo-App",
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
				"Authorization": `Bearer ${accessToken}`,
				"Accept": "application/vnd.github+json",
				"User-Agent": "Commit-Bingo-App",
			},
		});

		const repos = await reposResponse.json() as Array<{ full_name: string; owner: { login: string } }>;

		const allCommits: Array<{ message: string; repo: string; date: string }> = [];

		for (const repo of repos.slice(0, 10)) { // Limit to 10 repos
			try {
				const commitsResponse = await fetch(
					`https://api.github.com/repos/${repo.full_name}/commits?author=${user.login}&per_page=20`,
					{
						headers: {
							"Authorization": `Bearer ${accessToken}`,
							"Accept": "application/vnd.github+json",
							"User-Agent": "Commit-Bingo-App",
						},
					}
				);

				if (commitsResponse.ok) {
					const commits = await commitsResponse.json() as Array<{
						commit: {
							message: string;
							author: { date: string }
						}
					}>;
					allCommits.push(
						...commits.map((commit) => ({
							message: commit.commit.message,
							repo: repo.full_name,
							date: commit.commit.author.date,
						}))
					);
				}
			} catch (err) {
				console.error(`Error fetching commits for ${repo.full_name}:`, err);
			}
		}

		return c.json({ commits: allCommits, total: allCommits.length });
	} catch (error) {
		console.error("Error fetching commits:", error);
		return c.json({ error: "Failed to fetch commits" }, 500);
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
