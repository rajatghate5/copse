/**
 * Loading skeletons.
 *
 * These stand in for content whose shape is already known, which is the only
 * case where a skeleton beats a word: it holds the layout still, so nothing
 * jumps when the real thing lands. Where the shape is NOT known, a sentence is
 * more honest than a grey rectangle pretending to be something.
 *
 * Boot matters more than it used to. It used to be one IndexedDB read; with
 * session resume it can also re-establish a server session, which on a
 * cold-started free-tier server is a real wait.
 */

/** One conversation row: avatar, name, preview. */
function RowBone() {
  return (
    <div className="sk-row" aria-hidden="true">
      <span className="sk sk-av" />
      <span className="sk-lines">
        <span className="sk sk-line" style={{ width: '58%' }} />
        <span className="sk sk-line sk-thin" style={{ width: '82%' }} />
      </span>
    </div>
  );
}

/** The conversation list, while we do not yet know what is in it. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="sk-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <RowBone key={i} />)}
    </div>
  );
}

/**
 * The whole shell during boot. Mirrors `.app`'s two columns, so the real screen
 * replaces it in place rather than shifting it.
 */
export function AppSkeleton() {
  // Widths that look like a conversation rather than a column of equal bars.
  const bubbles = [
    { w: '46%', mine: false },
    { w: '32%', mine: true },
    { w: '58%', mine: false },
    { w: '41%', mine: true },
    { w: '28%', mine: false },
  ];
  return (
    <div className="frame" aria-busy="true">
      <div className="topbar">
        <span className="sk sk-brand" />
        <span className="spacer" />
        <span className="sk sk-circle" />
        <span className="sk sk-circle" />
      </div>
      <div className="stage">
        <div className="app">
          <div className="sk-col">
            <div className="sk-head"><span className="sk sk-line" style={{ width: '44%' }} /></div>
            <ListSkeleton />
          </div>
          <div className="sk-thread">
            <div className="sk-head">
              <span className="sk sk-av" />
              <span className="sk sk-line" style={{ width: '32%' }} />
            </div>
            <div className="sk-msgs">
              {bubbles.map((b, i) => (
                <span
                  key={i}
                  className={`sk sk-bubble${b.mine ? ' mine' : ''}`}
                  style={{ width: b.w }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* The only thing a screen reader needs from any of the above. */}
      <span className="sr-only" role="status">Loading Copse…</span>
    </div>
  );
}
