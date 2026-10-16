// Lumbre — service worker. The action has no popup, so a click on the toolbar icon
// opens the full-page viewer in a new tab. That's the entire job of this worker.

'use strict';

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
});
