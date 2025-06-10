import container from "utils/container";

export enum RoomSignType {
    Owned = 'owned',
    Remote = 'remote',
    Other = 'other',
}

const signTemplates: Record<RoomSignType, string[]> = {
    [RoomSignType.Owned]: [
        'Powered by Hivemind\n\n  - https://github.com/mirroar/hivemind',
        'Room managed by hivemind\n\n  - https://github.com/mirroar/hivemind',
        'Controlled by hivemind bot\n\n  - https://github.com/mirroar/hivemind',
        'This room is under hivemind operation\n\n  - https://github.com/mirroar/hivemind',
        'Maintained by hivemind\n\n  - https://github.com/mirroar/hivemind',
    ],
    [RoomSignType.Remote]: [
        'Remote site managed by hivemind.',
        'Resource extraction by hivemind.',
        'Remote operation by hivemind bot.',
        'hivemind remote room.',
    ],
    [RoomSignType.Other]: [],
}

export default class RoomSignGenerator {
    public generateSign(roomName: string) {
        const roomType = this.getRoomType(roomName);
        const randomSeed = this.getRandomSeed(roomName);
        
        return this.getRandomSign(roomName, roomType, randomSeed);
    }

    private getRoomType(roomName: string): RoomSignType {
        if (Game.rooms[roomName]?.isMine()) {
            return RoomSignType.Owned;
        }

        if ((Memory.strategy?.remoteHarvesting?.rooms || []).includes(roomName)) {
            return RoomSignType.Remote;
        }

        return RoomSignType.Other;
    }

    private getRandomSeed(roomName: string): number {
        // Use the room name as a seed for reproducibility.
        // The result should be semi-random so W4N5 and W5N4 will not have the same sign.
        let seed = 0;
        for (let i = 0; i < roomName.length; i++) {
            seed += roomName.charCodeAt(i) * (i + 1);
        }
        
        return Math.floor(seed % 1000); // Limit the seed to a manageable range
    }

    private getRandomSign(roomName: string, roomType: RoomSignType, seed: number): string | null {
        const signs = signTemplates[roomType];
        if (!signs || signs.length === 0) {
            const roomStatus = container.get('RoomStatus');
            const isCloseRoom = roomStatus.hasRoom(roomName) && roomStatus.getDistanceToOrigin(roomName) <= 2;

            if (roomType === RoomSignType.Owned || roomType === RoomSignType.Remote || isCloseRoom) {
                return '';
            }

            return null;
        }

        const index = seed % signs.length;
        
        return signs[index];
    }
}
