# First jump to W2N23

## prepare squad (to build containers, etc)
const s = container.get('SquadManager').getOrCreateSquad('prepareJump');
s.setUnitCount('builder', 6);
s.setCivilianCount('harvester', 2);
s.setCivilianCount('transporter', 2);
s.setCivilianCount('builder', 2);
s.setSpawn('W2N16');
s.setTarget(new RoomPosition(34, 27, 'W2N23'));

## actual jump squad, to spawn fresh workers with full TTL
r = {roomName: 'W2N23', spawnRoom: 'W2N16'}; (new ExpandProcess()).startExpansion(r);

const s = container.get('SquadManager').getOrCreateSquad('prepareJump');
s.clearUnits();
s.setSpawn(null);

# Second jump to E1N32?

## Scout the path
const s = container.get('SquadManager').getOrCreateSquad('prepareJump');
s.setUnitCount('test', 1);
s.setSpawn('W2N23');
s.setTarget(new RoomPosition(34, 27, 'E1N32'));

const s = container.get('SquadManager').getOrCreateSquad('prepareJump');
s.clearUnits();
s.setSpawn(null);
s.setTarget(new RoomPosition(25, 25, 'E2N33'));

## prepare squad (to build containers, etc)
const s = container.get('SquadManager').getOrCreateSquad('prepareJump');
s.setUnitCount('builder', 6);
s.setCivilianCount('harvester', 2);
s.setCivilianCount('transporter', 2);
s.setCivilianCount('builder', 2);
s.setSpawn('W2N23');
s.setTarget(new RoomPosition(34, 27, 'E1N32'));

## actual jump squad, to spawn fresh workers with full TTL
r = {roomName: 'E1N32', spawnRoom: 'W2N23'}; (new ExpandProcess()).startExpansion(r);

const s = container.get('SquadManager').getOrCreateSquad('prepareJump');
s.clearUnits();
s.setSpawn(null);

# Third jump to E4N37

## Go with normal expand squad right away, supplement later
r = {roomName: 'E4N37', spawnRoom: 'E1N32'}; (new ExpandProcess()).startExpansion(r);
const s = container.get('SquadManager').getOrCreateSquad('prepareJump');
s.setUnitCount('builder', 4);
s.setCivilianCount('remoteHarvester', 2);
s.setCivilianCount('relayHauler', 2);
s.setSpawn('E1N32');
s.setTarget(new RoomPosition(34, 27, 'E4N37'));

# Scout
const s = container.get('SquadManager').getOrCreateSquad('prepareJump');
s.setUnitCount('test', 1);
s.setSpawn('E1N51');
s.setTarget(new RoomPosition(25, 25, 'E1N62'));

## Expand
r = {roomName: 'E1N62', spawnRoom: 'E1N51'}; (new ExpandProcess()).startExpansion(r);