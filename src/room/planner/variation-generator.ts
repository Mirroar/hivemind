export default class VariationGenerator {
  protected variations: {
    [kes: string]: {};
  }
  protected variationKeys: string[];

  constructor(protected readonly roomName: string) {}

  generateVariations() {
    if (this.variations) return;

    this.variations = {default: {}};
    this.variationKeys = _.keys(this.variations);
  }

  getVariationList(): string[] {
    this.generateVariations();
    return this.variationKeys;
  }

  getVariationAmount(): number {
    this.generateVariations();
    return this.variationKeys.length;
  }

  getVariationInfo(key: string) {
    return this.variations[key];
  }
}
