import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The class-name helper shadcn/ui components expect. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
