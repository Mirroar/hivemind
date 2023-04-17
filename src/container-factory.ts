import container from './utils/container';
import PlayerIntelManager from './player-intel-manager';
import ReclaimManager from './reclaim-manager';
import SpawnManager from './spawn-manager';

export default function () {
	container.set('PlayerIntelManager', () => new PlayerIntelManager());
	container.set('ReclaimManager', () => new ReclaimManager());
	container.set('SpawnManager', () => new SpawnManager());
}
