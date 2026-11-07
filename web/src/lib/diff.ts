/** Diff satırının rengi (git'in birleşik diff formatı ve araç kartlarındaki "+ / -" satırları) */
export function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) {
    return "font-semibold text-muted";
  }
  if (line.startsWith("@@")) return "text-accent";
  if (line.startsWith("+")) return "bg-success-soft text-success-soft-foreground";
  if (line.startsWith("-")) return "bg-danger-soft text-danger-soft-foreground";
  return "";
}
