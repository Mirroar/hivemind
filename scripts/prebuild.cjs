#!/usr/bin/env node

/**
 * Prebuild script to ensure local configuration files exist.
 *
 * Copies example files to src/ if the local versions don't exist.
 * This allows the build to succeed in CI environments while still
 * allowing users to customize their local configurations.
 */

const fs = require('fs');
const path = require('path');

const files = [
	{
		example: 'settings.local.example.ts',
		target: 'src/settings.local.ts',
	},
	{
		example: 'relations.local.example.ts',
		target: 'src/relations.local.ts',
	},
];

for (const file of files) {
	const examplePath = path.join(__dirname, '..', file.example);
	const targetPath = path.join(__dirname, '..', file.target);

	if (fs.existsSync(targetPath)) {
		console.log(`${file.target} already exists, skipping`);
	}
	else {
		console.log(`Creating ${file.target} from ${file.example}`);
		fs.copyFileSync(examplePath, targetPath);
	}
}

console.log('Prebuild complete');
