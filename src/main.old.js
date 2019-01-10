require('manager.military');
require('manager.source');
require('role.brawler');
require('role.builder');
require('role.builder.exploit');
require('role.claimer');
require('role.dismantler');
require('role.gift');
require('role.harvester');
require('role.harvester.exploit');
require('role.harvester.power');
require('role.harvester.remote');
require('role.hauler');
require('role.hauler.exploit');
require('role.hauler.power');
require('role.helper');
require('role.scout');
require('role.transporter');
require('role.upgrader');
var roleRemoteBuilder = require('role.builder.remote');

var Logger = require('debug');
var BoostManager = require('manager.boost');
var spawnManager = require('manager.spawn');
var utilities = require('utilities');

var Bay = require('manager.bay');
var Exploit = require('manager.exploit');
var Squad = require('manager.squad');

// @todo Add a healer to defender squads, or spawn one when creeps are injured.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.
// @todo make unarmed creeps run from hostiles.

// @todo Cache building info and CostMatrix objects when scanning rooms in intel manager.

// @todo Spawn creeps using "sequences" where more control is needed.

var creepThrottleLevels = {
    // Military creeps are always fully active!
    brawler: {
        max: 0,
        min: -1,
    },
    claimer: {
        max: 0,
        min: -1,
    },
    'builder.remote': {
        max: 0,
        min: -1,
    },

    // Some essential creeps only start throttling when things get critical.
    harvester: {
        max: 'critical',
        min: 0,
    },
    'harvester.minerals': {
        max: 'warning',
        min: 0,
    },
    'harvester.power': {
        max: 'warning',
        min: 0,
    },
    'harvester.remote': {
        max: 'warning',
        min: 'critical',
    },
    'harvester.exploit': {
        max: 'normal',
        min: 0,
    },
    upgrader: {
        max: 'critical',
        min: 0,
    },
    transporter: {
        max: 'normal',
        min: 0,
    },
};

/**
 * Runs a creeps logic depending on role and other factors.
 */
