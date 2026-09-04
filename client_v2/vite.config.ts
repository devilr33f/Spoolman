import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['localStorage', 'preferredLanguage', 'baseLocale']
		})
	],
	server: { port: 5174 },
	// niimbluelib ships CommonJS only; pre-bundling it keeps the dev server's ESM
	// interop from tripping over its capacitor imports (niimblue does the same).
	optimizeDeps: { include: ['@mmote/niimbluelib'] },
	test: {
		// Unit tests only. The Playwright a11y audit lives in e2e/ and is run by
		// `npm run audit:a11y`; including it here would make vitest try to execute it.
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
