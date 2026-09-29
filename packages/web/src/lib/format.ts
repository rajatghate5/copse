/**
 * Small presentation helpers. Time formatting and the "Nd left" expiry label,
 * which reads the shared RETENTION_MS so the client and server never disagree
 * about when a message dies.
 */

import { RETENTION_MS } from '@copse/protocol';

/** A clock time for a message (today) or a short day label for older ones. */
export function messageTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((now.getTime() - at) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** A day heading for grouping the stream. */
export function dayLabel(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - at) / 86400000);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (diffDays <= 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

/** How long until this message is swept, e.g. "3d left", or null once it's due. */
export function expiryLabel(sentAt: number): string | null {
  const msLeft = sentAt + RETENTION_MS - Date.now();
  if (msLeft <= 0) return null;
  const days = Math.ceil(msLeft / 86400000);
  return `${days}d left`;
}

/** Two-letter initials for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
