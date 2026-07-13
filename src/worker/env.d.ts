// Environment variable types for Cloudflare Worker
export interface Env {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	// Cloudflare Workers AI binding. Configured in wrangler.json as { "ai": { "binding": "AI" } }.
	// The `Ai` type comes from the generated worker-configuration.d.ts.
	AI: Ai;
}
