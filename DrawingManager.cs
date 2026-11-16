/*
 * DrawingManager.cs
 * ══════════════════════════════════════════════════════════════
 * AR Gesture Drawing System — Unity WebGL Drawing Engine
 * 
 * ATTACH THIS SCRIPT to a GameObject named "DrawingManager"
 * in your Unity scene.
 *
 * SETUP REQUIREMENTS:
 *  1. Create empty GameObject → name it "DrawingManager"
 *  2. Attach this script
 *  3. Assign a Camera to the 'mainCamera' field
 *  4. The LineRenderer prefab will be created at runtime
 *  5. Set the 'drawingPlaneZ' to match your canvas depth
 *
 * FEATURES:
 *  - Receives normalised (0..1) XY coords from JavaScript
 *  - Renders continuous glow strokes via LineRenderer
 *  - Multi-colour support, dynamic brush thickness
 *  - Catmull-Rom smoothing for fluid curves
 *  - Full clear, colour, size, and pause commands from JS
 *
 * EXPORT:
 *  File → Build Settings → WebGL → Build
 *  Copy the Build/ folder next to index.html
 * ══════════════════════════════════════════════════════════════
 */

using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Runtime.InteropServices;

[AddComponentMenu("AR Gesture Draw/Drawing Manager")]
public class DrawingManager : MonoBehaviour
{
    // ───────────────────────────────────────────
    // Inspector settings
    // ───────────────────────────────────────────

    [Header("Scene References")]
    [Tooltip("Main camera — used to project 2D coords to world space")]
    public Camera mainCamera;

    [Header("Drawing Plane")]
    [Tooltip("World-space Z depth of the drawing plane (distance from camera)")]
    public float drawingPlaneZ = 5f;

    [Header("Brush Defaults")]
    public float   brushSize    = 0.04f;
    public Color   brushColor   = new Color(0f, 0.96f, 0.83f, 1f); // cyan default
    public float   minSegmentDistance = 0.01f; // skip tiny segments

    [Header("Glow")]
    [Tooltip("Additive glow multiplier (set to 0 to disable)")]
    public float glowIntensity = 1.4f;

    [Header("Smoothing")]
    [Tooltip("Number of Catmull-Rom subdivisions per segment")]
    [Range(1, 10)]
    public int smoothSubdivisions = 4;

    // ───────────────────────────────────────────
    // Private state
    // ───────────────────────────────────────────

    // Current active line
    private LineRenderer    currentLine;
    private List<Vector3>   currentPoints = new List<Vector3>();
    private bool            penDown       = false;
    private bool            drawingEnabled= true;

    // All rendered lines (for clear)
    private List<LineRenderer> allLines = new List<LineRenderer>();

    // Material for line renderer (created at runtime)
    private Material lineMaterial;

    // Line container
    private Transform linesRoot;

    // ───────────────────────────────────────────
    // Initialisation
    // ───────────────────────────────────────────

    void Awake()
    {
        // Auto-assign main camera if not set
        if (mainCamera == null)
            mainCamera = Camera.main;

        // Create a container for all drawn lines
        linesRoot = new GameObject("Lines").transform;
        linesRoot.SetParent(transform);

        // Build the line material (Additive for glow effect)
        CreateLineMaterial();

        // Notify JS that Unity is ready
        NotifyJavaScript();
    }

