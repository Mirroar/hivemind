# Hivemind - Copilot Coding Agent Instructions

## Project Overview
**Hivemind** is an advanced AI bot for the game Screeps (https://screeps.com), written in **TypeScript**. The bot autonomously manages rooms, resources, expansion, construction, mining, power harvesting, commodities, and trading. It is designed to run on both private and official Screeps servers. The codebase contains ~12,000 lines of TypeScript across 201 source files.

**Key Details:**
- **Language:** TypeScript (transpiled to JavaScript via Rollup)
- **Runtime:** Node.js v16 (required - project will NOT build on Node v20+)
- **Size:** Medium (~200 TypeScript files, 12k+ lines)
- **Target Platform:** Screeps game servers
- **Build Tool:** Rollup with TypeScript plugin
- **Linter:** XO (ESLint wrapper)
- **Package Manager:** npm

---

## Critical Build Requirements

### **ALWAYS use Node.js v16**
The project requires Node.js v16 and **will fail to build** with Node v20 or later due to incompatible dependencies (tslib, rollup-plugin-typescript2). If you encounter build errors like "Package subpath './package.json' is not defined by exports", you are using the wrong Node version.

**To switch to Node 16:**
```bash
source /home/runner/.nvm/nvm.sh && nvm install 16 && nvm use 16
```

**Verification:**
```bash
node --version  # Should output v16.x.x
```

### **Required Local Configuration Files**
The build will fail without these files. They must be created **before** building:

```bash
cp settings.local.example.ts src/settings.local.ts
cp relations.local.example.ts src/relations.local.ts
```

These files allow users to customize bot behavior and diplomatic relations. They are in `.gitignore` and should NOT be committed.

---

## Build & Test Commands

**Always run commands in this exact order:**

### 1. Install Dependencies
```bash
npm install
```
**Time:** ~5-10 seconds (after npm cache is populated)  
**Notes:** You may see deprecation warnings (urix, resolve-url, chokidar) and security vulnerabilities - these are pre-existing and can be ignored.

### 2. Build the Project
```bash
npm run build
```
**Equivalent to:** `rollup -c`  
**Time:** ~14-16 seconds  
**Output:** Creates `dist/main.js` and `dist/main.js.map.js`

**Expected warnings during build:**
- Deprecation warning about tslib package exports - **safe to ignore**
- Circular dependency warnings about `cost-matrix.ts`, `room-defense.ts`, `nav-mesh.ts`, and `room-intel.ts` - **these are known and do not break functionality**
- "No destination specified - code will be compiled but not uploaded" - **normal** (upload requires `screeps.json` config)

**Build will fail if:**
- Node version is not 16
- Local settings files are missing (see above)

### 3. Lint the Code
```bash
npm test
```
**Equivalent to:** `xo`  
**Time:** ~3-5 seconds

**Important:** The codebase currently has **4000+ linting errors**. These are pre-existing issues. When making changes:
- Only fix linting errors **directly related** to your changes
- Do NOT attempt to fix all linting errors globally
- Focus on making your new code follow the linting rules

**Common XO rules to follow:**
- Use `===` instead of `==`
- Avoid `@typescript-eslint/no-unsafe-*` violations
- Follow brace-style: `stroustrup` (else/catch on new line)
- Use `'error'` log level for comma-dangle: `'always-multiline'`

---

## Project Structure

### Root Directory Files
- `package.json` - Dependencies and npm scripts
- `tsconfig.json` - TypeScript compiler configuration
- `rollup.config.js` - Build configuration (Rollup bundler)
- `.nvmrc` - Node version specification (v16)
- `README.md` - User documentation
- `CHANGELOG.md` - Version history
- `snippets.js` - Console commands for manual bot interaction (not imported by code)
- `Gruntfile.example.js` - Example Grunt config for deploying to Screeps servers
- `settings.local.example.ts` - Example settings customization
- `relations.local.example.ts` - Example diplomatic relations config
- `.gitignore` - Excludes `src/*.local.ts`, `dist/`, `node_modules/`, `screeps.json`

### Source Code Organization (`/src`)

**Main Entry Point:**
- `src/main.ts` - Application entry point, imports all processes and prototypes

**Core Bot Logic:**
- `src/hivemind.ts` - Core kernel/process scheduler
- `src/utilities.ts` - General utility functions
- `src/settings-manager.ts` - Settings management (imports `settings.local.ts`)
- `src/relations.ts` - Diplomatic relations (imports `relations.local.ts`)
- `src/settings.default.ts` - Default bot settings

**Key Subdirectories:**
- `src/process/` - Game loop processes (cleanup, creeps, resources, rooms, trade, strategy, etc.)
- `src/process/strategy/` - High-level strategy processes (expand, scout, mining, power, deposits, intershard)
- `src/role/` - Creep role behaviors (brawler, builder, hauler, harvester, etc.)
- `src/spawn-role/` - Creep spawning logic per role
- `src/room/` - Room management (defense, planner, operation)
- `src/operation/` - Room operations (remote mining, expansion, etc.)
- `src/creep/` - Creep-specific logic and behaviors
- `src/dispatcher/` - Resource dispatching logic
- `src/empire/` - High-level multi-room management
- `src/prototype/` - Game object prototype extensions (Room, Creep, Structure, etc.)
- `src/utils/` - Utility modules (cost-matrix, nav-mesh, serialization, segmented-memory, etc.)
- `src/report/` - Reporting and statistics

**Configuration & Types:**
- `src/index.d.ts` - TypeScript type definitions for the screeps API, similar to the "@types/screeps" package.

### Build Output
- `dist/main.js` - Bundled JavaScript output (uploaded to Screeps)
- `dist/main.js.map.js` - Source map for debugging

---

## GitHub Workflows & CI

### CI Pipeline (`.github/workflows/nodejs.yml`)
Runs on every push:
1. Checkout code
2. Setup Node.js v16
3. `npm install`
4. `npm run build --if-present`
5. `npm test` (runs XO linter)

**To pass CI, your changes must:**
- Build successfully with Node 16
- Not introduce new linting errors that fail the build (existing errors are tolerated)

### CodeQL Analysis (`.github/workflows/codeql-analysis.yml`)
- Runs on pushes to `master` and PRs to `master`
- Performs static security analysis on JavaScript
- Uses autobuild

---

## Common Development Workflows

### Making Code Changes
1. Ensure Node 16 is active
2. Create local config files if missing (see above)
3. Make your code changes
4. Build: `npm run build`
5. Fix any new build errors
6. Lint: `npm test`
7. Fix linting errors in YOUR changed files only
8. Test by reviewing generated `dist/main.js` (manual testing requires a Screeps server)

### Modifying Settings or Relations
- Edit `src/settings.default.ts` for default settings
- User-specific overrides go in `src/settings.local.ts` (do not commit)
- Edit `src/relations.ts` for relations logic
- User-specific relations go in `src/relations.local.ts` (do not commit)

### Adding New Processes
1. Create new file in `src/process/` or appropriate subdirectory
2. Import and register in `src/main.ts`
3. Follow existing process structure (extend base `Process` class)

### Adding New Creep Roles
1. Create role behavior file in `src/role/`
2. Create spawn logic in `src/spawn-role/`
3. Register in appropriate manager

---

## Known Issues & Workarounds

### Issue: Build fails with tslib error
**Error:** `Package subpath './package.json' is not defined by "exports"`  
**Cause:** Using Node v20+ instead of v16  
**Fix:** Switch to Node 16 (see above)

### Issue: Build fails with "Cannot find module 'settings.local'"
**Cause:** Missing required local configuration files  
**Fix:** Copy example files: `cp settings.local.example.ts src/settings.local.ts && cp relations.local.example.ts src/relations.local.ts`

### Issue: Circular dependency warnings during build
**Status:** Known issue, does not break functionality  
**Action:** Ignore these warnings (cost-matrix.ts, room-defense.ts, nav-mesh.ts, room-intel.ts)

### Issue: 4000+ linting errors reported
**Status:** Pre-existing codebase issues  
**Action:** Only fix linting errors in files you modify; do not attempt global fixes

---

## Architecture Notes

**Process System:** The bot uses a process-based architecture with a kernel (`hivemind.ts`) that schedules processes with priorities (ALWAYS, HIGH, LOW). Processes run each game tick.

**Memory Management:** Heavy use of `Memory` object and segmented memory for persistence across ticks. Room intel and room planner use segmented memory to reduce Memory usage.

**Prototypes:** Game objects (Room, Creep, Structure, ConstructionSite) are extended with custom methods via prototype files in `src/prototype/`.

**Nav Mesh:** Custom pathfinding using nav mesh (`src/utils/nav-mesh.ts`) and cost matrices (`src/utils/cost-matrix.ts`).

**Operations:** High-level strategies (remote mining, expansion, power harvesting) are managed as "operations" with stat tracking.

---

## Important Guidelines

1. **Trust these instructions.** Only search for additional information if these instructions are incomplete or incorrect.
2. **Always use Node 16** - the project will not build on newer versions.
3. **Always create local config files** before building (see Required Local Configuration Files).
4. **Test your changes** by building after each significant modification.
5. **Do not fix pre-existing linting errors** unless they are in files you are actively modifying.
6. **Follow the existing code style** - use existing files as templates.
7. **Build time is ~15 seconds** - allow adequate time for builds to complete.
8. **Circular dependencies are expected** - do not try to fix them.
9. **The codebase is game-specific** - changes must work within Screeps' game engine constraints.
10. **No unit tests exist** - validation requires running on a Screeps server (manual testing).

---

## Quick Reference Commands

```bash
# Setup (one-time)
source /home/runner/.nvm/nvm.sh && nvm use 16
cp settings.local.example.ts src/settings.local.ts
cp relations.local.example.ts src/relations.local.ts

# Standard workflow
npm install     # Install dependencies (~5-10 sec)
npm run build   # Build project (~15 sec)
npm test        # Lint code (~3-5 sec)

# Clean build (if needed)
rm -rf dist node_modules src/*.local.ts
```

**End of Instructions**
