"use strict";

// Shortcut icons (24x24 path data), shared by the panel and the settings page.
window.EDGE_ICONS = {
  app: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
  music: "M12 3v10.6A4 4 0 1 0 14 17V7h4V3z",
  chat: "M4 4h16v12H7l-3 3z",
  game: "M7 8h10a5 5 0 0 1 0 10c-1.6 0-2.6-1-3.4-2h-3.2C9.6 17 8.6 18 7 18A5 5 0 0 1 7 8zm0 3v2H5v2h2v2h2v-2h2v-2H9v-2zm9 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  calc: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm1 3v4h10V5zm0 7v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zm-8 4v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2z",
  chart: "M4 20V10h3v10zm6 0V4h3v16zm6 0v-7h3v7z",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15 15 0 0 0-1.3-4A8 8 0 0 1 18.9 8zM12 4c.8 1.1 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.9 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a17 17 0 0 0 0 4zm.8 2h3a15 15 0 0 0 1.3 4A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.3-4A15 15 0 0 0 8.1 8zM12 20c-.8-1.1-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.9-1.9 4zm2.3-6H9.7a15 15 0 0 1 0-4h4.6a15 15 0 0 1 0 4zm.3 6a15 15 0 0 0 1.3-4h3a8 8 0 0 1-4.3 4zm1.7-6a17 17 0 0 0 0-4h3.4a8 8 0 0 1 0 4z",
  folder: "M3 5h7l2 2h9v12H3z",
  code: "M8.6 16.6 4 12l4.6-4.6L10 8.8 6.8 12l3.2 3.2zm6.8 0L14 15.2l3.2-3.2L14 8.8l1.4-1.4L20 12z",
  video: "M3 6h13v12H3zm14 4 4-3v10l-4-3z",
  mail: "M3 5h18v14H3zm2 2v.5l7 4.5 7-4.5V7z",
  camera: "M9 4h6l1.5 2H21v13H3V6h4.5zm3 4a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z",
  settings: "M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1L15 3h-4l-.3 2.9a7.5 7.5 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.5 7.5 0 0 0 1.7 1L11 21h4l.3-2.9a7.5 7.5 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z",
  power: "M11 3h2v9h-2zm6.1 2.9 1.4-1.4A9 9 0 1 1 5.5 4.5l1.4 1.4a7 7 0 1 0 10.2 0z",
};

window.edgeIconSvg = (name) =>
  `<svg viewBox="0 0 24 24"><path d="${window.EDGE_ICONS[name] ?? window.EDGE_ICONS.app}"/></svg>`;
