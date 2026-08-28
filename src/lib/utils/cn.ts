type ClassValue = string | number | null | undefined | false | ClassValue[];

function flatten(input: ClassValue, out: string[]) {
  if (!input) return;
  if (Array.isArray(input)) {
    input.forEach((item) => flatten(item, out));
    return;
  }
  out.push(String(input));
}

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  flatten(inputs, out);
  return out.join(' ');
}
