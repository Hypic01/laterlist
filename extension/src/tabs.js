// Opens a background tab the way Chrome expects, with a fallback for Chromium
// shells like Arc, where an extension service worker has no "current window"
// and tabs.create without a windowId fails with "No current window".
export async function openBackgroundTab({ tabs, windows }, url) {
  try {
    return await tabs.create({ url, active: false });
  } catch (error) {
    if (!windows || !/no current window/i.test(String(error?.message || error))) throw error;
    const open = await windows.getAll({ windowTypes: ["normal"] });
    if (open.length) return tabs.create({ url, active: false, windowId: open[0].id });
    const created = await windows.create({ url, focused: false });
    return created?.tabs?.[0] ?? null;
  }
}
