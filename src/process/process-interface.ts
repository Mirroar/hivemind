export default interface ProcessInterface {
  shouldRun(): boolean;
  run(): void;
}
