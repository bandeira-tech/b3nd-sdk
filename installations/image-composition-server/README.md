# Image Composition Server

HTTP server for composing images from b3nd URLs into a single image.

## Quick Start

```bash
# Copy environment file
cp .env.example .env

# Edit .env to configure BACKEND_URL

# Run the server
deno run -A mod.ts

# Or with watch mode
deno task dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BACKEND_URL` | b3nd backend URL | Required |
| `CORS_ORIGIN` | CORS allowed origin | `*` |

### Backend URL Options

- `memory://` - In-memory storage (for testing)
- `http://localhost:8765` - Local b3nd HTTP server
- `https://your-server.com` - Remote b3nd server

## API Endpoints

### Health Check
```
GET /api/v1/health
```

### Compose Images (JSON Response)
```
GET  /api/v1/compose?width=W&height=H&image1=uri,x,y[,w,h]&...
POST /api/v1/compose
```

### Compose Images (PNG Response)
```
GET  /api/v1/compose/image?width=W&height=H&image1=uri,x,y[,w,h]&...
POST /api/v1/compose/image
```

## Request Formats

### Query Parameters (GET)

**Simple format:**
```
?width=400&height=300&image1=images://store/logo,0,0&image2=images://store/bg,0,0,400,300
```

**JSON layers format:**
```
?width=400&height=300&layers=[{"uri":"images://store/logo","x":0,"y":0}]
```

### JSON Body (POST)

```json
{
  "width": 400,
  "height": 300,
  "background": "#ffffff",
  "layers": [
    { "uri": "images://store/background", "x": 0, "y": 0, "width": 400, "height": 300 },
    { "uri": "images://store/logo", "x": 10, "y": 10 },
    { "uri": "images://store/text", "x": 100, "y": 200, "width": 200, "height": 50 }
  ]
}
```

## Image Storage Format

Images should be stored in b3nd with this structure:

```json
{
  "data": "<base64-encoded image data>",
  "mimeType": "image/png",
  "filename": "optional-filename.png"
}
```

Or with data URI prefix:

```json
{
  "data": "data:image/png;base64,<base64-encoded data>",
  "mimeType": "image/png"
}
```

## Response Format

### JSON Response (`/api/v1/compose`)

```json
{
  "success": true,
  "data": "<base64-encoded PNG>",
  "mimeType": "image/png",
  "layerResults": [
    { "uri": "images://store/logo", "success": true },
    { "uri": "images://store/missing", "success": false, "error": "Not found" }
  ]
}
```

### Image Response (`/api/v1/compose/image`)

Returns raw PNG binary with `Content-Type: image/png`.

## Limits

- Maximum canvas size: 4096x4096 pixels
- Maximum layers: 50

## Running Tests

```bash
deno task test
```

## Example Usage

### Store an image

```bash
# Encode image to base64
BASE64=$(base64 -i logo.png)

# Write to b3nd
curl -X POST http://localhost:8765/api/v1/write/images/store/logo \
  -H "Content-Type: application/json" \
  -d "{\"value\":{\"data\":\"$BASE64\",\"mimeType\":\"image/png\"}}"
```

### Compose images

```bash
# Get composed image as JSON (base64)
curl "http://localhost:3000/api/v1/compose?width=800&height=600&image1=images://store/bg,0,0,800,600&image2=images://store/logo,10,10"

# Get composed image as PNG file
curl "http://localhost:3000/api/v1/compose/image?width=800&height=600&image1=images://store/bg,0,0,800,600&image2=images://store/logo,10,10" > composed.png

# POST with JSON body
curl -X POST http://localhost:3000/api/v1/compose \
  -H "Content-Type: application/json" \
  -d '{
    "width": 800,
    "height": 600,
    "background": "#ffffff",
    "layers": [
      {"uri": "images://store/bg", "x": 0, "y": 0, "width": 800, "height": 600},
      {"uri": "images://store/logo", "x": 10, "y": 10}
    ]
  }'
```
