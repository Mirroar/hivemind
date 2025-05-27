import hivemind from "hivemind";
import { getUsername } from "utils/account";

export const RESIGN_COOLDOWN = 1000; // Cooldown period in ticks before we can change the sign again.

export default class RoomSignManager {
    public shouldSign(roomName: string): boolean {
        if (!Game.rooms[roomName]) {
            return false;
        }

        const expectedSign = this.getExpectedSign(roomName);
        if (expectedSign === null) {
            return false;
        }

        const currentSign = Game.rooms[roomName].controller?.sign;
        if (currentSign?.username === getUsername() && Game.time - currentSign.time < RESIGN_COOLDOWN) {
            // If the sign is already set by us and within the cooldown period, no need to change it.
            return false;
        }

        if (currentSign && currentSign.text !== expectedSign) {
            hivemind.log(`Room ${roomName} sign is not as expected. Expected: "${expectedSign}", current: "${currentSign.text}"`);
            return true;
        }

        if (!currentSign && expectedSign) {
            hivemind.log(`Room ${roomName} sign is missing. Expected: "${expectedSign}"`);
            return true;
        }

        return false;
    }

    /**
     * Returns the expected sign for a room.
     *
     * @param {string} roomName
     *   The name of the room to get the expected sign for.
     * @returns {string | null}
     *   The expected sign text, or null if the sign should not be changed.
     */
    public getExpectedSign(roomName: string): string | null {
        if (!Game.rooms[roomName].isMine()) {
            return null;
        }

        return `Powered by Hivemind\n\n  - https://github.com/mirroar/hivemind`;
    }
}