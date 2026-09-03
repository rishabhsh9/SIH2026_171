/**
 * Fast Canvas Redaction and Download Utilities
 */

// Draw redaction boxes on top of screenshot in a single high-performance canvas pass
function redactAllOnCanvas(imageDataUrl, entities) {
    return new Promise((resolve) => {
        if (!entities || entities.length === 0) {
            resolve(imageDataUrl);
            return;
        }

        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            canvas.width = img.width;
            canvas.height = img.height;

            // Draw clean screenshot
            ctx.drawImage(img, 0, 0);

            // Redaction styling
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            entities.forEach((entity) => {
                const { x0, y0, width, height } = entity.bbox;

                // Black solid box
                ctx.fillStyle = "#000000";
                ctx.fillRect(x0, y0, width, height);

                // Highlight border
                ctx.strokeStyle = "#ff4d4f";
                ctx.lineWidth = 2;
                ctx.strokeRect(x0, y0, width, height);

                // Label tag
                ctx.fillStyle = "#ffffff";
                const fontSize = Math.max(10, Math.min(height * 0.6, 16));
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.fillText(`[${entity.type}]`, x0 + width / 2, y0 + height / 2);
            });

            resolve(canvas.toDataURL("image/png"));
        };
        img.src = imageDataUrl;
    });
}
