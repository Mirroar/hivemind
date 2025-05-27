import hivemind from "hivemind";
import RoomSignGenerator from "room/sign-generator";
import { getUsername } from "utils/account";

export const RESIGN_COOLDOWN = 1000; // Cooldown period in ticks before we can change the sign again.

export default class RoomSignManager {
    private generator: RoomSignGenerator;

    public constructor(generator: RoomSignGenerator) {
        this.generator = generator;
    }

    public shouldSign(roomName: string): boolean {
        if (!Game.rooms[roomName]) {
            return false;
        }

        const expectedSign = this.getExpectedSign(roomName);
        const currentSign = Game.rooms[roomName].controller?.sign;
        
        if (expectedSign === null && currentSign?.username !== getUsername()) {
            // If the expected sign is null, we should not change the sign (other than cleaning up our own signs).
            return false;
        }

        if (currentSign?.username === getUsername() && Game.time - currentSign.time < RESIGN_COOLDOWN) {
            // If the sign is already set by us and within the cooldown period, no need to change it.
            return false;
        }

        if (currentSign && currentSign.text !== expectedSign) {
            hivemind.log('rooms', roomName).debug(`Sign is not as expected. Expected: "${expectedSign}", current: "${currentSign.text}"`);
            return true;
        }

        if (!currentSign && expectedSign) {
            hivemind.log('rooms', roomName).debug(`Sign is missing. Expected: "${expectedSign}"`);
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
        const signText = this.generator.generateSign(roomName);

        return signText;
    }
}