Creep.prototype.runLogic = function() {
    var creep = this;

    if (!Game.creepPerformance[this.memory.role]) {
        Game.creepPerformance[this.memory.role] = {
            throttled: 0,
            count: 0,
            cpu: 0,
        };
    }

    if (!this.memory.throttleOffset) this.memory.throttleOffset = utilities.getThrottleOffset();
    let minBucket = null;
    let maxBucket = null;
    if (creepThrottleLevels[this.memory.role]) {
        let min = creepThrottleLevels[this.memory.role].min;
        let max = creepThrottleLevels[this.memory.role].max;

        if (min && Memory.throttleInfo.bucket[min]) {
            minBucket = Memory.throttleInfo.bucket[min];
        }
        else {
            minBucket = min;
        }
        if (max && Memory.throttleInfo.bucket[max]) {
            maxBucket = Memory.throttleInfo.bucket[max];
        }
        else {
            maxBucket = max;
        }
    }

    if (utilities.throttle(this.memory.throttleOffset, minBucket, maxBucket)) {
        if (creep.pos.x == 0 || creep.pos.x == 49 || creep.pos.y == 0 || creep.pos.y == 49) {
            // Do not throttle creeps at room borders, so they don't get stuck between rooms.
        }
        else {
            Game.numThrottledCreeps++;
            Game.creepPerformance[this.memory.role].throttled++;
            return;
        }
    }

    if (this.memory.singleRoom && this.pos.roomName != this.memory.singleRoom) {
        this.moveTo(new RoomPosition(25, 25, this.memory.singleRoom));
    }

    if (this.memory.singleRoom && this.pos.roomName == this.memory.singleRoom) {
        let stuck = true;
        if (this.pos.x == 0) {
            this.move(RIGHT);
        }
        else if (this.pos.y == 0) {
            this.move(BOTTOM);
        }
        else if (this.pos.x == 49) {
            this.move(LEFT);
        }
        else if (this.pos.y == 49) {
            this.move(TOP);
        }
        else {
            stuck = false;
        }
        if (stuck) {
            this.say('unstuck!');
            delete this.memory.go;
            this.clearCachedPath();
            return;
        }
    }

    Game.creepPerformance[this.memory.role].count++;
    let startTime = Game.cpu.getUsed();

    try {
        if (creep.room.boostManager && creep.room.boostManager.overrideCreepLogic(creep)) {
            return;
        }

        // @todo Condense this mess, please!
        if (creep.memory.role == 'harvester') {
            creep.runHarvesterLogic();
        }
        else if (creep.memory.role == 'harvester.minerals') {
            creep.runHarvesterLogic();
        }
        else if (creep.memory.role == 'upgrader') {
            creep.runUpgraderLogic();
        }
        else if (creep.memory.role == 'builder' || creep.memory.role == 'repairer') {
            creep.runBuilderLogic();
        }
        else if (creep.memory.role == 'transporter') {
            creep.runTransporterLogic();
        }
        else if (creep.memory.role == 'gift') {
            creep.performGiftCollection();
        }
        else if (creep.memory.role == 'harvester.remote') {
            creep.runRemoteHarvesterLogic();
        }
        else if (creep.memory.role == 'harvester.exploit') {
            creep.runExploitHarvesterLogic();
        }
        else if (creep.memory.role == 'harvester.power') {
            creep.runPowerHarvesterLogic();
        }
        else if (creep.memory.role == 'claimer') {
            creep.runClaimerLogic();
        }
        else if (creep.memory.role == 'dismantler') {
            creep.runDismantlerLogic();
        }
        else if (creep.memory.role == 'hauler') {
            creep.runHaulerLogic();
        }
        else if (creep.memory.role == 'hauler.exploit') {
            creep.runExploitHaulerLogic();
        }
        else if (creep.memory.role == 'hauler.power') {
            creep.runPowerHaulerLogic();
        }
        else if (creep.memory.role == 'brawler') {
            creep.runBrawlerLogic();
        }
        else if (creep.memory.role == 'builder.remote') {
            roleRemoteBuilder.run(creep);
        }
        else if (creep.memory.role == 'builder.exploit') {
            creep.runExploitBuilderLogic();
        }
        else if (creep.memory.role == 'helper') {
            creep.runHelperLogic();
        }
        else if (creep.memory.role == 'scout') {
            creep.runScoutLogic();
        }
    }
    catch (e) {
        console.log('Error when managing creep', creep.name, ':', e);
        console.log(e.stack);
    }

    if (!Game.creepPerformance[this.memory.role]) {
        Game.creepPerformance[this.memory.role] = {
            throttled: 0,
            count: 0,
            cpu: 0,
        };
    }
    Game.creepPerformance[this.memory.role].cpu += Game.cpu.getUsed() - startTime;
};

/**
 * Add additional data for each creep.
 */
Creep.prototype.enhanceData = function () {
    let role = this.memory.role;

    // Store creeps by role in global and room data.
    if (!Game.creepsByRole[role]) {
        Game.creepsByRole[role] = {};
    }
    Game.creepsByRole[role][this.name] = this;

    let room = this.room;
    if (!room.creeps) {
        room.creeps = {};
        room.creepsByRole = {};
    }
    room.creeps[this.name] = this;
    if (!room.creepsByRole[role]) {
        room.creepsByRole[role] = {};
    }
    room.creepsByRole[role][this.name] = this;

    // Store creeps that are part of a squad in their respectice squads.
    if (this.memory.squadName) {
        var squad = Game.squads[this.memory.squadName];
        if (squad) {
            if (!squad.units[this.memory.squadUnitType]) {
                squad.units[this.memory.squadUnitType] = [];
            }
            squad.units[this.memory.squadUnitType].push(this);
        }
    }

    // Store creeps that are part of an exploit operation in the correct object.
    if (this.memory.exploitName) {
        if (!Game.exploitTemp[this.memory.exploitName]) {
            Game.exploitTemp[this.memory.exploitName] = [];
        }
        Game.exploitTemp[this.memory.exploitName].push(this.id);
    }
};

