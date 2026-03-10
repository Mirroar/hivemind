import brawlerRole from './role/brawler';
import builderRole from './role/builder';
import squadBrawlerRole from './role/squad-brawler';
import claimerRole from './role/claimer';
import CombatManager from './creep/combat-manager';
import CreepManager from './creep-manager';
import depositHarvesterRole from './role/harvester.deposit';
import dismantlerRole from './role/dismantler';
import guardianRole from './role/guardian';
import harvesterRole from './role/harvester';
import HelpReport from './report/help';
import helperRole from './role/helper';
import mineBuilderRole from './role/builder.mines';
import muleRole from './role/mule';
import powerHarvesterRole from './role/power/harvester';
import powerHaulerRole from './role/power/hauler';
import relayHaulerRole from './role/hauler.relay';
import remoteBuilderRole from './role/builder.remote';
import remoteHarvesterRole from './role/harvester.remote';
import scoutRole from './role/scout';
import skKillerRole from './role/sk-killer';
import squadCivilianRole from './role/squad-civilian';
import transporterRole from './role/transporter';
import unassignedRole from './role/unassigned';
import upgraderRole from './role/upgrader';
import FunnelManager from './empire/funnel-manager';
import LabManager from './empire/lab-manager';
import NavMesh from './utils/nav-mesh';
import PlayerIntelManager from './player-intel-manager';
import ProcessReport from './report/process';
import ReclaimManager from './reclaim-manager';
import RemoteMinePrioritizer from './empire/remote-mine-prioritizer';
import ReportManager from './report/report-manager';
import ResourceInformation from 'utils/resource-information';
import ResourceLevelManager from 'room/resource-level-manager';
import ResourcesReport from './report/resources';
import RolesReport from './report/roles';
import RoomSignGenerator from './room/sign-generator';
import RoomSignManager from './room/sign-manager';
import RoomsReport from './report/rooms';
import RoomStatus from './room/room-status';
import SpawnManager from './spawn-manager';
import Squad from 'squad';
import SquadManager from 'manager.squad';
import TradeRouteManager from './empire/trade-route-manager';
import TrafficManager from './creep/traffic-manager';
import {Container} from './utils/container';

import brawlerSpawnRole from 'spawn-role/brawler';
import builderSpawnRole from 'spawn-role/builder';
import depositHarvesterSpawnRole from 'spawn-role/harvester.deposit';
import dismantlerSpawnRole from 'spawn-role/dismantler';
import harvesterSpawnRole from 'spawn-role/harvester';
import helperSpawnRole from 'spawn-role/helper';
import mineralHarvesterSpawnRole from 'spawn-role/harvester.minerals';
import muleSpawnRole from 'spawn-role/mule';
import powerHarvesterSpawnRole from 'spawn-role/harvester.power';
import powerHaulerSpawnRole from 'spawn-role/hauler.power';
import reclaimSpawnRole from 'spawn-role/reclaim';
import remoteMiningSpawnRole from 'spawn-role/remote-mining';
import roomDefenseSpawnRole from 'spawn-role/room-defense';
import scoutSpawnRole from 'spawn-role/scout';
import squadSpawnRole from 'spawn-role/squad';
import squadCivilianSpawnRole from 'spawn-role/squad-civilian';
import transporterSpawnRole from 'spawn-role/transporter';
import upgraderSpawnRole from 'spawn-role/upgrader';

declare global {
	interface DependencyInjectionContainer {
		CombatManager: CombatManager;
		CreepManager: CreepManager;
		HelpReport: HelpReport;
		FunnelManager: FunnelManager;
		LabManager: LabManager;
		NavMesh: NavMesh;
		PlayerIntelManager: PlayerIntelManager;
		ProcessReport: ProcessReport;
		ReclaimManager: ReclaimManager;
		RemoteMinePrioritizer: RemoteMinePrioritizer;
		ReportManager: ReportManager;
		ResourceInformation: ResourceInformation;
		ResourceLevelManager: ResourceLevelManager;
		ResourcesReport: ResourcesReport;
		RolesReport: RolesReport;
		RoomSignGenerator: RoomSignGenerator;
		RoomSignManager: RoomSignManager;
		RoomsReport: RoomsReport;
		RoomStatus: RoomStatus;
		SpawnManager: SpawnManager;
		SquadManager: SquadManager;
		TradeRouteManager: TradeRouteManager;
		TrafficManager: TrafficManager;
	}
}

