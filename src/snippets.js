/**
 * @file
 * Contains small code snippets for use in the console. Do not require this file.
 */

// Remove all constructions sites in a roon you have vision in:
_.forEach(Game.rooms.E49S48.find(FIND_CONSTRUCTION_SITES), (s) => s.remove());
