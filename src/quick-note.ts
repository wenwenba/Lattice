/** Local wall-clock time for humans, with a Windows-safe filename variant. */
export function quickNoteTime(date = new Date()): { title: string; filename: string } {
  const pad = (number: number) => String(number).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return { title: `${day} ${time}`, filename: `${day} ${time.replaceAll(':', '-')}` };
}
