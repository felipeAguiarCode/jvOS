import type { Usage } from "../../../../hooks/useSystemStats";
import type { Disk } from "../../../../lib/workspace";

const GB = 1024 ** 3;

/** Throughput as termide shows it: "0kb/s", "312kb/s", "4.2Mb/s". */
export function formatRate(bytesPerSecond: number): string {
  const kb = bytesPerSecond / 1024;
  return kb < 1000 ? `${Math.round(kb)}kb/s` : `${(kb / 1024).toFixed(1)}Mb/s`;
}

const gb = (bytes: number) => {
  const value = bytes / GB;
  return value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
};

/** "1.2/16GB". */
export const formatUsage = (usage: Usage) => `${gb(usage.used)}/${gb(usage.total)}GB`;

export const usageShare = (usage: Usage) => (usage.total > 0 ? usage.used / usage.total : 0);

/** "C: 475/487GB (98%)". */
export const formatDisk = (disk: Disk) => `${disk.name} ${formatUsage(disk)} (${Math.round(usageShare(disk) * 100)}%)`;

/** "2 KB", "12.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
export const formatTime = (date: Date) => TIME.format(date);

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const formatDateTime = (seconds: number) => DATE_TIME.format(new Date(seconds * 1000));