/**
 * Adds some additional data to room objects.
 */
Room.prototype.enhanceData = function () {
    this.addStructureReference(STRUCTURE_NUKER);
    this.addStructureReference(STRUCTURE_OBSERVER);
    this.addStructureReference(STRUCTURE_POWER_SPAWN);

    if (this.terminal && !this.terminal.isActive()) {
        delete this.terminal;
    }
    if (this.storage && !this.storage.isActive()) {
        delete this.storage;
    }

    // Prepare memory for creep cache (filled globally later).
    if (!this.creeps) {
        this.creeps = {};
        this.creepsByRole = {};
    }

    // Register sources and minerals.
    this.sources = this.find(FIND_SOURCES);
    for (let i in this.sources) {
        this.sources[i].enhanceData();
    }
    let minerals = this.find(FIND_MINERALS);
    if (minerals.length > 0) {
        this.mineral = minerals[0];
        this.mineral.enhanceData();
    }

    // Register bays.
    this.bays = {};
    if (this.controller && this.controller.my) {
        let flags = this.find(FIND_FLAGS, {
            filter: (flag) => flag.name.startsWith('Bay:')
        });
        for (let i in flags) {
            try {
                this.bays[flags[i].name] = new Bay(flags[i].name);
            }
            catch (e) {
                console.log('Error when initializing Bays:', e);
                console.log(e.stack);
            }
        }
    }

    // Register exploits.
    this.exploits = {};
    if (this.controller && this.controller.level >= 7) {
        flags = _.filter(Game.flags, (flag) => flag.name.startsWith('Exploit:' + this.name + ':'));
        for (let i in flags) {
            try {
                this.exploits[flags[i].pos.roomName] = new Exploit(this, flags[i].name);
                Game.exploits[flags[i].pos.roomName] = this.exploits[flags[i].pos.roomName];
            }
            catch (e) {
                console.log('Error when initializing Exploits:', e);
                console.log(e.stack);
            }
        }
    }

    // Initialize boost manager.
    if (BoostManager) {
        this.boostManager = new BoostManager(this.name);
    }
};

var main = {

    /**
     * Manages logic for all creeps.
     */
    manageCreeps: function () {
        Game.numThrottledCreeps = 0;
        Game.creepPerformance = {};
        for (var name in Game.creeps) {
            var creep = Game.creeps[name];

            if (creep.spawning) {
                continue;
            }

            let temp = function () {
                creep.runLogic();
            }

            // if (useProfiler) {
            //     temp = profiler.registerFN(temp, creep.pos.roomName + '.runCreepLogic');
            // }

            temp();
        }
        if (Game.numThrottledCreeps > 0) {
            hivemind.log('creeps').info(Game.numThrottledCreeps, 'of', _.size(Game.creeps), 'creeps have been throttled due to bucket this tick.');
        }

        for (let role in Game.creepPerformance) {
            if (Game.creepPerformance[role].count > 0) {
                Game.creepPerformance[role].avg = Game.creepPerformance[role].cpu / Game.creepPerformance[role].count;
            }
        }
    },

    /**
     * Main game loop.
     */
    loop: function () {
        var mainLoop = function () {
            Game.squads = {};
            Game.exploits = {};
            Game.creepsByRole = {};
            Game.exploitTemp = {};

            // Add data to global Game object.
            for (var squadName in Memory.squads) {
                Game.squads[squadName] = new Squad(squadName);
            }

            // Cache creeps per room and role.
            for (let creepName in Game.creeps) {
                let creep = Game.creeps[creepName];
                creep.enhanceData();
            }

            // Add data to room objects.
            for (let roomName in Game.rooms) {
                Game.rooms[roomName].enhanceData();
            }

            spawnManager.manageSpawns();

            main.manageCreeps();
        };

        mainLoop();
    }

};

module.exports = main;
