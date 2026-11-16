/*
 * ARGesturePlugin.jslib
 * ══════════════════════════════════════════════════════════════
 * Unity WebGL JavaScript Plugin
 *
 * PLACEMENT:
 *   Put this file inside your Unity project at:
 *   Assets/Plugins/WebGL/ARGesturePlugin.jslib
 *
 * PURPOSE:
 *   - Exposes OnUnityReadyCallback() so C# can call back to JS
 *   - Unity calls this once the DrawingManager is ready
 *   - JS then knows Unity is live and starts sending coords
 * ══════════════════════════════════════════════════════════════
 */

mergeInto(LibraryManager.library, {

    /**
     * Called from DrawingManager.cs → NotifyJavaScript()
     * Triggers window.OnUnityReady() in the browser
     */
    OnUnityReadyCallback: function() {
        if (typeof window.OnUnityReady === 'function') {
            window.OnUnityReady();
        }
    }

});
