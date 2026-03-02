const DAY_MS = 86400000;

function normalizeToDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function calculateStreak(workoutDates: string[]): number {
  if (workoutDates.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();
  const yesterdayTime = todayTime - DAY_MS;

  const workoutDays = new Set<number>();
  for (const d of workoutDates) {
    workoutDays.add(normalizeToDay(new Date(d)));
  }

  let checkDate = todayTime;
  if (!workoutDays.has(todayTime)) {
    if (workoutDays.has(yesterdayTime)) {
      checkDate = yesterdayTime;
    } else {
      return 0;
    }
  }

  let streak = 0;
  let current = checkDate;
  while (workoutDays.has(current)) {
    streak++;
    current -= DAY_MS;
  }

  return streak;
}
