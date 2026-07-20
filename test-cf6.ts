import { windowManager } from "node-window-manager";
const windows = windowManager.getWindows();
const target = windows.find(w => { try { return w.getTitle().includes("Automati_Tiling"); } catch { return false; }});
if (target) {
    target.setBounds({x: 0, y: 0, width: 960, height: 540});
    console.log("Moved window via node-window-manager!");
} else {
    console.log("Window not found.");
}
