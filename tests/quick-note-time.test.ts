import { expect, it } from 'vitest';
import { quickNoteTime } from '../src/quick-note.js';

it('uses local calendar components with readable display and portable filenames', () => {
  expect(quickNoteTime(new Date(2026, 8, 8, 9, 5, 3))).toEqual({
    title: '2026-09-08 09:05:03', filename: '2026-09-08 09-05-03',
  });
  expect(quickNoteTime(new Date(2027, 0, 1, 0, 0, 0)).title).toBe('2027-01-01 00:00:00');
});
