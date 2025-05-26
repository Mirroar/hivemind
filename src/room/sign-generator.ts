export enum RoomSignType {
    Owned = 'owned',
    Remote = 'remote',
    Expansion = 'expansion',
    Other = 'other',
}

const signTemplates: Record<RoomSignType, string[]> = {
    [RoomSignType.Owned]: [
        'Room managed by hivemind.',
        'Controlled by hivemind bot.',
        'This room is under hivemind operation.',
        'hivemind: owned room.',
        'Maintained by hivemind.',
    ],
    [RoomSignType.Remote]: [
        'Remote site managed by hivemind.',
        'hivemind: remote resource location.',
        'Resource extraction by hivemind.',
        'Remote operation by hivemind bot.',
        'hivemind remote room.',
    ],
    [RoomSignType.Expansion]: [
        'Reserved for hivemind expansion.',
        'hivemind: planned expansion.',
        'Expansion target for hivemind.',
        'hivemind will expand here.',
        'Future hivemind site.',
    ],
    [RoomSignType.Other]: [
        'Signed by hivemind.',
        'hivemind was here.',
        'Room visited by hivemind.',
        'hivemind: neutral room.',
        'No current hivemind activity.',
    ],
}


export default class SignGenerator {
    public generateSign(roomName: string) {
        const roomType = this.getRoomType(roomName);
        const randomSeed = this.getRandomSeed(roomName);
        
        return this.getRandomSign(roomType, randomSeed);
    }

    private getRoomType(roomName: string): RoomSignType {
        if (Game.rooms[roomName]?.isMine()) {
            return RoomSignType.Owned;
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

    private getRandomSign(roomType: RoomSignType, seed: number): string {
        const signs = signTemplates[roomType];
        const index = seed % signs.length;
        
        return signs[index];
    }
}
