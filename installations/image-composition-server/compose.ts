/**
 * Image Composition Module
 *
 * Fetches images from b3nd URLs and composes them onto a canvas.
 */

import { createCanvas, loadImage, type Canvas, type Image } from "canvas";
import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";

/**
 * Specification for an image layer in the composition
 */
export interface ImageLayer {
  /** b3nd URI to fetch the image from */
  uri: string;
  /** X coordinate on the canvas (top-left of image) */
  x: number;
  /** Y coordinate on the canvas (top-left of image) */
  y: number;
  /** Optional width to scale the image to */
  width?: number;
  /** Optional height to scale the image to */
  height?: number;
}

/**
 * Request specification for composing images
 */
export interface ComposeRequest {
  /** Width of the output canvas */
  width: number;
  /** Height of the output canvas */
  height: number;
  /** Background color (CSS color string, e.g., "#ffffff" or "transparent") */
  background?: string;
  /** Array of image layers to compose, rendered in order (first is bottom) */
  layers: ImageLayer[];
}

/**
 * Result of a composition operation
 */
export interface ComposeResult {
  success: boolean;
  /** Base64-encoded PNG image data (without data URI prefix) */
  data?: string;
  /** MIME type of the output */
  mimeType?: string;
  /** Error message if composition failed */
  error?: string;
  /** Details about each layer's processing */
  layerResults?: LayerResult[];
}

export interface LayerResult {
  uri: string;
  success: boolean;
  error?: string;
}

/**
 * Image data structure stored in b3nd
 */
export interface StoredImage {
  /** Base64-encoded image data */
  data: string;
  /** MIME type of the image */
  mimeType: string;
  /** Original filename (optional) */
  filename?: string;
}

/**
 * Fetches an image from a b3nd URI and returns it as a canvas Image
 */
async function fetchImageFromB3nd(
  client: NodeProtocolInterface,
  uri: string
): Promise<{ success: true; image: Image } | { success: false; error: string }> {
  try {
    const result = await client.read<StoredImage>(uri);

    if (!result.success || !result.record?.data) {
      return {
        success: false,
        error: result.error || `Image not found at ${uri}`
      };
    }

    const storedImage = result.record.data;

    // Handle both raw base64 and data URI formats
    let base64Data = storedImage.data;
    if (base64Data.startsWith("data:")) {
      // Extract base64 portion from data URI
      const commaIndex = base64Data.indexOf(",");
      if (commaIndex !== -1) {
        base64Data = base64Data.substring(commaIndex + 1);
      }
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, "base64");

    // Load image from buffer
    const image = await loadImage(buffer);

    return { success: true, image };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Composes multiple images from b3nd URIs onto a single canvas
 */
export async function composeImages(
  client: NodeProtocolInterface,
  request: ComposeRequest
): Promise<ComposeResult> {
  const { width, height, background, layers } = request;

  // Validate dimensions
  if (width <= 0 || height <= 0) {
    return { success: false, error: "Width and height must be positive" };
  }

  if (width > 4096 || height > 4096) {
    return { success: false, error: "Maximum dimension is 4096 pixels" };
  }

  if (layers.length === 0) {
    return { success: false, error: "At least one layer is required" };
  }

  if (layers.length > 50) {
    return { success: false, error: "Maximum 50 layers allowed" };
  }

  try {
    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Fill background if specified
    if (background && background !== "transparent") {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }

    const layerResults: LayerResult[] = [];

    // Render each layer
    for (const layer of layers) {
      const fetchResult = await fetchImageFromB3nd(client, layer.uri);

      if (!fetchResult.success) {
        layerResults.push({
          uri: layer.uri,
          success: false,
          error: fetchResult.error,
        });
        continue;
      }

      const image = fetchResult.image;

      // Calculate dimensions
      const drawWidth = layer.width ?? image.width;
      const drawHeight = layer.height ?? image.height;

      // Draw image on canvas
      ctx.drawImage(image, layer.x, layer.y, drawWidth, drawHeight);

      layerResults.push({
        uri: layer.uri,
        success: true,
      });
    }

    // Check if any layers failed
    const successfulLayers = layerResults.filter(r => r.success).length;
    if (successfulLayers === 0) {
      return {
        success: false,
        error: "All layers failed to load",
        layerResults,
      };
    }

    // Export canvas to PNG
    const buffer = canvas.toBuffer("image/png");
    const base64Data = buffer.toString("base64");

    return {
      success: true,
      data: base64Data,
      mimeType: "image/png",
      layerResults,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parses a compose request from query parameters
 *
 * Query format:
 * - width: number
 * - height: number
 * - background: string (optional)
 * - layers: JSON array of ImageLayer objects
 *
 * OR simplified format for single/few images:
 * - width: number
 * - height: number
 * - image1: uri,x,y[,width,height]
 * - image2: uri,x,y[,width,height]
 * - ...
 */
export function parseComposeRequestFromQuery(
  params: URLSearchParams
): ComposeRequest | { error: string } {
  const widthStr = params.get("width");
  const heightStr = params.get("height");

  if (!widthStr || !heightStr) {
    return { error: "width and height are required" };
  }

  const width = parseInt(widthStr, 10);
  const height = parseInt(heightStr, 10);

  if (isNaN(width) || isNaN(height)) {
    return { error: "width and height must be valid numbers" };
  }

  const background = params.get("background") || undefined;

  // Try to parse layers from JSON
  const layersJson = params.get("layers");
  if (layersJson) {
    try {
      const layers = JSON.parse(layersJson) as ImageLayer[];
      if (!Array.isArray(layers)) {
        return { error: "layers must be an array" };
      }
      return { width, height, background, layers };
    } catch {
      return { error: "Invalid layers JSON" };
    }
  }

  // Parse simplified format: image1=uri,x,y[,width,height]
  const layers: ImageLayer[] = [];
  for (let i = 1; i <= 50; i++) {
    const imageParam = params.get(`image${i}`);
    if (!imageParam) continue;

    const parts = imageParam.split(",");
    if (parts.length < 3) {
      return { error: `image${i} must have at least uri,x,y` };
    }

    const [uri, xStr, yStr, widthStr, heightStr] = parts;
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    if (isNaN(x) || isNaN(y)) {
      return { error: `image${i} x and y must be valid numbers` };
    }

    const layer: ImageLayer = { uri, x, y };

    if (widthStr) {
      const w = parseInt(widthStr, 10);
      if (!isNaN(w)) layer.width = w;
    }
    if (heightStr) {
      const h = parseInt(heightStr, 10);
      if (!isNaN(h)) layer.height = h;
    }

    layers.push(layer);
  }

  if (layers.length === 0) {
    return { error: "At least one image layer is required (use layers=JSON or image1=uri,x,y)" };
  }

  return { width, height, background, layers };
}
