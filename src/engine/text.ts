/** 把一段話依句號、驚嘆號、問號拆成多頁（標點留在句尾）；只有一句時回傳單頁 */
export function splitPages(text: string): string[] {
  const parts = text.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}
