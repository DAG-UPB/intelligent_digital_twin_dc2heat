/** Replay bar: step back, play/pause, step forward, speed badge, scrubber and the current timestamp. */
interface Props {
  playheadIndex: number;
  totalPoints: number;
  isPlaying: boolean;
  playbackSpeed: number;
  currentTime: string | null;
  onSeek: (index: number) => void;
  onTogglePlay: () => void;
  onCycleSpeed: () => void;
}

export function ReplayControls({ playheadIndex, totalPoints, isPlaying, playbackSpeed, currentTime, onSeek, onTogglePlay, onCycleSpeed }: Props) {
  if (totalPoints === 0) return null;
  return (
    <div className="card replay" role="group" aria-label="Replay">
      <button type="button" className="btn btn--icon" onClick={() => onSeek(playheadIndex - 1)} disabled={isPlaying} title="Step back" aria-label="Step back">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="2" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <button type="button" className="btn btn--icon btn--primary replay__play" onClick={onTogglePlay} title={isPlaying ? "Pause" : "Play"} aria-label={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <rect x="2" y="1.5" width="3" height="9" rx="1" />
            <rect x="7" y="1.5" width="3" height="9" rx="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <path d="M2.5 1.5L10.5 6l-8 4.5V1.5z" />
          </svg>
        )}
      </button>

      <button type="button" className="btn btn--icon" onClick={() => onSeek(playheadIndex + 1)} disabled={isPlaying} title="Step forward" aria-label="Step forward">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="10" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <button type="button" className="btn replay__speed" onClick={onCycleSpeed} title="Cycle playback speed" aria-label={`Playback speed ${playbackSpeed}×, click to change`}>
        {playbackSpeed}×
      </button>

      <div className="replay__divider" />

      <input type="range" aria-label="Playhead" min={0} max={totalPoints - 1} value={playheadIndex} onChange={(e) => onSeek(Number(e.target.value))} />

      <span className="mono replay__time">{currentTime ? currentTime.replace("T", " ") : `${playheadIndex} / ${totalPoints}`}</span>
    </div>
  );
}