const spawnClasses = {
	brawler: brawlerSpawnRole,
	builder: builderSpawnRole,
	dismantler: dismantlerSpawnRole,
	harvester: harvesterSpawnRole,
	'harvester.deposit': depositHarvesterSpawnRole,
	'harvester.minerals': mineralHarvesterSpawnRole,
	'harvester.power': powerHarvesterSpawnRole,
	'hauler.power': powerHaulerSpawnRole,
	helper: helperSpawnRole,
	mule: muleSpawnRole,
	reclaim: reclaimSpawnRole,
	'remote-mine': remoteMiningSpawnRole,
	'room-defense': roomDefenseSpawnRole,
	scout: scoutSpawnRole,
	squad: squadSpawnRole,
	'squad-civilian': squadCivilianSpawnRole,
	transporter: transporterSpawnRole,
	upgrader: upgraderSpawnRole,
};

function containerFactory(container: Container) {
	container.set('CombatManager', () => new CombatManager());
	container.set('CreepManager', () => {
		const creepManager = new CreepManager();
		creepManager.registerCreepRole('brawler', new brawlerRole());
		creepManager.registerCreepRole('squad-brawler', new squadBrawlerRole());
		creepManager.registerCreepRole('builder', new builderRole());
		creepManager.registerCreepRole('builder.mines', new mineBuilderRole());
		creepManager.registerCreepRole('builder.remote', new remoteBuilderRole());
		creepManager.registerCreepRole('claimer', new claimerRole());
		creepManager.registerCreepRole('dismantler', new dismantlerRole());
		creepManager.registerCreepRole('guardian', new guardianRole());
		creepManager.registerCreepRole('harvester', new harvesterRole());
		creepManager.registerCreepRole('harvester.deposit', new depositHarvesterRole());
		creepManager.registerCreepRole('harvester.power', new powerHarvesterRole());
		creepManager.registerCreepRole('harvester.remote', new remoteHarvesterRole());
		creepManager.registerCreepRole('hauler.power', new powerHaulerRole());
		creepManager.registerCreepRole('hauler.relay', new relayHaulerRole());
		creepManager.registerCreepRole('helper', new helperRole());
		creepManager.registerCreepRole('mule', new muleRole());
		creepManager.registerCreepRole('scout', new scoutRole());
		creepManager.registerCreepRole('skKiller', new skKillerRole());
		creepManager.registerCreepRole('squad-civilian', new squadCivilianRole());
		creepManager.registerCreepRole('transporter', new transporterRole());
		creepManager.registerCreepRole('unassigned', new unassignedRole());
		creepManager.registerCreepRole('upgrader', new upgraderRole());
		return creepManager;
	});
	container.set('HelpReport', () => new HelpReport());
	container.set('FunnelManager', () => new FunnelManager());
	container.set('LabManager', () => new LabManager());
	container.set('NavMesh', () => new NavMesh());
	container.set('PlayerIntelManager', () => new PlayerIntelManager());
	container.set('ProcessReport', () => new ProcessReport());
	container.set('ReclaimManager', () => new ReclaimManager());
	container.set('RemoteMinePrioritizer', (c) => new RemoteMinePrioritizer(
		c.get('RoomStatus'),
		c.get('SquadManager'),
	));
	container.set('ReportManager', () => new ReportManager());
	container.set('ResourceInformation', () => new ResourceInformation());
	container.set('ResourceLevelManager', (c) => new ResourceLevelManager(
		c.get('ResourceInformation'),
	));
	container.set('ResourcesReport', () => new ResourcesReport());
	container.set('RolesReport', () => new RolesReport());
	container.set('RoomSignGenerator', () => new RoomSignGenerator());
	container.set('RoomSignManager', (c) => new RoomSignManager(c.get('RoomSignGenerator')));
	container.set('RoomsReport', (c) => new RoomsReport(c.get('FunnelManager')));
	container.set('RoomStatus', () => new RoomStatus());
	container.set('SpawnManager', () => {
		const spawnManager = new SpawnManager();
		for (const roleName in spawnClasses) {
			spawnManager.registerSpawnRole(roleName, new spawnClasses[roleName]());
		}

		return spawnManager;
	});
	container.set('SquadManager', () => new SquadManager(Squad));
	container.set('TradeRouteManager', (c) => new TradeRouteManager(c.get('ResourceLevelManager')));
	container.set('TrafficManager', () => new TrafficManager());
}

export default containerFactory;
