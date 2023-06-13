import FunnelManager from './empire/funnel-manager';
import NavMesh from './utils/nav-mesh';
import PlayerIntelManager from './player-intel-manager';
import ReclaimManager from './reclaim-manager';
import SpawnManager from './spawn-manager';
import {Container} from './utils/container';

export default function (container: Container) {
	container.set('FunnelManager', () => new FunnelManager());
	container.set('NavMesh', () => new NavMesh());
	container.set('PlayerIntelManager', () => new PlayerIntelManager());
	container.set('ReclaimManager', () => new ReclaimManager());
	container.set('SpawnManager', () => new SpawnManager());
}
