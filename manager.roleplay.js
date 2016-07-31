var songs = {
    harder: {
        roles: ['harvester', 'harvester.mineral', 'transporter', 'upgrader', 'repairer', 'builder', 'hauler'],
        lines: [
            'work it',
            '',
            'make it',
            '',
            'do it',
            '',
            'makes us',
            '',
            '♪',
            '♪',
            '♪',
            '♬',
            '♪',
            '♪',
            '♪',
            '♬',

            '',
            'harder',
            '',
            'better',
            '',
            'faster',
            '',
            'stronger',
            '♪',
            '♪',
            '♪',
            '♬',
            '♪',
            '♪',
            '♪',
            '♬',

            'work it',
            '',
            'make it',
            '',
            'do it',
            '',
            'makes us',
            '',
            '♪',
            '♪',
            '♪',
            '♬',
            '♪',
            '♪',
            '♪',
            '♬',

            '',
            'harder',
            '',
            'better',
            '',
            'faster',
            '',
            'stronger',
            '',
            '♪',
            '♪',
            '♪',
            '♬',
            '♪',
            '♪',
            '♪',
            '♬',

            'work it',
            'harder',
            'make it',
            'better',
            'do it',
            'faster',
            'makes us',
            'stronger',
            'more than',
            'ever',
            'hour',
            'after',
            'hour',
            'work is',
            'never',
            'over',

            'work it',
            'harder',
            'make it',
            'better',
            'do it',
            'faster',
            'makes us',
            'stronger',
            'more than',
            'ever',
            'hour',
            'after',
            'hour',
            'work is',
            'never',
            'over',
        ],
    },
};

var roleplay = {

    roomSongs: function() {
        return;
        //foo[bar] = baz;
        for (var roomNum in Game.rooms) {
            var room = Game.rooms[roomNum];

            if (!room.controller || !room.controller.my) continue;

            if (!room.memory.roleplay) {
                room.memory.roleplay = {};
            }
            if (!room.memory.roleplay.roomSong) {
                room.memory.roleplay.roomSong = {};
            }

            var songMemory = room.memory.roleplay.roomSong;

            if (!songMemory.name) songMemory.name = 'harder';
            if (!songs[songMemory.name]) continue;
            var song = songs[songMemory.name];

            if (!songMemory.currentBeat) songMemory.currentBeat = 0;
            songMemory.currentBeat++;

            if (songMemory.currentBeat >= song.lines.length) {
                songMemory.currentBeat = 0;
            }

            if (!song.lines[songMemory.currentBeat] || song.lines[songMemory.currentBeat] == '') continue;

            var creeps = room.find(FIND_MY_CREEPS, {
                filter: (creep) => song.roles.includes(creep.memory.role)
            });
            if (creeps.length <= 0) continue;

            var creep = creeps[Math.floor(Math.random() * creeps.length)];

            creep.say(song.lines[songMemory.currentBeat], true);
        }
    }

};

module.exports = roleplay;