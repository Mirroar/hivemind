'use strict';

/**
 * This file contains the default settings for hivemind.
 *
 * Please do not edit these settings directly, as they might be overwritten
 * should you update to a newer release of the bot.
 * Instead, you may create a file named `settings.js` where you may override
 * any setting from this file.
 *
 * Example `settings.js`:
 * @code
 * module.exports = {
 *   visualizeNavMesh: true,
 * };
 * @endcode
 *
 * You may also override any setting via memory within the game. You may use
 * the following method in the game's console:
 * @code
 * hivemind.settings.set('visualizeNavMesh', true);
 * @endcode
 */
module.exports = {
  // If true, lines representing connections in the bot's nav mesh will be drawn
  // on the world map.
  visualizeNavMesh: false,
};
