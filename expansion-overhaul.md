# Expansion overhaul
Currently, for expansions, the bot sends a squad of generalist creeps to the new room, and they are expected to do everything from mining to transporting and building. This is not very efficient, and we would profit from sending specialized creeps like we would spawn them in a main room: harvesters, haulers, and builders. This would lead to more efficient mining and building, so the new spawn is built faster, and the room is more quickly able to support itself.

Spawning creeps for expansions is done using our squad system. There is a squadRole "builder" that will create a civilian squad member which, on arrival to the target room, gets changed to use the role "builder.remote".

We have both the main expansion squad spawning these, as well as support squads from nearby rooms that will add more of these units.

## Necessary changes
For the squad system, we need to support different kinds of civilian creeps - harvesters, haulers, and builders. I don't want to add new squad roles for these, since they all share the same logic of travelling to the target room and then changing their role (possibly setting some extra memory properties to indicate their specialization).
But at the same time, the squad system currently only allows specifying the number of creeps requested per squad role. So we either use distinct squad roles, or we need to add some extra properties to the squad role definition to specify the specialization of the civilian creeps.

We'll also need to touch on the expansion support system. With the old way of sending generalist creeps, adding more support creeps was a simple way of increasing the overall efficiency of the expansion. With specialized creeps, this makes less sense, since once the room's sources are saturated with harvesters, adding more won't help. Instead, we need to be able to specify the number of each type of creep we want to send, and have the system spawn the right amount of each specialization across the different squads - or have supporting squads only send military creeps.

## Creep bodies
Since expansion creeps will need to travel a certain distance, they need to have enough move parts for full movement speed on plains - 1 MOVE per WORK part. For transporters, 1 MOVE per CARRY part since there are no roads, yet. Our `BodyBuilder` class can handle this easily, just specify the movement more for using plains.

For harvesters, we want them to be able to mine efficiently, so they should have at least 5 WORK parts. Up to 10 would be better, to save on CPU and allow them to build their own container quickly. If the spawn can't support harvesters this large, we need to spawn multiple per source.

Transporters should be fine with a 1:1 ratio of CARRY to MOVE parts, and the number of CARRY parts should be enough to transport the mined energy efficiently. But we probably don't need more than 10 carry parts worth of transporters, since their only job initially is supplying the builders while the spawn gets built.

Builders should be able to build for a while and not move all the time, so they need more CARRY than WORK parts. A 4:1 ratio of CARRY to WORK parts should be good, and we need about 5 work parts total on builders to build the spawn within a single creep lifetime.