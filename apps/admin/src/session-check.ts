/** React strict-effect replays and retries can overlap; only the latest check owns UI state. */
export class SessionCheckSequence {
  private generation = 0;
  begin() { return ++this.generation; }
  current(generation: number) { return generation === this.generation; }
  invalidate() { this.generation++; }
}
