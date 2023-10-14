# Hivemind - a screeps bot

[![Code Climate](https://codeclimate.com/github/Mirroar/hivemind/badges/gpa.svg)](https://codeclimate.com/github/Mirroar/hivemind)

## General Info

This is an open source bot for the game [screeps](https://screeps.com), intended to be used as a fully automated partner / opponent on private servers.

Most of the code originated from an AI written on the official servers. It is intended to be used without interaction, but there are some things that can be triggered manually, and the bot can be customized through several settings.

### Build instructions

1. Install dependencies by running `npm i`.
2. Run `rollup -c` to transpile the TypeScript code to JavaScript.
3. Deploy the files in the `dist` directory to the game or as a bot on your private server.

### Customization

You may create and edit `src/settings.local.ts` to override any of the settings in `src/settings.default.ts`. You may use `settings.local.example.ts` as an example for this.

Similarly, if you don't want to attack certain players' creeps, you may copy and adjust `relations.local.example.ts` to `src/relations.local.ts`.

### Manual interaction

Take a look at `snippets.js` for common console commands you might want to use when running this bot.

## Official servers

If you're just starting out with screeps, you're probably better off trying to write your own AI instead of using a developed AI such as this one as a base. Much of the game's fun comes from figuring out solutions yourself and then watching your code run like a (more or less) well-oiled machine.

Nonetheless, nobody can stop you from using this code on the official servers.

### Capabilities

#### This bot is able to:
- Automatically scout, evaluate, mine and defend adjacent rooms for energy
- Automatically expand into new rooms, provided there is enough GCL and CPU
- Plan and manage all structures of a room
- Harvest and process minerals to boost our creeps
- Harvest and process commodities from highways
- Harvest and process power from highways
- Create, upgrade, spawn and manage operator power creeps to help with economy
- Use the market to buy and sell resources

#### This bot can not:
- Auto-attack other players
- Defend well against nukes

#### Reasoning:

There is a general dislike with "non coding players" (NCPs) in the screeps community. The term describes players that only download and run open-source bots without modification, thus noch actually "playing" the game, since much of the game is writing your own code.
Because of this, open-source bots should not be too strong, so they can be killed by players that invested time into writing their own code. Otherwise the optimal way to play would be downloading these open-source bots, and soon most people would just use the same bot.
If you want to have the ability to stand up against other strong players, you will need to write the code for that yourself.
