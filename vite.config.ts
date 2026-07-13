import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode }) => {
	return {
		plugins: [
			react(),
			cloudflare({
				configPath: mode === "production" ? "./wrangler.json" : "./wrangler.dev.json",
				persistState: true,
			}),
		],
		build: {
			outDir: "dist/client",
		},
	};
});
