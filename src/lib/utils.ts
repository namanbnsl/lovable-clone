import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractTaskSummary(text: string): string | null {
  const match = text.match(/<task_summary>([\s\S]*?)<\/task_summary>/i);
  return match ? match[1].trim() : null;
}
