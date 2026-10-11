import { build } from "esbuild";

await build({
	entryPoints: ["src/main.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "es2022",
	external: ["obsidian", "electron"],
	outfile: "main.js",
	sourcemap: "external",
	logLevel: "info"
});
