import RoomPlan from 'room/planner/room-plan';
import RoomPlanMatrixGenerator from 'room/planner/matrix-generator';
import RoomPlanScorer from 'room/planner/room-plan-scorer';
import RoomVariationBuilder from 'room/planner/variation-builder';
import StripmineRoomVariationBuilder from 'room/planner/stripmine-variation-builder';
import VariationGenerator from 'room/planner/variation-generator';

type HeapMemory = {
	plan: RoomPlan;
};

const generatorCache: Record<string, HeapMemory> = {};

export default class RoomPlanGenerator {
	roomName: string;
	variationGenerator: VariationGenerator;
	variationIndex: number;
	currentVariation: string;
	wallMatrix: CostMatrix;
	exitMatrix: CostMatrix;
	variationBuilder: RoomVariationBuilder;
	scorer: RoomPlanScorer;
	results: Record<string, {
		plan: RoomPlan;
		score: Record<string, number>;
	}>;

	constructor(roomName: string, version: number) {
		this.roomName = roomName;
		this.variationIndex = 0;
		this.results = {};
		this.provideDistanceMatrixes();
		this.variationGenerator = new VariationGenerator(this.roomName, this.wallMatrix, this.exitMatrix);
		this.scorer = new RoomPlanScorer(this.roomName);
	}

	generate() {
		if (this.isFinished()) return;

		if (!this.currentVariation) {
			this.initVariation();
			return;
		}

		this.generateVariation();
	}

	isFinished(): boolean {
		return !this.currentVariation && this.variationIndex > this.variationGenerator.getVariationAmount();
	}

	initVariation() {
		this.currentVariation = this.variationGenerator.getVariationList()[this.variationIndex++];
		const variationInfo = this.variationGenerator.getVariationInfo(this.currentVariation);

		this.variationBuilder = Memory.rooms[this.roomName]?.isStripmine ? new StripmineRoomVariationBuilder(this.roomName, this.currentVariation, variationInfo, this.wallMatrix, this.exitMatrix) : new RoomVariationBuilder(this.roomName, this.currentVariation, variationInfo, this.wallMatrix, this.exitMatrix);
	}

	generateVariation() {
		if (!this.variationBuilder.isFinished()) {
			this.variationBuilder.buildNextStep();
			return;
		}

		this.finalizeVariation();
	}

	/**
	 * Generates CostMatrixes needed for structure placement.
	 */
	provideDistanceMatrixes() {
		// These matrixes are cached until room plan generation is finished.
		if (this.wallMatrix) return;

		[this.wallMatrix, this.exitMatrix] = new RoomPlanMatrixGenerator().generate(this.roomName);
	}

	finalizeVariation() {
		// @todo Store room plan for current variation and score it.
		const plan = this.variationBuilder.getRoomPlan();
		this.results[this.currentVariation] = {
			plan,
			score: this.scorer.getScore(plan, this.exitMatrix, this.wallMatrix),
		};

		delete this.variationBuilder;
		delete this.currentVariation;
	}

	getRoomPlan(): RoomPlan {
		// @todo Get room plan with highest score.
		const best = _.max(this.results, 'score.total');

		if (best) return best.plan;

		return null;
	}

	outputScores() {
		let output = '<table border="1"><tr><th>Variation</th><th>Total Score</th>';
		let finishedHeader = false;
		const keys = ['total'];

		for (const variation in this.results) {
			const score = this.results[variation].score;
			if (!finishedHeader) {
				for (const key in score) {
					if (!keys.includes(key)) {
						keys.push(key);
						output += '<th>' + key + '</th>';
					}
				}

				finishedHeader = true;
				output += '</tr>';
			}

			output += '<tr><td>' + variation + '</td>';
			for (const key of keys) {
				output += '<td>' + score[key].toPrecision(3) + '</td>';
			}

			output += '</tr>';
		}

		output += '</table>';
		console.log(output);
	}

	visualize() {
		if (this.variationBuilder) {
			const plan = this.variationBuilder.getRoomPlan();
			plan.visualize();
			return;
		}

		const plan = this.getRoomPlan();
		if (!plan) return;

		plan.visualize();
	}
}
