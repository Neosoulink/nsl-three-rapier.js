import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
	build: {
		lib: {
			entry: resolve(import.meta.dirname, "src/main.ts"),
			name: "NmnslThreeRapier",
			fileName: "main"
		},
		rolldownOptions: {
			external: ["three", "@dimforge/rapier3d-compat"],
			output: {
				globals: {
					three: "THREE",
					"@dimforge/rapier3d-compat": "RAPIER"
				}
			}
		}
	},
	resolve: {
		alias: {
			"@/": resolve(import.meta.dirname, "src/")
		}
	},
	plugins: [
		dts({
			entryRoot: "src",
			outDir: "dist"
		})
	]
});
