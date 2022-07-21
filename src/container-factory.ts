import container from './utils/container';
import PlayerIntelManager from './player-intel-manager';

export default function () {
	container.set('PlayerIntelManager', () => new PlayerIntelManager());
}
