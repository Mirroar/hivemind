# Hivemind: An Advanced AI Bot for Screeps

Welcome to Hivemind, an open-source AI bot designed to autonomously operate within the universe of the game [screeps](https://screeps.com). Hivemind is built for both private and official servers, serving as decent bot-opponents on your private servers, or as a solid base for developing your own screeps bot.

[![Code Climate](https://codeclimate.com/github/Mirroar/hivemind/badges/gpa.svg)](https://codeclimate.com/github/Mirroar/hivemind)

## Table of Contents
- [Project Overview](#project-overview)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Features](#features)
  - [Capabilities](#capabilities)
  - [Limitations](#limitations)
  - [Reasoning](#reasoning)
- [Customization](#customization)
- [Manual Interaction](#manual-interaction)
- [Contributing](#contributing)
- [License](#license)
- [Troubleshooting](#troubleshooting)

## Project Overview

Hivemind was originally developed as a fully automated bot on the official screeps servers with the intention of serving as a capable sparring partner on private servers.

It is intended to be used without interaction, but the bot's behaviour can be customized through an array of settings. There's also a limited pallette of commands for manual interaction.

## Getting Started

### Prerequisites

- Node.js (version 16), use nvm or something similar to downgrade if necessary
- A screeps account
- An active screeps API key, if you want to push code directly

### Installation

#### Installing as a private server bot

Your best bet for finding up-to-date information on setting up a private server with custom bots is checking the pinned messages in the `#servers` channel of the [official screeps discord](https://chat.screeps.com/). In general, once you have a private server set up, you should be able to add `screeps-bot-hivemind` as an npm dependency, add it to your server's configuration file, and then spawn in the bot using the screeps private server CLI.

#### Building from source

1. **Clone the Repository**:
   ```
   git clone https://github.com/Mirroar/hivemind.git
   cd hivemind
   ```
2. **Install Dependencies**:
   ```
   npm install
   ```
3. **Set up files intended for customization**:
   ```
   cp settings.local.example.ts src/settings.local.ts
   cp relations.local.example.ts src/relations.local.ts
   ```
4. **Transpile TypeScript to JavaScript**:
   ```
   rollup -c
   ```
5. **Deploy**:
   You can copy the files from the `dist` directory to the server using the screeps game client.

   Alternatively, you can push the code using grunt (requires copying `Gruntfile.example.js` to `Gruntfile.cjs` and adding your account information):
   ```
   grunt screeps --gruntfile Gruntfile.cjs
   ```

## Features

### Capabilities

- **Resource Management**: Automatically scout, mine, and defend energy sources.
- **Expansion**: Capable of expanding into new suitable rooms.
- **Construction**: Manages structure planning and building.
- **Boosts**: Harvests, distributes and processes minerals into boosts.
- **Commodities**: Harvests and processes commodities from highway rooms.
- **Power**: Harvests and processes power from highways rooms.
- **Power Creeps**: Creates, upgrades, spawns and manages operator power creeps to help with economy.
- **Economy**: Dynamically trades resources on the market.

### Limitations

- **Combat**: Does not automatically attack other players' rooms.
- **Defense**: No handling of incoming nukes.
- **Economy**: No automatic mineral mining from source keeper rooms.

### Reasoning

If you're just starting out with screeps, you're probably better off trying to write your own bot instead of using a developed bot such as this one as a base. Much of the game's fun comes from figuring out solutions and then watching your code run like a (more or less) well-oiled machine.

There is also a general dislike with "non coding players" (NCPs) in the screeps community. The term describes players that only download and run open-source bots without modification, thus not actually "playing" the game, since most of the game revolves around writing your own code.

Because of this, Hivemind is released with limited combat capabilities, so it can be killed by players that invested time into writing their own code. Otherwise the optimal way to play would be downloading open-source bots like this one, and soon most people would just be using the same bot. Don't be surprised if players around you act agressively, especially if you're using an open-source bot.

If you want to have the ability to stand up against other strong players, you will need to write better combat code yourself.

### Customization

To adjust the bot's behavior to your liking, you may copy `settings.local.example.ts` to `src/settings.local.ts` and override any of the settings from `src/settings.default.ts`.

Customize diplomatic relations by copying `relations.local.example.ts` to `src/relations.local.ts` and adjusting it to your needs.

## Manual interaction

Take a look at `snippets.js` for common console commands you might want to use when running this bot.

## Contributing

Contributions are welcome! Please check out our [issues tracker](https://github.com/Mirroar/hivemind/issues) for more information on how you can contribute.

## License

Hivemind is released under the MIT License. See the LICENSE file for more details.

## Troubleshooting

If you encounter issues, feel free to create an issue or post your questions to the `#hivemind` channel in the [official screeps discord](https://chat.screeps.com/).
