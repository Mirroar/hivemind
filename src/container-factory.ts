import HelpReport from './report/help';
import FunnelManager from './empire/funnel-manager';
import NavMesh from './utils/nav-mesh';
import PlayerIntelManager from './player-intel-manager';
import ReclaimManager from './reclaim-manager';
import ReportManager from './report/report-manager';
import ResourcesReport from './report/resources';
import SpawnManager from './spawn-manager';
import TrafficManager from './creep/traffic-manager';
import {Container} from './utils/container';

declare global {
	interface DependencyInjectionContainer {
		HelpReport: HelpReport;
		FunnelManager: FunnelManager;
		NavMesh: NavMesh;
		PlayerIntelManager: PlayerIntelManager;
		ReclaimManager: ReclaimManager;
		ReportManager: ReportManager;
		ResourcesReport: ResourcesReport;
		SpawnManager: SpawnManager;
		TrafficManager: TrafficManager;
	}
}

export default function (container: Container) {
	container.set('HelpReport', () => new HelpReport());
	container.set('FunnelManager', () => new FunnelManager());
	container.set('NavMesh', () => new NavMesh());
	container.set('PlayerIntelManager', () => new PlayerIntelManager());
	container.set('ReclaimManager', () => new ReclaimManager());
	container.set('ReportManager', () => new ReportManager());
	container.set('ResourcesReport', () => new ResourcesReport());
	container.set('SpawnManager', () => new SpawnManager());
	container.set('TrafficManager', () => new TrafficManager());
}
