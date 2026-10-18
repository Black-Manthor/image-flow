// Close an Obsidian workspace window through its actual leaves, not CDP.
export async function detachWorkspaceWindow(page) {
 if (page.isClosed()) return;
 await page.evaluate(() => {
  const leaves = [];
  window.app.workspace.iterateAllLeaves(leaf => {
   if (leaf.getContainer().doc === document) leaves.push(leaf);
  });
  if (!leaves.length) throw new Error('No workspace leaf owns this window; retain it for diagnosis');
  // Let the driver receive the answer before the execution context disappears.
  setTimeout(() => { for (const leaf of leaves) leaf.detach(); }, 50);
 });
 if (!page.isClosed()) await page.waitForEvent('close', {timeout: 5000});
}
