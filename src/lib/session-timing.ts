export type PausableSessionTiming = {
  startedAt: Date;
  pausedAt: Date | null;
  pausedDurationSeconds: number;
};

export function currentPauseSeconds(
  session: PausableSessionTiming,
  now = new Date(),
) {
  if (!session.pausedAt) return 0;
  return Math.max(
    0,
    Math.floor((now.getTime() - session.pausedAt.getTime()) / 1000),
  );
}

export function totalPausedSeconds(
  session: PausableSessionTiming,
  now = new Date(),
) {
  return Math.max(0, session.pausedDurationSeconds) +
    currentPauseSeconds(session, now);
}

export function effectiveElapsedSeconds(
  session: PausableSessionTiming,
  now = new Date(),
) {
  const wallSeconds = Math.max(
    0,
    Math.floor((now.getTime() - session.startedAt.getTime()) / 1000),
  );
  return Math.max(0, wallSeconds - totalPausedSeconds(session, now));
}

export function sessionDeadlineAt(
  session: PausableSessionTiming,
  durationMinutes: number,
  now = new Date(),
) {
  return new Date(
    session.startedAt.getTime() +
      durationMinutes * 60 * 1000 +
      totalPausedSeconds(session, now) * 1000,
  );
}
