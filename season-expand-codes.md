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
