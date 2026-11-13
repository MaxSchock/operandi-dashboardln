/** What the page does after "Generate" (no imports from the app, so node can test it). */
import { arrivedSince, sortForTab } from "./content-format";

/** How long the places kept for freshly requested posts wait before giving up. */
export const GENERATE_WAIT_MS = 20 * 60 * 1000;

export type Run = { n: number; known: string[]; until: number };
type Row = { post_id: string; created_at?: string | null; text_status: string | null; image_status: string | null; post_type: string | null; published_at: string | null; scheduled_for: string | null };

/** The posts that should have come and did not, once the wait is over: null when all came. */
export function shortfall(posts: { post_id: string; created_at?: string | null }[], run: Pick<Run, "n" | "known">): { asked: number; arrived: number } | null {
  const arrived = arrivedSince(posts, run.known, run.n).length;
  return arrived < run.n ? { asked: run.n, arrived } : null;
}

/** The sentence under the posts when the wait ran out with posts missing. */
export function shortfallMessage(s: { asked: number; arrived: number }): string {
  const waited = Math.round(GENERATE_WAIT_MS / 60000);
  return `${s.arrived} of ${s.asked} post${s.asked === 1 ? "" : "s"} arrived in ${waited} minutes. `
    + (s.arrived === 0 ? "Nothing was written. " : "The rest was not written. ")
    + "Press Generate again, and if it keeps happening tell us.";
}

/** Follows one person's posts after Generate: which ones to highlight and when to take them
 * to the list. One jump per press, at the first new post; a post looked at is never
 * highlighted again; nobody who moved on their own is moved again. */
export class GenerationFollow {
  private jumped = false;
  private moved = false;
  private seen = new Set<string>();
  private fresh: string[] = [];

  /** Generate was pressed: a new run starts and the person is where they chose to be. */
  press(): void { this.jumped = false; this.moved = false; }
  /** The person changed tab by themselves. */
  userMoved(): void { this.moved = true; }
  /** The person folded, opened or acted on the post: it stays as any other. */
  markSeen(id: string): string[] {
    this.seen.add(id);
    this.fresh = this.fresh.filter(x => x !== id);
    return this.fresh;
  }
  highlighted(): string[] { return this.fresh; }

  /** Call with the current posts and run (undefined once the wait is over). `jumpTo` is set
   * only on the first new post of the run, and only when the person has not moved. */
  step(posts: Row[], run: Pick<Run, "n" | "known"> | undefined): { fresh: string[]; jumpTo: string | null } {
    if (!run) return { fresh: this.fresh, jumpTo: null };
    const added = arrivedSince(posts, run.known, run.n).map(p => p.post_id).filter(id => !this.seen.has(id) && !this.fresh.includes(id));
    if (added.length === 0) return { fresh: this.fresh, jumpTo: null };
    this.fresh = [...this.fresh, ...added];
    if (this.jumped) return { fresh: this.fresh, jumpTo: null };
    this.jumped = true;
    if (this.moved) return { fresh: this.fresh, jumpTo: null };
    const first = sortForTab(posts.filter(p => added.includes(p.post_id)), "review")[0];
    return { fresh: this.fresh, jumpTo: first?.post_id ?? null };
  }
}