    void CreateLineMaterial()
    {
        // Use Sprites/Default or Unlit/Color — Additive blending for glow
        Shader shader = Shader.Find("Hidden/Internal-Colored");
        if (shader == null) shader = Shader.Find("Unlit/Color");
        if (shader == null) shader = Shader.Find("Standard");

        lineMaterial = new Material(shader);
        lineMaterial.hideFlags = HideFlags.HideAndDontSave;

        // Try to enable additive blending for glow
        if (lineMaterial.HasProperty("_SrcBlend"))
        {
            lineMaterial.SetInt("_SrcBlend",  (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            lineMaterial.SetInt("_DstBlend",  (int)UnityEngine.Rendering.BlendMode.One); // Additive
            lineMaterial.SetInt("_ZWrite",    0);
            lineMaterial.renderQueue = 3000;
        }
    }

    // ───────────────────────────────────────────
    // JavaScript → Unity interface methods
    // ───────────────────────────────────────────

    /**
     * Called by JS: unityInstance.SendMessage("DrawingManager","ReceiveCoordinates","0.5,0.4,1")
     * Format: "normX,normY,penDown"  where penDown is "1" or "0"
     */
    public void ReceiveCoordinates(string data)
    {
        if (!drawingEnabled) return;

        string[] parts = data.Split(',');
        if (parts.Length < 3) return;

        float nx, ny;
        int   pd;

        if (!float.TryParse(parts[0], System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out nx)) return;
        if (!float.TryParse(parts[1], System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out ny)) return;
        if (!int.TryParse(parts[2], out pd)) return;

        bool isPenDown = pd == 1;
        Vector3 worldPos = NormalisedToWorld(nx, ny);

        if (isPenDown)
        {
            if (!penDown)
            {
                // Pen just went down — start new stroke
                StartNewStroke(worldPos);
                penDown = true;
            }
            else
            {
                // Continue stroke
                ContinueStroke(worldPos);
            }
        }
        else
        {
            if (penDown)
            {
                // Pen lifted — finalise stroke
                FinishStroke();
                penDown = false;
            }
        }
    }

    /**
     * Called by JS: unityInstance.SendMessage("DrawingManager","ReceiveColor","#ff00aa")
     */
    public void ReceiveColor(string hexColor)
    {
        Color c;
        if (ColorUtility.TryParseHtmlString(hexColor, out c))
            brushColor = c;
    }

    /**
     * Called by JS: unityInstance.SendMessage("DrawingManager","ReceiveBrushSize","6")
     */
    public void ReceiveBrushSize(string sizeStr)
    {
        float s;
        if (float.TryParse(sizeStr, out s))
            brushSize = Mathf.Clamp(s * 0.005f, 0.002f, 0.15f); // scale pixels → world units
    }

    /**
     * Called by JS: unityInstance.SendMessage("DrawingManager","ClearCanvas","")
     */
    public void ClearCanvas(string _ = "")
    {
        foreach (var lr in allLines)
            if (lr != null) Destroy(lr.gameObject);

        allLines.Clear();
        currentLine   = null;
        currentPoints.Clear();
        penDown       = false;
    }

    /**
     * Called by JS: unityInstance.SendMessage("DrawingManager","SetDrawingEnabled","true")
     */
    public void SetDrawingEnabled(string val)
    {
        drawingEnabled = val.ToLower() == "true";
        if (!drawingEnabled && penDown)
        {
            FinishStroke();
            penDown = false;
        }
    }

    // ───────────────────────────────────────────
    // Stroke management
    // ───────────────────────────────────────────

    void StartNewStroke(Vector3 worldPos)
    {
        // Create a new GameObject + LineRenderer for this stroke
        GameObject go = new GameObject("Stroke_" + allLines.Count);
        go.transform.SetParent(linesRoot);

        currentLine = go.AddComponent<LineRenderer>();
        ConfigureLineRenderer(currentLine);

        currentPoints.Clear();
        currentPoints.Add(worldPos);
        currentLine.positionCount = 1;
        currentLine.SetPosition(0, worldPos);

        allLines.Add(currentLine);
    }

    void ContinueStroke(Vector3 worldPos)
    {
        if (currentLine == null) { StartNewStroke(worldPos); return; }

        // Skip if too close to last point
        if (currentPoints.Count > 0)
        {
            float dist = Vector3.Distance(currentPoints[currentPoints.Count - 1], worldPos);
            if (dist < minSegmentDistance) return;
        }

        currentPoints.Add(worldPos);

        // Apply Catmull-Rom smoothing when we have enough points
        if (currentPoints.Count >= 4)
        {
            List<Vector3> smoothed = CatmullRomPath(currentPoints, smoothSubdivisions);
            currentLine.positionCount = smoothed.Count;
            currentLine.SetPositions(smoothed.ToArray());
        }
        else
        {
            currentLine.positionCount = currentPoints.Count;
            currentLine.SetPositions(currentPoints.ToArray());
        }
    }

    void FinishStroke()
    {
        // Final smooth pass
        if (currentLine != null && currentPoints.Count >= 4)
        {
            List<Vector3> smoothed = CatmullRomPath(currentPoints, smoothSubdivisions);
            currentLine.positionCount = smoothed.Count;
            currentLine.SetPositions(smoothed.ToArray());
        }
        currentLine   = null;
        currentPoints.Clear();
    }

    void ConfigureLineRenderer(LineRenderer lr)
    {
        lr.material         = new Material(lineMaterial);
        lr.startColor       = brushColor * glowIntensity;
        lr.endColor         = brushColor * glowIntensity;
        lr.startWidth       = brushSize;
        lr.endWidth         = brushSize;
        lr.numCapVertices   = 8;
        lr.numCornerVertices= 8;
        lr.useWorldSpace    = true;
        lr.shadowCastingMode= UnityEngine.Rendering.ShadowCastingMode.Off;
        lr.receiveShadows   = false;
        lr.positionCount    = 0;

        // Set colour including alpha
        Color c = brushColor;
        c.a = 1f;
        lr.startColor = c * glowIntensity;
        lr.endColor   = c * glowIntensity;
    }

    // ───────────────────────────────────────────
    // Coordinate conversion
    // ───────────────────────────────────────────

    /// <summary>
    /// Convert normalised 0..1 screen coords from JS → Unity world space
    /// </summary>
    Vector3 NormalisedToWorld(float nx, float ny)
    {
        // Convert normalised → screen pixels
        float screenX = nx * Screen.width;
        float screenY = (1f - ny) * Screen.height; // Unity Y is flipped

        // Unproject via camera
        Vector3 screenPos = new Vector3(screenX, screenY, drawingPlaneZ);
        return mainCamera.ScreenToWorldPoint(screenPos);
    }

    // ───────────────────────────────────────────
    // Catmull-Rom spline smoothing
    // ───────────────────────────────────────────

    List<Vector3> CatmullRomPath(List<Vector3> pts, int subdivisions)
    {
        List<Vector3> result = new List<Vector3>();
        for (int i = 0; i < pts.Count - 1; i++)
        {
            Vector3 p0 = pts[Mathf.Max(i - 1, 0)];
            Vector3 p1 = pts[i];
            Vector3 p2 = pts[i + 1];
            Vector3 p3 = pts[Mathf.Min(i + 2, pts.Count - 1)];

            for (int j = 0; j <= subdivisions; j++)
            {
                float t = j / (float)subdivisions;
                result.Add(CatmullRomPoint(p0, p1, p2, p3, t));
            }
        }
        return result;
    }

    Vector3 CatmullRomPoint(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float t)
    {
        float t2 = t * t;
        float t3 = t2 * t;

        return 0.5f * (
            2f * p1 +
            (-p0 + p2) * t +
            (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2 +
            (-p0 + 3f * p1 - 3f * p2 + p3) * t3
        );
    }

    // ───────────────────────────────────────────
    // JavaScript handshake
    // ───────────────────────────────────────────

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void OnUnityReadyCallback();

    void NotifyJavaScript()
    {
        try { OnUnityReadyCallback(); }
        catch (System.Exception) { /* callback not defined — OK */ }
    }
#else
    void NotifyJavaScript() { Debug.Log("[DrawingManager] Running outside WebGL — JS bridge inactive"); }
#endif

    // ───────────────────────────────────────────
    // Editor helper — draw Gizmos
    // ───────────────────────────────────────────

#if UNITY_EDITOR
    void OnDrawGizmosSelected()
    {
        if (mainCamera == null) return;
        Gizmos.color = Color.cyan;
        Vector3 c = mainCamera.transform.position + mainCamera.transform.forward * drawingPlaneZ;
        Gizmos.DrawWireCube(c, new Vector3(10, 6, 0));
    }
#endif
}
