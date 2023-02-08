import container from './utils/container';
import PlayerIntelManager from './player-intel-manager';
import SpawnManager from './spawn-manager';

export default function () {
	container.set('PlayerIntelManager', () => new PlayerIntelManager());
	container.set('SpawnManager', () => new SpawnManager());
}
