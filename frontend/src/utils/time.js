/**
 * Format a UTC ISO timestamp into a clean local date & time string.
 */
export function formatDateTime(isoString) {
  if (!isoString) return '-';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return isoString;
  return dt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format a YYYY-MM-DD date string cleanly for display.
 */
export function formatDateOnly(dateString) {
  if (!dateString) return '-';
  const dt = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return dateString;
  return dt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a dollar amount with 2 decimal places.
 */
export function formatCurrency(amount) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return '-';
  }
  return `$${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format remaining time between `nowMs` and `targetIso` as "Xh Ym Zs" or "Ym Zs".
 */
export function formatCountdown(targetIso, nowMs) {
  if (!targetIso) return '-';
  const diffMs = Date.parse(targetIso) - nowMs;
  if (Number.isNaN(diffMs) || diffMs <= 0) {
    return '0m 00s';
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

/**
 * Convert a Date object into the "YYYY-MM-DDTHH:mm" format required by datetime-local inputs.
 */
export function toDateTimeLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Return the CSS class suffix for an auction status badge.
 */
export function statusBadgeClass(status) {
  switch (status) {
    case 'Active':
      return 'badge-active';
    case 'Closed':
      return 'badge-closed';
    case 'Force Closed':
      return 'badge-force-closed';
    case 'Upcoming':
      return 'badge-upcoming';
    default:
      return 'badge-closed';
  }
}

