import hivemind from 'hivemind';
import RoomVariationBuilder from 'room/planner/variation-builder';
import type {ExitCoords} from 'utils/room-info';
import { badAppleRooms } from 'warmind.local/settings';

export default class BadAppleRoomVariationBuilder extends RoomVariationBuilder {
	exitCenters: ExitCoords;
	roomCenter: RoomPosition;
	roomCenterEntrances: RoomPosition[];

	safetyMatrix: CostMatrix;

	constructor(roomName: string, variation: string, protected variationInfo: VariationInfo, wallMatrix: CostMatrix, exitMatrix: CostMatrix) {
		super(roomName, variation, variationInfo, wallMatrix, exitMatrix);
		hivemind.log('rooms', this.roomName).info('Started generating bad apple room plan for variation', variation);

		this.steps = [
			this.checkRoomCenter,
            this.planScreen,
			this.gatherExitCoords,
			this.determineCorePosition,
			this.determineHarvesterPositions,
			this.determineUpgraderPosition,
			this.placeRoadNetwork,
			this.placeRoomCore,
			this.placeHarvestBayStructures,
			this.placeBays,
			this.placeRamparts,
			this.sealRoom,
			this.placeTowers,
			this.placeRoadsToRamps,
			this.placeOnRamps,
		];
	}

	protected checkRoomCenter(): StepResult {
		// @todo Ideally we can relax this restriction by moving the center a bit.
		if (!this.variationInfo.roomCenter) return 'failed';
		const center = this.variationInfo.roomCenter;
		const isTop = badAppleRooms.indexOf(this.roomName) % 2 === 0;

		const screenHeight = 72 / 2;
		const minY = isTop ? 49 - screenHeight : 0;
		const maxY = isTop ? 49 : screenHeight;

		if (center.y >= minY && center.y <= maxY) {
			return 'failed';
		}

		return 'ok';
	}

    protected planScreen(): StepResult {
        const isTop = badAppleRooms.indexOf(this.roomName) % 2 === 0;
        const screenHeight = 72 / 2;
        const screenTop = isTop ? 49 - screenHeight : 0;

		hivemind.log('rooms', this.roomName).info('Planning screen at y=', screenTop);

        for (let y = 0; y < screenHeight; y++) {
            for (let x = 0; x < 50; x++) {
                if (!this.placementManager.isBuildableTile(x, y + screenTop, true, true)) continue;

                const pos = new RoomPosition(x, y + screenTop, this.roomName);
                this.placementManager.planLocation(pos, 'screen', 1);
            }
        }

        return 'ok';
    }
}
